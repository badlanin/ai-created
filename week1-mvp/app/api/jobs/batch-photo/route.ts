import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { getDb, DATA_DIR_PATH } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatGarmentAttrs } from "@/lib/gemini-image";
import { generateImage, estimateImageCostUSD } from "@/lib/image-gen";
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
import { pickShoeSpec } from "@/lib/shoe-spec";
import {
  FRAMING_TIGHT_SINGLE,
  getVariantCameraHint,
} from "@/lib/scene-tools-prompt";
import { buildImageManifest } from "@/lib/image-input-manifest";

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
    const templateId = Number(formData.get("template_id"));
    if (!Number.isFinite(identityId))
      return NextResponse.json({ error: "请选择模特" }, { status: 400 });
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

    const expressionIdRaw = formData.get("expression_id");
    const expressionId =
      typeof expressionIdRaw === "string" && expressionIdRaw.trim()
        ? Number(expressionIdRaw)
        : null;

    const poseIdsRaw = formData.get("pose_ids");
    let poseIds: number[] = [];
    try {
      const parsed = JSON.parse(String(poseIdsRaw || "[]"));
      if (Array.isArray(parsed)) {
        poseIds = parsed.filter((v) => Number.isFinite(v));
      }
    } catch {}

    const solidColorEnabledRaw = formData.get("solid_color_enabled");
    const solidColorEnabled =
      solidColorEnabledRaw === "1" ||
      solidColorEnabledRaw === "true";

    const shouldGenerateSolidPoses = solidColorEnabled && poseIds.length > 0;

    if (poseIds.length > 10) {
      return NextResponse.json(
        { error: "一次最多 10 个姿势" },
        { status: 400 },
      );
    }

    // ─── 纯色背景（可选；未选中时不生成纯色图）───
    const solidColorHexRaw = formData.get("solid_color_hex");
    const solidColorHex = (() => {
      const v = typeof solidColorHexRaw === "string" ? solidColorHexRaw.trim() : "";
      return /^#[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : "#F5F1EA";
    })();
    const solidColorNameRaw = formData.get("solid_color_name");
    const solidColorName =
      typeof solidColorNameRaw === "string" && solidColorNameRaw.trim()
        ? solidColorNameRaw.trim().slice(0, 20)
        : "浅米色";
    const effectiveSolidColorHex = solidColorEnabled
      ? solidColorHex
      : "#F5F1EA";
    const effectiveSolidColorName = solidColorEnabled
      ? solidColorName
      : "浅米色";

    // ─── 额外场景 + 数量（可选 ≤2 张场景，每张 1..5 张图）───
    // 新版语义：不再绑定固定 pose，姿势由模型按场景物件自由互动生成。
    // 兼容旧的 extra_scene_pose_pairs 字段（前端切换前的请求），自动转成 count=1
    const extraCountPairsRaw = formData.get("extra_scene_count_pairs");
    const extraPosePairsRaw = formData.get("extra_scene_pose_pairs");
    let extraPairs: Array<{ scene_id: number; count: number }> = [];
    try {
      if (typeof extraCountPairsRaw === "string" && extraCountPairsRaw.trim()) {
        const parsed = JSON.parse(extraCountPairsRaw);
        if (Array.isArray(parsed)) {
          extraPairs = parsed
            .filter(
              (p): p is { scene_id: number; count: number } =>
                typeof p === "object" &&
                p !== null &&
                Number.isFinite((p as { scene_id?: unknown }).scene_id) &&
                Number.isFinite((p as { count?: unknown }).count),
            )
            .map((p) => ({
              scene_id: Number(p.scene_id),
              count: Math.min(5, Math.max(1, Number(p.count) || 1)),
            }));
        }
      } else if (
        typeof extraPosePairsRaw === "string" &&
        extraPosePairsRaw.trim()
      ) {
        // 老前端字段兼容：每张场景算 count=1
        const parsed = JSON.parse(extraPosePairsRaw);
        if (Array.isArray(parsed)) {
          const seen = new Set<number>();
          for (const p of parsed) {
            const sid = Number(
              (p as { scene_id?: unknown })?.scene_id,
            );
            if (!Number.isFinite(sid) || seen.has(sid)) continue;
            seen.add(sid);
            extraPairs.push({ scene_id: sid, count: 1 });
          }
        }
      }
    } catch {}
    if (extraPairs.length > 2) extraPairs = extraPairs.slice(0, 2);

    // ─── 额外文字场景 + 数量（可选 ≤2 条，每条 1..5 张图）───
    // 可附带 scene_id：用于把文字预设缩略图对应的场景图也传给模型。
    // 后端展开成 extra_text_items，worker 走文字场景路径。
    const extraTextPairsRaw = formData.get("extra_text_scene_pairs");
    let extraTextPairs: Array<{
      text: string;
      count: number;
      scene_id: number | null;
    }> = [];
    try {
      if (
        typeof extraTextPairsRaw === "string" &&
        extraTextPairsRaw.trim()
      ) {
        const parsed = JSON.parse(extraTextPairsRaw);
        if (Array.isArray(parsed)) {
          extraTextPairs = parsed
            .filter(
              (p): p is { text: string; count: number; scene_id?: unknown } =>
                typeof p === "object" &&
                p !== null &&
                typeof (p as { text?: unknown }).text === "string" &&
                (p as { text: string }).text.trim().length > 0 &&
                Number.isFinite((p as { count?: unknown }).count),
            )
            .map((p) => ({
              text: String(p.text).trim().slice(0, 500),
              count: Math.min(5, Math.max(1, Number(p.count) || 1)),
              scene_id: Number.isFinite(Number(p.scene_id))
                ? Number(p.scene_id)
                : null,
            }));
        }
      }
    } catch {}
    if (extraTextPairs.length > 2) extraTextPairs = extraTextPairs.slice(0, 2);

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
    const qualityLevel: "1k" | "hd" | "2k" | "4k" =
      qualityLevelRaw === "1k" ||
      qualityLevelRaw === "hd" ||
      qualityLevelRaw === "2k" ||
      qualityLevelRaw === "4k"
        ? qualityLevelRaw
        : "1k";

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

    // 加载额外场景（如果有）；必须 usage='single'
    type ExtraScene = { id: number; name: string; image_path: string };
    const extraScenes: Map<number, ExtraScene> = new Map();
    const sceneIdSet = [
      ...new Set([
        ...extraPairs.map((p) => p.scene_id),
        ...extraTextPairs
          .map((p) => p.scene_id)
          .filter((id): id is number => Number.isFinite(id)),
      ]),
    ];
    if (sceneIdSet.length > 0) {
      const ph = sceneIdSet.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT id, name, image_path, usage FROM scenes WHERE id IN (${ph})`,
        )
        .all(...sceneIdSet) as Array<ExtraScene & { usage: string }>;
      if (rows.length !== sceneIdSet.length) {
        return NextResponse.json(
          { error: "部分额外场景或文字场景参考图不存在" },
          { status: 404 },
        );
      }
      for (const r of rows) {
        if (r.usage !== "single") {
          return NextResponse.json(
            { error: `场景"${r.name}"不属于主图场景库` },
            { status: 400 },
          );
        }
        extraScenes.set(r.id, {
          id: r.id,
          name: r.name,
          image_path: r.image_path,
        });
      }
    }

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

    // 表情：用户指定 → 该 ID；未指定 → 默认表情（is_default=1）；都没有 → null
    const expression = (() => {
      if (expressionId) {
        const r = db
          .prepare(`SELECT id, name, text FROM expressions WHERE id = ?`)
          .get(expressionId) as
          | { id: number; name: string; text: string }
          | undefined;
        if (r) return r;
      }
      return db
        .prepare(
          `SELECT id, name, text FROM expressions WHERE is_default = 1 ORDER BY sort_order ASC LIMIT 1`,
        )
        .get() as { id: number; name: string; text: string } | undefined;
    })();

    let poses: PoseRow[] = [];
    if (poseIds.length > 0) {
      const placeholders = poseIds.map(() => "?").join(",");
      poses = db
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
    }

    const materials = getMaterialsByIds(materialIds);

    // 同一个 batch 共享一个 random seed，保证多张图模特脸/光线/背景的一致性
    const batchSeed = Math.floor(Math.random() * 2_147_483_647);

    // 整批锁定一种鞋型：根据服装主色调决定颜色（裸/黑/银/香槟金），
    // 款式 / 跟高 / 材质固定。每张图 prompt 里注入同一份 → 大幅提升鞋的一致性
    const shoeSpec = pickShoeSpec(garmentAttrs);

    // ─── 解析 extra_pairs → 按 count 展开成多个 item ───
    // 有选中姿势时，额外场景按姿势列表轮流绑定；没选姿势时保持自由互动。
    type ExtraItemResolved = {
      scene_id: number;
      scene_name: string;
      scene_image_path: string;
      variant_idx: number; // 这张场景的第几张变体（1..count）
      variant_total: number; // 这张场景总共 count 张
      pose_id?: number;
      pose_name?: string;
      pose_text?: string;
      pose_type?: string;
    };
    const resolvedExtraItems: ExtraItemResolved[] = [];
    for (const pair of extraPairs) {
      const s = extraScenes.get(pair.scene_id);
      if (!s) continue;
      for (let v = 1; v <= pair.count; v++) {
        const scenePose =
          poses.length > 0
            ? poses[resolvedExtraItems.length % poses.length]
            : null;
        resolvedExtraItems.push({
          scene_id: s.id,
          scene_name: s.name,
          scene_image_path: s.image_path,
          variant_idx: v,
          variant_total: pair.count,
          pose_id: scenePose?.id,
          pose_name: scenePose?.name,
          pose_text: scenePose?.text,
          pose_type: scenePose?.type,
        });
      }
    }

    // ─── 解析 extra_text_pairs → 按 count 展开成多个文字场景 item ───
    type ExtraTextItemResolved = {
      text: string;
      scene_id: number | null;
      scene_name: string | null;
      scene_image_path: string | null;
      variant_idx: number;
      variant_total: number;
    };
    const resolvedExtraTextItems: ExtraTextItemResolved[] = [];
    for (const pair of extraTextPairs) {
      for (let v = 1; v <= pair.count; v++) {
        const scene = pair.scene_id ? extraScenes.get(pair.scene_id) : null;
        resolvedExtraTextItems.push({
          text: pair.text,
          scene_id: scene?.id ?? null,
          scene_name: scene?.name ?? null,
          scene_image_path: scene?.image_path ?? null,
          variant_idx: v,
          variant_total: pair.count,
        });
      }
    }

    // ─── items = N 纯色姿势 + 所有图片场景变体 + 所有文字场景变体 ───
    const solidItems = shouldGenerateSolidPoses
      ? poses.map((p) => ({
          label: `${p.name} · ${effectiveSolidColorName}`,
        }))
      : [];
    const extraItems = resolvedExtraItems.map((it) => ({
      label:
        it.variant_total > 1
          ? `${it.scene_name} · ${it.pose_name ? `${it.pose_name} · ` : ""}变体 ${it.variant_idx}/${it.variant_total}`
          : it.pose_name
            ? `${it.scene_name} · ${it.pose_name}`
            : it.scene_name,
    }));
    const extraTextItemsForJob = resolvedExtraTextItems.map((it) => {
      const shortText =
        it.text.length > 14 ? it.text.slice(0, 14) + "…" : it.text;
      const imageTag = it.scene_name ? ` · 参考图 ${it.scene_name}` : "";
      return {
        label:
          it.variant_total > 1
            ? `文字场景"${shortText}"${imageTag} · 变体 ${it.variant_idx}/${it.variant_total}`
            : `文字场景"${shortText}"${imageTag}`,
      };
    });
    const allItems = [...solidItems, ...extraItems, ...extraTextItemsForJob];
    if (allItems.length === 0) {
      return NextResponse.json(
        { error: "请至少选择一个姿势或添加一个额外场景" },
        { status: 400 },
      );
    }

    // ─── 创建 job ───
    const job = createJob({
      user_id: user.id,
      feature: "batch_photo",
      model,
      items: allItems,
      params: {
        aspect_ratio: aspectRatio ?? null,
        quality_level: qualityLevel,
        user_seed: userSeed,
        batch_seed: batchSeed,
        identity: {
          id: identity.id,
          name: identity.name,
          image_path: identity.image_path,
        },
        // item 分三段（按 idx 顺序）：
        //   0..solid_pose_count: 纯色姿势（poses 表对应）
        //   solid_pose_count..solid+image_scene: 图片场景变体（extra_items[i]）
        //   solid+image_scene..end: 文字场景变体（extra_text_items[i]）
        solid_color_enabled: shouldGenerateSolidPoses,
        solid_pose_count: solidItems.length,
        image_scene_count: resolvedExtraItems.length,
        solid_color_hex: effectiveSolidColorHex,
        solid_color_name: effectiveSolidColorName,
        extra_items: resolvedExtraItems,
        extra_text_items: resolvedExtraTextItems,
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
        expression_id: expression?.id ?? null,
        expression_name: expression?.name ?? null,
        expression_text: expression?.text ?? "",
        garment_attrs_text: formatGarmentAttrs(garmentAttrs),
        shoe_spec: shoeSpec,
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

/* ─────────── worker 处理单条 item ─────────── */

/** 纯色背景指令（替代 FRAMING_TIGHT_SINGLE，仅用于纯色 item） */
function buildSolidBgInstruction(colorName: string, hex: string): string {
  return `══════════════════════════════════════════════════════════
🎨 BACKGROUND — Pure solid color (NO scene image is provided)
══════════════════════════════════════════════════════════

The background MUST be a CLEAN SEAMLESS SOLID COLOR studio backdrop:
- Color: ${colorName} (HEX ${hex})
- NO texture, NO gradient falloff to edges, NO darker corners
- NO architectural elements, NO furniture, NO props of any kind
- Pure flat single-color seamless studio sweep behind the model

Lighting: soft frontal studio key light + gentle fill, even illumination
on the model. No harsh shadows. Subject is centered with realistic body
proportion. Full-body or 3/4-body framing depending on pose.

Output should look like a clean e-commerce product-on-model photograph
shot in a studio with this exact backdrop color.`;
}

async function batchPhotoItemHandler(
  ctx: HandlerContext,
  outputsDir: string,
): Promise<{
  result_image_path: string;
  result_image_url: string;
  input_tokens: number | undefined;
  output_tokens: number | undefined;
  cost_cny: number | undefined;
}> {
  const p = ctx.params as {
    aspect_ratio?: string | null;
    quality_level?: "1k" | "hd" | "2k" | "4k";
    user_seed?: string;
    batch_seed?: number;
    identity: { id: number; name: string; image_path: string };
    solid_color_enabled?: boolean;
    solid_pose_count: number;
    image_scene_count?: number; // 新增：图片场景变体数量（用于分段 idx）
    solid_color_hex?: string | null;
    solid_color_name?: string | null;
    // 新版：每个 extra item 是"场景 + 变体 idx"，可选绑定用户选中的 pose
    extra_items?: Array<{
      scene_id: number;
      scene_name: string;
      scene_image_path: string;
      variant_idx: number;
      variant_total: number;
      pose_id?: number;
      pose_name?: string;
      pose_text?: string;
      pose_type?: string;
    }>;
    // 文字场景 items（与 extra_items 平行，走 buildSceneShootText 路径）
    extra_text_items?: Array<{
      text: string;
      scene_id?: number | null;
      scene_name?: string | null;
      scene_image_path?: string | null;
      variant_idx: number;
      variant_total: number;
    }>;
    // 老版兼容：万一从老 job 恢复出来的 params 还带这字段
    extra_pairs?: Array<{
      scene_id: number;
      scene_name: string;
      scene_image_path: string;
      pose_id: number;
      pose_name: string;
      pose_text: string;
      pose_type: string;
    }>;
    template: { id: number; name: string; template: string };
    photography_params_text?: string;
    realism_constraints_text?: string;
    expression_id?: number | null;
    expression_name?: string | null;
    expression_text?: string;
    garment_attrs_text?: string;
    shoe_spec?: string;
    material_details_text?: string;
    poses: Array<{ id: number; name: string; text: string; type: string }>;
    product_paths: string[];
    product_mime_types: string[];
  };

  // ── 分支：纯色 vs 场景 ──
  const idx = ctx.item.idx;
  const solidCount = p.solid_pose_count;
  const imageSceneCount =
    p.image_scene_count ?? (p.extra_items?.length ?? 0);
  const isSolid = idx < solidCount;
  const isImageScene = !isSolid && idx < solidCount + imageSceneCount;
  let pose: { id: number; name: string; text: string; type: string };
  let sceneNameForPrompt: string;
  let sceneImagePath: string | null;
  let framingBlock: string;

  if (isSolid) {
    const po = p.poses[idx];
    if (!po) throw new Error(`solid pose[${idx}] 丢失`);
    const solidColorName = p.solid_color_name || "浅米色";
    const solidColorHex = p.solid_color_hex || "#F5F1EA";
    pose = po;
    sceneNameForPrompt = `纯色背景（${solidColorName}，${solidColorHex}）`;
    sceneImagePath = null;
    framingBlock = buildSolidBgInstruction(solidColorName, solidColorHex);
  } else if (isImageScene) {
    const extraIdx = idx - solidCount;
    // 优先用新版 extra_items；老 job 的 params 走 extra_pairs 兜底
    const extraItems = p.extra_items;
    const extraPairs = p.extra_pairs;
    if (extraItems && extraItems[extraIdx]) {
      const it = extraItems[extraIdx];
      sceneNameForPrompt = it.scene_name;
      sceneImagePath = it.scene_image_path;
      if (it.pose_id && it.pose_name && it.pose_text && it.pose_type) {
        pose = {
          id: it.pose_id,
          name: it.pose_name,
          text: `在场景图（IMAGE 4）中保持该姿势：${it.pose_text}`,
          type: it.pose_type,
        };
      } else {
        // 未选姿势时保持原自由互动逻辑，让模型按场景物件互动。
        const cameraHint = getVariantCameraHint(
          it.variant_idx,
          it.variant_total,
        );
        pose = {
          id: 0,
          name:
            it.variant_total > 1
              ? `变体 ${it.variant_idx}/${it.variant_total}`
              : "自由互动",
          text: `按场景图（IMAGE 4）里的家具 / 门 / 桌子 / 道具自然互动，挑 1-2 个物件发生动作（坐 / 倚 / 撑 / 拿 / 触摸 / 走过）。姿势从场景里"长出来"，不要站正中央 + 双手垂直。${cameraHint}`,
          type: "full",
        };
      }
    } else if (extraPairs && extraPairs[extraIdx]) {
      // 老 job 兜底：保留原 pose
      const pair = extraPairs[extraIdx];
      pose = {
        id: pair.pose_id,
        name: pair.pose_name,
        text: pair.pose_text,
        type: pair.pose_type,
      };
      sceneNameForPrompt = pair.scene_name;
      sceneImagePath = pair.scene_image_path;
    } else {
      throw new Error(`extra item[${extraIdx}] 丢失`);
    }
    framingBlock = FRAMING_TIGHT_SINGLE;
  } else {
    // 文字场景：可选附带 scene image；没有图时只按文字生成。
    const textIdx = idx - solidCount - imageSceneCount;
    const textItems = p.extra_text_items;
    if (!textItems || !textItems[textIdx]) {
      throw new Error(`text scene item[${textIdx}] 丢失`);
    }
    const it = textItems[textIdx];
    sceneImagePath = it.scene_image_path ?? null;
    const shortText =
      it.text.length > 20 ? it.text.slice(0, 20) + "…" : it.text;
    sceneNameForPrompt = it.scene_name
      ? `文字场景"${shortText}" + 参考图"${it.scene_name}"`
      : `文字场景"${shortText}"`;
    const cameraHint = getVariantCameraHint(
      it.variant_idx,
      it.variant_total,
    );
    pose = {
      id: 0,
      name:
        it.variant_total > 1
          ? `文字场景 · 变体 ${it.variant_idx}/${it.variant_total}`
          : "文字场景 · 自由互动",
      text: sceneImagePath
        ? `优先按场景参考图里的空间结构 / 墙面 / 家具 / 门 / 桌子 / 道具自然互动，同时用下方文字补充细节。挑 1-2 个物件发生动作（坐 / 倚 / 撑 / 拿 / 触摸 / 走过）。${cameraHint}`
        : `按下方场景文字描述里出现的物件（家具 / 门 / 桌子 / 楼梯 / 栏杆 / 道具）自然互动，挑 1-2 个发生动作（坐 / 倚 / 撑 / 拿 / 触摸 / 走过）。${cameraHint}`,
      type: "full",
    };
    framingBlock = sceneImagePath
      ? `══════════════════════════════════════════════════════════
🎬 SCENE — use the provided scene reference image + text
══════════════════════════════════════════════════════════

A scene reference image is provided as the last input image. Use it as the
primary background/layout reference: preserve its room type, main wall color,
doors/windows, furniture, floor, large props, lighting direction and overall
composition. The text below adds naming and detail; if image and text conflict,
follow the image for visual layout.

【场景文字描述】
${it.text}

${FRAMING_TIGHT_SINGLE}`
      : `══════════════════════════════════════════════════════════
🎬 SCENE — described in text below (no scene image provided)
══════════════════════════════════════════════════════════

The background scene is fully described by the text below. Render the
model into this scene as if photographed on location. Read the description
carefully — identify the furniture / doors / surfaces / props mentioned —
and have the model interact naturally with one or two of them.

【场景文字描述】
${it.text}

${FRAMING_TIGHT_SINGLE}`;
  }

  // 预算兜底
  const status = getUserBudgetStatus(ctx.userId);
  if (!status.is_unlimited && status.remaining_cny <= 0) {
    throw new Error(
      `本月预算已用完（¥${status.used_this_month_cny.toFixed(2)}），剩余任务已跳过`,
    );
  }

  // 读模特图 + (可选)场景图 + 产品图
  type ImgInput = { buffer: Buffer; mimeType: string };
  const identityAbs = path.join(DATA_DIR_PATH, p.identity.image_path);
  const identityBuf = await fs.readFile(identityAbs);
  const identityInput: ImgInput = {
    buffer: identityBuf,
    mimeType: "image/png",
  };

  let sceneInput: ImgInput | null = null;
  if (sceneImagePath) {
    const sceneAbs = path.join(DATA_DIR_PATH, sceneImagePath);
    const sceneBuf = await fs.readFile(sceneAbs);
    sceneInput = {
      buffer: sceneBuf,
      mimeType: sceneAbs.toLowerCase().endsWith(".png")
        ? "image/png"
        : sceneAbs.toLowerCase().endsWith(".webp")
          ? "image/webp"
          : "image/jpeg",
    };
  }

  const productInputs: ImgInput[] = [];
  for (let i = 0; i < p.product_paths.length; i++) {
    const buf = await fs.readFile(p.product_paths[i]);
    productInputs.push({
      buffer: buf,
      mimeType: p.product_mime_types[i] || "image/jpeg",
    });
  }

  const qualityLevel = p.quality_level || "1k";
  const qualityHintText = `【输出质量 / Output Quality】${
    qualityLevel === "4k"
      ? "4K 超清"
      : qualityLevel === "2k"
        ? "2K 高清"
        : qualityLevel === "1k"
          ? "1K 清晰"
          : "HD 清晰"
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
    // 表情维度（独立于姿势的全局描述，仅描述脸 / 眼神 / 嘴 / 视线 / 情绪）
    expression: p.expression_text || "嘴角放松微抿，眼神平和，气质沉静自然",
    photography_params: p.photography_params_text || "",
    realism_constraints: p.realism_constraints_text || "",
    user_seed: p.user_seed ? `【用户补充指令】${p.user_seed}` : "",
    identity_name: p.identity.name,
    scene_name: sceneNameForPrompt,
    // 整批锁定的鞋型描述（在 job 创建时由 pickShoeSpec 决定，所有 item 共用）
    shoe_spec: p.shoe_spec || "",
  };
  const filledTemplate = p.template.template.replace(
    /\{\{(\w+)\}\}/g,
    (_m, key: string) => promptVars[key] ?? "",
  );

  // 输入清单：按实际 input 顺序（产品 N → identity → 可选场景）动态生成 manifest
  // 修复了模板里硬写"参考图 1-2"在产品数不为 2 时索引错位的问题
  const manifest = buildImageManifest({
    productCount: productInputs.length,
    hasIdentity: true,
    hasScene: sceneInput !== null,
    sceneName: sceneInput ? sceneNameForPrompt : undefined,
  });
  const finalPrompt = `${manifest}\n${filledTemplate}\n\n${qualityHintText}\n\n${framingBlock}`;

  // 注意：纯色 item 不传 scene image
  const parts: ImgInput[] = sceneInput
    ? [...productInputs, identityInput, sceneInput]
    : [...productInputs, identityInput];

  const imageSize: "1K" | "2K" | "4K" =
    qualityLevel === "4k" ? "4K" : qualityLevel === "2k" ? "2K" : "1K";

  const gen = await retryWithBackoff(
    () =>
      generateImage({
        inputs: parts,
        prompt: finalPrompt,
        modelId: ctx.job.model,
        aspectRatio: p.aspect_ratio ?? undefined,
        imageSize,
        seed: p.batch_seed,            // 整批共享同一 seed → 模特脸 / 光线 / 背景一致（OpenAI 路径忽略）
        temperature: 0.15,             // 批次模式低温，最大化一致性（OpenAI 路径忽略）
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

  // OpenAI 走固定单价（size×quality），不走 token —— 算好覆盖记账金额
  const costOverrideUsd =
    gen.provider === "openai"
      ? estimateImageCostUSD({
          modelId: ctx.job.model,
          aspectRatio: p.aspect_ratio ?? undefined,
          imageSize,
        })
      : undefined;

  const usageRecord = recordUsage({
    userId: ctx.userId,
    model: ctx.job.model,
    feature: "batch_photo",
    usageMetadata: {
      promptTokenCount: gen.usage?.inputTokens,
      candidatesTokenCount: gen.usage?.outputTokens,
      totalTokenCount: gen.usage?.totalTokens,
    },
    success: true,
    costOverrideUsd,
    notes: {
      job_id: ctx.job.id,
      pose: pose.name,
      identity: p.identity.name,
      kind: isSolid ? "solid" : "scene",
      scene: isSolid ? null : sceneNameForPrompt,
      solid_color_hex: isSolid ? (p.solid_color_hex ?? null) : null,
      aspect_ratio: p.aspect_ratio,
      quality_level: qualityLevel,
      image_size: imageSize,
      provider: gen.provider,
    },
  });

  return {
    result_image_path: `outputs/${filename}`,
    result_image_url: `/assets/outputs/${filename}`,
    input_tokens: gen.usage?.inputTokens ?? undefined,
    output_tokens: gen.usage?.outputTokens ?? undefined,
    cost_cny: usageRecord?.cost_cny ?? undefined,
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
