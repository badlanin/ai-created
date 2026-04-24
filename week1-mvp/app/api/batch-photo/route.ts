import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { getDb, DATA_DIR_PATH } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  formatGarmentAttrs,
  generateImage,
  type GenImageInput,
} from "@/lib/gemini-image";
import { resolveModelId } from "@/lib/ai-models";
import {
  formatMaterialDetails,
  formatRealismConstraints,
  getMaterialsByIds,
  getRealismPreset,
} from "@/lib/materials";
import { retryWithBackoff } from "@/lib/retry";
import { runWithConcurrency, recommendConcurrency } from "@/lib/concurrency";
import { recordUsage } from "@/lib/usage";
import { assertWithinBudget } from "@/lib/pricing";

export const runtime = "nodejs";
// 批量摄影图：Pro + N 个姿势时可能累计 15-30 分钟，留足
export const maxDuration = 600;

type PoseRow = { id: number; name: string; text: string; type: string };

interface BatchResult {
  pose_id: number;
  pose_name: string;
  pose_type: string;
  success: boolean;
  image_url?: string;
  error?: string;
  duration_ms?: number;
}

/**
 * 替换 prompt 模板中的占位符
 */
function fillTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    return vars[key] ?? "";
  });
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await requireUser();
    assertWithinBudget(user.id, user.role);
    const db = getDb();

    const formData = await req.formData();

    // ---------- 解析 formData ----------
    // 产品图 (1-2 张，image0 正面，image1 背面可选)
    const productFiles: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (/^product_image\d+$/.test(key) && value instanceof File) {
        productFiles.push(value);
      }
    }
    if (productFiles.length === 0) {
      return NextResponse.json(
        { error: "请上传至少一张产品图" },
        { status: 400 },
      );
    }
    if (productFiles.length > 3) {
      return NextResponse.json(
        { error: "产品图最多 3 张（正面/背面/细节）" },
        { status: 400 },
      );
    }

    const identityId = Number(formData.get("identity_id"));
    const sceneId = Number(formData.get("scene_id"));
    const templateId = Number(formData.get("template_id"));
    if (!Number.isFinite(identityId))
      return NextResponse.json({ error: "请选择模特" }, { status: 400 });
    if (!Number.isFinite(sceneId))
      return NextResponse.json({ error: "请选择场景" }, { status: 400 });
    if (!Number.isFinite(templateId))
      return NextResponse.json({ error: "请选择 Prompt 模板" }, { status: 400 });

    const photographyIdRaw = formData.get("photography_id");
    const photographyId =
      typeof photographyIdRaw === "string" && photographyIdRaw.trim()
        ? Number(photographyIdRaw)
        : null;

    const realismIdRaw = formData.get("realism_id");
    const realismId =
      typeof realismIdRaw === "string" && realismIdRaw.trim()
        ? Number(realismIdRaw)
        : null;

    const poseIdsRaw = formData.get("pose_ids");
    let poseIds: number[] = [];
    try {
      const parsed = JSON.parse(String(poseIdsRaw || "[]"));
      if (Array.isArray(parsed)) {
        poseIds = parsed.filter((v) => Number.isFinite(v));
      }
    } catch {}
    if (poseIds.length === 0) {
      return NextResponse.json(
        { error: "请至少选择一个姿势" },
        { status: 400 },
      );
    }
    if (poseIds.length > 10) {
      return NextResponse.json(
        { error: "一次最多 10 个姿势" },
        { status: 400 },
      );
    }

    const materialIdsRaw = formData.get("material_ids");
    let materialIds: number[] = [];
    try {
      const parsed = JSON.parse(String(materialIdsRaw || "[]"));
      if (Array.isArray(parsed)) {
        materialIds = parsed.filter((v) => Number.isFinite(v));
      }
    } catch {}

    const garmentAttrsRaw = formData.get("garment_attrs");
    let garmentAttrs: Record<string, string | string[]> | null = null;
    if (typeof garmentAttrsRaw === "string" && garmentAttrsRaw.trim()) {
      try {
        garmentAttrs = JSON.parse(garmentAttrsRaw);
      } catch {}
    }

    const modelRaw = formData.get("model");
    const model = resolveModelId(
      "image_gen",
      typeof modelRaw === "string" ? modelRaw : undefined,
    );

    const aspectRatioRaw = formData.get("aspect_ratio");
    const ALLOWED_RATIOS = [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
    ];
    const aspectRatio =
      typeof aspectRatioRaw === "string" &&
      ALLOWED_RATIOS.includes(aspectRatioRaw)
        ? aspectRatioRaw
        : undefined;

    const qualityLevelRaw = formData.get("quality_level");
    const qualityLevel: "hd" | "2k" | "4k" =
      qualityLevelRaw === "hd" || qualityLevelRaw === "4k"
        ? qualityLevelRaw
        : "2k";

    const userSeed =
      typeof formData.get("user_seed") === "string"
        ? String(formData.get("user_seed")).trim()
        : "";

    // ---------- 加载所有素材 ----------
    const identity = db
      .prepare(
        `SELECT id, name, image_path FROM models WHERE id = ? AND kind = 'identity'`,
      )
      .get(identityId) as
      | { id: number; name: string; image_path: string }
      | undefined;
    if (!identity)
      return NextResponse.json({ error: "模特不存在" }, { status: 404 });

    const scene = db
      .prepare(`SELECT id, name, image_path FROM scenes WHERE id = ?`)
      .get(sceneId) as
      | { id: number; name: string; image_path: string }
      | undefined;
    if (!scene)
      return NextResponse.json({ error: "场景不存在" }, { status: 404 });

    const template = db
      .prepare(
        `SELECT id, name, template FROM prompt_templates WHERE id = ? AND kind = 'on_model'`,
      )
      .get(templateId) as
      | { id: number; name: string; template: string }
      | undefined;
    if (!template)
      return NextResponse.json(
        { error: "Prompt 模板不存在或类型不是 on_model" },
        { status: 404 },
      );

    const photography = photographyId
      ? (db
          .prepare(
            `SELECT name, params_text FROM photography_params WHERE id = ?`,
          )
          .get(photographyId) as
          | { name: string; params_text: string }
          | undefined)
      : null;

    const realism = getRealismPreset(realismId);

    const placeholders = poseIds.map(() => "?").join(",");
    const poses = db
      .prepare(
        `SELECT id, name, text, type FROM poses WHERE id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`,
      )
      .all(...poseIds) as PoseRow[];
    if (poses.length === 0) {
      return NextResponse.json(
        { error: "选中的姿势都不存在" },
        { status: 404 },
      );
    }

    const materials = getMaterialsByIds(materialIds);

    // ---------- 读取参考图文件 ----------
    const identityAbs = path.join(DATA_DIR_PATH, identity.image_path);
    const sceneAbs = path.join(DATA_DIR_PATH, scene.image_path);
    let identityBuf: Buffer;
    let sceneBuf: Buffer;
    try {
      identityBuf = await fs.readFile(identityAbs);
    } catch {
      return NextResponse.json(
        { error: `模特图文件丢失：${identity.image_path}` },
        { status: 500 },
      );
    }
    try {
      sceneBuf = await fs.readFile(sceneAbs);
    } catch {
      return NextResponse.json(
        { error: `场景图文件丢失：${scene.image_path}` },
        { status: 500 },
      );
    }

    const identityInput: GenImageInput = {
      buffer: identityBuf,
      mimeType: "image/png",
    };
    const sceneInput: GenImageInput = {
      buffer: sceneBuf,
      mimeType: sceneAbs.toLowerCase().endsWith(".png")
        ? "image/png"
        : sceneAbs.toLowerCase().endsWith(".webp")
          ? "image/webp"
          : "image/jpeg",
    };

    const productInputs: GenImageInput[] = [];
    for (const f of productFiles) {
      const buffer = Buffer.from(await f.arrayBuffer());
      productInputs.push({ buffer, mimeType: f.type || "image/jpeg" });
    }

    // ---------- 构造 prompt 共用片段 ----------
    const garmentAttrsText = formatGarmentAttrs(garmentAttrs);
    const materialDetailsText = formatMaterialDetails(materials);
    const realismConstraintsText = formatRealismConstraints(realism);
    const photographyParamsText = photography?.params_text || "";

    const qualityHintText = `【输出质量 / Output Quality】${
      qualityLevel === "4k" ? "4K 超清" : qualityLevel === "2k" ? "2K 高清" : "HD 清晰"
    }
- 必须输出 ${qualityLevel.toUpperCase()} 级别的清晰锐利图像
- 即使输入模糊也要 REDRAW / 重新渲染整张图，让它清晰锐利
- 所有细节（面料纹理 / 蕾丝针脚 / 发丝 / 皮肤毛孔）必须清晰可辨
- 参考标准：专业电商摄影 / 时尚杂志精修直出
- 关键词：sharp focus, crystal clear, ultra-detailed, high-resolution, photorealistic

【构图约束 / Composition - 非常重要】
- **模特必须位于画面中心区域**，水平居中或居中偏左 40-60%，不靠边缘
- 模特完整呈现，**不能被裁切**（头顶 / 脚 / 手臂 / 裙摆都要在画面内）
- 高分辨率输出时保持构图稳定，不因画幅变大而偏移主体或留过多空白`;

    // ---------- 确保输出目录 ----------
    const outputsDir = path.join(DATA_DIR_PATH, "outputs");
    await fs.mkdir(outputsDir, { recursive: true });

    // ---------- 并发 + 重试生成 ----------
    const concurrency = recommendConcurrency(model);
    console.log(
      `[/api/batch-photo] 开始生成 ${poses.length} 张，模型 ${model}，并发 ${concurrency}`,
    );

    const outcomes = await runWithConcurrency(poses, concurrency, async (pose) => {
      const poseStartedAt = Date.now();
      const promptVars: Record<string, string> = {
        n: "1",
        garment_attrs: garmentAttrsText,
        material_details: materialDetailsText,
        pose: `${pose.name}：${pose.text}`,
        photography_params: photographyParamsText,
        realism_constraints: realismConstraintsText,
        user_seed: userSeed ? `【用户补充指令】${userSeed}` : "",
        identity_name: identity.name,
        scene_name: scene.name,
      };
      const filledTemplate = fillTemplate(template.template, promptVars);
      const finalPrompt = `${filledTemplate}\n\n${qualityHintText}`;
      const parts: GenImageInput[] = [
        ...productInputs,
        identityInput,
        sceneInput,
      ];

      // qualityLevel → imageSize（仅 Pro Image 真实放大；Flash 会忽略）
      const imageSize: "1K" | "2K" | "4K" =
        qualityLevel === "4k" ? "4K" : qualityLevel === "2k" ? "2K" : "1K";

      const gen = await retryWithBackoff(
        () =>
          generateImage(parts, finalPrompt, model, {
            aspectRatio,
            imageSize,
          }),
        {
          onRetry: (e, attempt, delay) => {
            console.warn(
              `[batch-photo retry] pose=${pose.name} attempt=${attempt} delay=${Math.round(delay)}ms: ${
                e instanceof Error ? e.message.slice(0, 100) : String(e)
              }`,
            );
          },
        },
      );

      const ext = gen.mimeType.includes("png") ? "png" : "jpg";
      const filename = `batch_${user.id}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const filePath = path.join(outputsDir, filename);
      await fs.writeFile(filePath, gen.data);

      // 每张图一条 usage_records
      recordUsage({
        userId: user.id,
        model,
        feature: "batch_photo",
        usageMetadata: gen.usageMetadata,
        success: true,
        notes: {
          pose: pose.name,
          identity: identity.name,
          scene: scene.name,
          aspect_ratio: aspectRatio,
          quality_level: qualityLevel,
          image_size: imageSize,
        },
      });

      return {
        filename,
        duration_ms: Date.now() - poseStartedAt,
      };
    });

    const results: BatchResult[] = outcomes.map((o, i) => {
      const pose = poses[i];
      if (o.error) {
        return {
          pose_id: pose.id,
          pose_name: pose.name,
          pose_type: pose.type,
          success: false,
          error:
            o.error instanceof Error ? o.error.message : String(o.error),
        };
      }
      return {
        pose_id: pose.id,
        pose_name: pose.name,
        pose_type: pose.type,
        success: true,
        image_url: `/assets/outputs/${o.value!.filename}`,
        duration_ms: o.value!.duration_ms,
      };
    });

    // ---------- 记录生成历史 ----------
    db.prepare(
      `INSERT INTO generations (user_id, kind, output_images, params, duration_ms, success)
       VALUES (?, 'on_model', ?, ?, ?, ?)`,
    ).run(
      user.id,
      JSON.stringify(results.filter((r) => r.success).map((r) => r.image_url)),
      JSON.stringify({
        model,
        aspect_ratio: aspectRatio || null,
        quality_level: qualityLevel,
        identity_id: identity.id,
        identity_name: identity.name,
        scene_id: scene.id,
        scene_name: scene.name,
        template_id: template.id,
        template_name: template.name,
        photography_id: photography ? photographyId : null,
        photography_name: photography?.name ?? null,
        realism_id: realism?.id ?? null,
        realism_name: realism?.name ?? null,
        pose_ids: poses.map((p) => p.id),
        pose_names: poses.map((p) => p.name),
        material_ids: materials.map((m) => m.id),
        material_names: materials.map((m) => m.name),
        has_garment_attrs: Boolean(garmentAttrsText),
        user_seed: userSeed || null,
        product_image_count: productFiles.length,
      }),
      Date.now() - startedAt,
      results.some((r) => r.success) ? 1 : 0,
    );

    return NextResponse.json({ results, model });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/batch-photo] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
