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
import { recordUsage } from "@/lib/usage";
import { assertWithinBudget, getUserBudgetStatus } from "@/lib/pricing";
import { createJob } from "@/lib/jobs-db";
import { startJobWorker, type HandlerContext } from "@/lib/job-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

type PoseRow = { id: number; name: string; text: string; type: string };

/**
 * POST /api/jobs/batch-photo（异步版本）
 *
 * 与 /api/batch-photo 相同的输入格式，但返回 job_id 而不是等所有图生成完。
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    assertWithinBudget(user.id, user.role);
    const db = getDb();

    const formData = await req.formData();

    // ─── 产品图 ───
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

    // ─── 加载素材元信息 ───
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

    // ─── 创建 job（items = 一个 pose 一个）───
    const job = createJob({
      user_id: user.id,
      feature: "batch_photo",
      model,
      items: poses.map((p) => ({ label: p.name })),
      params: {
        aspect_ratio: aspectRatio ?? null,
        quality_level: qualityLevel,
        user_seed: userSeed,
        identity: {
          id: identity.id,
          name: identity.name,
          image_path: identity.image_path,
        },
        scene: {
          id: scene.id,
          name: scene.name,
          image_path: scene.image_path,
        },
        template: {
          id: template.id,
          name: template.name,
          template: template.template,
        },
        photography_params_text: photography?.params_text ?? "",
        photography_name: photography?.name ?? null,
        photography_id: photographyId,
        realism_id: realism?.id ?? null,
        realism_name: realism?.name ?? null,
        realism_constraints_text: formatRealismConstraints(realism),
        garment_attrs_text: formatGarmentAttrs(garmentAttrs),
        material_details_text: formatMaterialDetails(materials),
        material_ids: materials.map((m) => m.id),
        material_names: materials.map((m) => m.name),
        poses: poses.map((p) => ({
          id: p.id,
          name: p.name,
          text: p.text,
          type: p.type,
        })),
        product_image_count: productFiles.length,
      },
    });

    // ─── 把产品图落盘到 job 目录 ───
    const inputsDir = path.join(DATA_DIR_PATH, "job-inputs", job.id);
    await fs.mkdir(inputsDir, { recursive: true });
    const savedPaths: string[] = [];
    const savedMimes: string[] = [];
    for (let i = 0; i < productFiles.length; i++) {
      const f = productFiles[i];
      const ext =
        f.type === "image/png"
          ? "png"
          : f.type === "image/webp"
            ? "webp"
            : "jpg";
      const filename = `product_${i}.${ext}`;
      const abs = path.join(inputsDir, filename);
      await fs.writeFile(abs, Buffer.from(await f.arrayBuffer()));
      savedPaths.push(abs);
      savedMimes.push(f.type || "image/jpeg");
    }

    // 把 product_paths 补进 params
    const existingParams = safeParseParams(job.params);
    db.prepare(`UPDATE render_jobs SET params = ? WHERE id = ?`).run(
      JSON.stringify({
        ...existingParams,
        product_paths: savedPaths,
        product_mime_types: savedMimes,
      }),
      job.id,
    );

    const outputsDir = path.join(DATA_DIR_PATH, "outputs");
    await fs.mkdir(outputsDir, { recursive: true });

    // ─── 启动后台 worker ───
    startJobWorker(
      job.id,
      async (ctx: HandlerContext) => {
        return batchPhotoItemHandler(ctx, outputsDir);
      },
      {
        onJobEnd: async () => {
          try {
            await fs.rm(inputsDir, { recursive: true, force: true });
          } catch {}
        },
      },
    );

    return NextResponse.json({
      job_id: job.id,
      total_count: job.total_count,
      model,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/jobs/batch-photo] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}

/* ─────────── worker 处理单条 item（单个姿势） ─────────── */

async function batchPhotoItemHandler(
  ctx: HandlerContext,
  outputsDir: string,
): Promise<{
  result_image_path: string;
  result_image_url: string;
  input_tokens: number | undefined;
  output_tokens: number | undefined;
}> {
  const p = ctx.params as {
    aspect_ratio?: string | null;
    quality_level?: "hd" | "2k" | "4k";
    user_seed?: string;
    identity: { id: number; name: string; image_path: string };
    scene: { id: number; name: string; image_path: string };
    template: { id: number; name: string; template: string };
    photography_params_text?: string;
    realism_constraints_text?: string;
    garment_attrs_text?: string;
    material_details_text?: string;
    poses: Array<{ id: number; name: string; text: string; type: string }>;
    product_paths: string[];
    product_mime_types: string[];
  };

  const pose = p.poses[ctx.item.idx];
  if (!pose) throw new Error(`pose[${ctx.item.idx}] 丢失`);

  // 预算兜底
  const status = getUserBudgetStatus(ctx.userId);
  if (!status.is_unlimited && status.remaining_cny <= 0) {
    throw new Error(
      `本月预算已用完（¥${status.used_this_month_cny.toFixed(2)}），剩余任务已跳过`,
    );
  }

  // 读模特图 + 场景图 + 产品图
  const identityAbs = path.join(DATA_DIR_PATH, p.identity.image_path);
  const sceneAbs = path.join(DATA_DIR_PATH, p.scene.image_path);

  const [identityBuf, sceneBuf] = await Promise.all([
    fs.readFile(identityAbs),
    fs.readFile(sceneAbs),
  ]);

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
  for (let i = 0; i < p.product_paths.length; i++) {
    const buf = await fs.readFile(p.product_paths[i]);
    productInputs.push({
      buffer: buf,
      mimeType: p.product_mime_types[i] || "image/jpeg",
    });
  }

  const qualityLevel = p.quality_level || "2k";
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

  const promptVars: Record<string, string> = {
    n: "1",
    garment_attrs: p.garment_attrs_text || "",
    material_details: p.material_details_text || "",
    pose: `${pose.name}：${pose.text}`,
    photography_params: p.photography_params_text || "",
    realism_constraints: p.realism_constraints_text || "",
    user_seed: p.user_seed ? `【用户补充指令】${p.user_seed}` : "",
    identity_name: p.identity.name,
    scene_name: p.scene.name,
  };
  const filledTemplate = p.template.template.replace(
    /\{\{(\w+)\}\}/g,
    (_m, key: string) => promptVars[key] ?? "",
  );
  const finalPrompt = `${filledTemplate}\n\n${qualityHintText}`;

  const parts: GenImageInput[] = [...productInputs, identityInput, sceneInput];

  const imageSize: "1K" | "2K" | "4K" =
    qualityLevel === "4k" ? "4K" : qualityLevel === "hd" ? "1K" : "2K";

  const gen = await retryWithBackoff(
    () =>
      generateImage(parts, finalPrompt, ctx.job.model, {
        aspectRatio: p.aspect_ratio ?? undefined,
        imageSize,
      }),
    {
      onRetry: (e, attempt, delay) => {
        console.warn(
          `[batch-photo retry] job=${ctx.job.id} pose=${pose.name} attempt=${attempt} delay=${Math.round(delay)}ms: ${
            e instanceof Error ? e.message.slice(0, 100) : String(e)
          }`,
        );
      },
    },
  );

  const ext = gen.mimeType.includes("png") ? "png" : "jpg";
  const filename = `batch_${ctx.userId}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;
  const filePath = path.join(outputsDir, filename);
  await fs.writeFile(filePath, gen.data);

  recordUsage({
    userId: ctx.userId,
    model: ctx.job.model,
    feature: "batch_photo",
    usageMetadata: gen.usageMetadata,
    success: true,
    notes: {
      job_id: ctx.job.id,
      pose: pose.name,
      identity: p.identity.name,
      scene: p.scene.name,
      aspect_ratio: p.aspect_ratio,
      quality_level: qualityLevel,
      image_size: imageSize,
    },
  });

  return {
    result_image_path: `outputs/${filename}`,
    result_image_url: `/assets/outputs/${filename}`,
    input_tokens: gen.usageMetadata?.promptTokenCount ?? undefined,
    output_tokens: gen.usageMetadata?.candidatesTokenCount ?? undefined,
  };
}

function safeParseParams(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}
