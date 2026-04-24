import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { getDb, DATA_DIR_PATH } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  buildRecolorPrompt,
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
// 创建任务本身很快（只需把文件落盘 + 插 DB），所以 60s 够了
export const maxDuration = 60;

type ColorRow = { id: number; name: string; hex: string };

/**
 * POST /api/jobs/recolor（异步版本）
 *
 * 行为：
 *   1. 接收 formData，校验参数
 *   2. 把上传的产品图落盘到 DATA_DIR/inputs/<job_id>/
 *   3. 创建 render_jobs + render_job_items（每个 color×image 组合一条 item）
 *   4. 启动后台 worker（fire-and-forget）
 *   5. 立即返回 { job_id, total_count }
 *
 * 前端拿到 job_id 后轮询 GET /api/jobs/:id 看进度。
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    assertWithinBudget(user.id, user.role);
    const db = getDb();

    const formData = await req.formData();

    // ─── 解析上传图 ───
    const uploadedFiles: File[] = [];
    const legacyImage = formData.get("image");
    if (legacyImage instanceof File) uploadedFiles.push(legacyImage);
    for (const [key, value] of formData.entries()) {
      if (/^image\d+$/.test(key) && value instanceof File) {
        uploadedFiles.push(value);
      }
    }
    if (uploadedFiles.length === 0) {
      return NextResponse.json(
        { error: "请上传至少一张产品图" },
        { status: 400 },
      );
    }
    if (uploadedFiles.length > 5) {
      return NextResponse.json(
        { error: "一次最多上传 5 张图片" },
        { status: 400 },
      );
    }

    // ─── 解析其他 formData ───
    const colorIdsRaw = formData.get("color_ids");
    const customColorsRaw = formData.get("custom_colors");
    const modelRaw = formData.get("model");
    const model = resolveModelId(
      "image_gen",
      typeof modelRaw === "string" ? modelRaw : undefined,
    );

    const materialIdsRaw = formData.get("material_ids");
    let materialIds: number[] = [];
    if (typeof materialIdsRaw === "string" && materialIdsRaw.trim()) {
      try {
        const parsed = JSON.parse(materialIdsRaw);
        if (Array.isArray(parsed)) {
          materialIds = parsed.filter((v) => Number.isFinite(v));
        }
      } catch {}
    }

    const realismIdRaw = formData.get("realism_id");
    const realismId =
      typeof realismIdRaw === "string" && realismIdRaw.trim()
        ? Number(realismIdRaw)
        : null;

    const garmentAttrsRaw = formData.get("garment_attrs");
    let garmentAttrs: Record<string, string | string[]> | null = null;
    if (typeof garmentAttrsRaw === "string" && garmentAttrsRaw.trim()) {
      try {
        garmentAttrs = JSON.parse(garmentAttrsRaw);
      } catch {}
    }

    const userSeed =
      typeof formData.get("user_seed") === "string"
        ? String(formData.get("user_seed")).trim()
        : "";

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

    // ─── 解析颜色列表 ───
    let colorsToApply: ColorRow[] = [];
    if (typeof colorIdsRaw === "string" && colorIdsRaw.trim()) {
      const ids = JSON.parse(colorIdsRaw) as number[];
      if (!Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json(
          { error: "color_ids 必须是非空数组" },
          { status: 400 },
        );
      }
      const placeholders = ids.map(() => "?").join(",");
      colorsToApply = db
        .prepare(
          `SELECT id, name, hex FROM colors WHERE id IN (${placeholders})`,
        )
        .all(...ids) as ColorRow[];
    }
    if (typeof customColorsRaw === "string" && customColorsRaw.trim()) {
      const custom = JSON.parse(customColorsRaw) as Array<{
        name: string;
        hex: string;
      }>;
      colorsToApply = [
        ...colorsToApply,
        ...custom.map((c, i) => ({
          id: -(i + 1),
          name: c.name,
          hex: c.hex,
        })),
      ];
    }
    if (colorsToApply.length === 0) {
      return NextResponse.json(
        { error: "请至少选择一个目标颜色" },
        { status: 400 },
      );
    }
    if (colorsToApply.length > 10) {
      return NextResponse.json(
        { error: "一次最多 10 个颜色" },
        { status: 400 },
      );
    }

    // ─── 把上传图落盘到 job 专属目录 ───
    // 先要有 job_id 才能建目录，但创建 job 又需要 items 数组 —— 所以先算好 items
    const imageLabels: string[] = uploadedFiles.map(
      (f, i) => f.name || `image${i + 1}`,
    );

    // 构造 item 列表（按 color × image 笛卡尔积展平）
    const items: Array<{
      label: string;
      colorId: number;
      colorName: string;
      hex: string;
      imgIdx: number;
      imageLabel: string;
    }> = [];
    for (const c of colorsToApply) {
      for (let imgIdx = 0; imgIdx < uploadedFiles.length; imgIdx++) {
        items.push({
          label:
            uploadedFiles.length > 1
              ? `${c.name} - ${imageLabels[imgIdx]}`
              : c.name,
          colorId: c.id,
          colorName: c.name,
          hex: c.hex,
          imgIdx,
          imageLabel: imageLabels[imgIdx],
        });
      }
    }

    // ─── 先创建 job，拿到 job_id 后落盘图 ───
    // 材质 / 真实感 / 款式（给 worker 用的文本）都预先算好塞 params
    const materials = getMaterialsByIds(materialIds);
    const realismPreset = getRealismPreset(realismId);
    const materialDetailsText = formatMaterialDetails(materials);
    const realismConstraintsText = formatRealismConstraints(realismPreset);
    const garmentAttrsText = formatGarmentAttrs(garmentAttrs);

    const job = createJob({
      user_id: user.id,
      feature: "recolor",
      model,
      items: items.map((it) => ({ label: it.label })),
      params: {
        aspect_ratio: aspectRatio ?? null,
        quality_level: qualityLevel,
        user_seed: userSeed,
        garment_attrs_text: garmentAttrsText,
        material_details_text: materialDetailsText,
        realism_constraints_text: realismConstraintsText,
        material_ids: materials.map((m) => m.id),
        material_names: materials.map((m) => m.name),
        realism_id: realismPreset?.id ?? null,
        realism_name: realismPreset?.name ?? null,
        image_count: uploadedFiles.length,
        image_labels: imageLabels,
        colors: colorsToApply.map((c) => ({
          id: c.id,
          name: c.name,
          hex: c.hex,
        })),
        item_details: items, // 保留每个 item 的映射（worker 用 idx 查）
      },
    });

    // 落盘图（目录名用 job_id 前 12 位）
    const inputsDir = path.join(DATA_DIR_PATH, "job-inputs", job.id);
    await fs.mkdir(inputsDir, { recursive: true });
    const savedInputPaths: string[] = [];
    for (let i = 0; i < uploadedFiles.length; i++) {
      const f = uploadedFiles[i];
      const ext =
        f.type === "image/png"
          ? "png"
          : f.type === "image/webp"
            ? "webp"
            : "jpg";
      const filename = `image_${i}.${ext}`;
      const absPath = path.join(inputsDir, filename);
      await fs.writeFile(absPath, Buffer.from(await f.arrayBuffer()));
      savedInputPaths.push(absPath);
    }

    // 把 input_paths 补进 params
    db.prepare(`UPDATE render_jobs SET params = ? WHERE id = ?`).run(
      JSON.stringify({
        ...safeParseParams(job.params),
        input_paths: savedInputPaths,
        input_mime_types: uploadedFiles.map((f) => f.type || "image/jpeg"),
      }),
      job.id,
    );

    // 确保输出目录
    const outputsDir = path.join(DATA_DIR_PATH, "outputs");
    await fs.mkdir(outputsDir, { recursive: true });

    // ─── 启动后台 worker ───
    startJobWorker(
      job.id,
      async (ctx: HandlerContext) => {
        return recolorItemHandler(ctx, outputsDir);
      },
      {
        onJobEnd: async () => {
          // 清理 input 图（结果图保留在 outputs/）
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
    console.error("[/api/jobs/recolor] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}

/* ─────────── worker 处理单条 item ─────────── */

async function recolorItemHandler(
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
    garment_attrs_text?: string;
    material_details_text?: string;
    realism_constraints_text?: string;
    input_paths?: string[];
    input_mime_types?: string[];
    item_details?: Array<{
      label: string;
      colorId: number;
      colorName: string;
      hex: string;
      imgIdx: number;
      imageLabel: string;
    }>;
  };

  if (!p.input_paths || !p.item_details) {
    throw new Error("任务参数丢失（input_paths/item_details）");
  }

  const itemMeta = p.item_details[ctx.item.idx];
  if (!itemMeta) {
    throw new Error(`item[${ctx.item.idx}] 元数据丢失`);
  }

  // 预算兜底检查（超了就抛错，worker 会标 failed）
  const status = getUserBudgetStatus(ctx.userId);
  if (!status.is_unlimited && status.remaining_cny <= 0) {
    throw new Error(
      `本月预算已用完（¥${status.used_this_month_cny.toFixed(2)}），剩余任务已跳过`,
    );
  }

  // 读所有图 —— 主图放第一个
  const inputBuffers: Buffer[] = [];
  for (const fp of p.input_paths) {
    inputBuffers.push(await fs.readFile(fp));
  }
  const mimeTypes = p.input_mime_types ?? [];
  const inputs: GenImageInput[] = p.input_paths.map((_fp, i) => ({
    buffer: inputBuffers[i],
    mimeType: mimeTypes[i] || "image/jpeg",
  }));
  const reordered: GenImageInput[] = [
    inputs[itemMeta.imgIdx],
    ...inputs.filter((_, i) => i !== itemMeta.imgIdx),
  ];

  const multiImageHint =
    inputs.length > 1
      ? `\n【多图说明】这是同一款产品的 ${inputs.length} 张不同视角图。请仅修改第 1 张的颜色，其他图作为参考帮你理解产品结构、面料、装饰。所有图输出时必须是一模一样的目标色（保持批次色差一致）。`
      : "";

  const prompt =
    buildRecolorPrompt(itemMeta.colorName, itemMeta.hex, {
      garmentAttrs: p.garment_attrs_text || undefined,
      materialDetails: p.material_details_text || undefined,
      realismConstraints: p.realism_constraints_text || undefined,
      userSeed: p.user_seed || undefined,
      qualityLevel: p.quality_level || "2k",
    }) + multiImageHint;

  const imageSize: "1K" | "2K" | "4K" =
    p.quality_level === "4k"
      ? "4K"
      : p.quality_level === "hd"
        ? "1K"
        : "2K";

  const gen = await retryWithBackoff(
    () =>
      generateImage(reordered, prompt, ctx.job.model, {
        aspectRatio: p.aspect_ratio ?? undefined,
        imageSize,
      }),
    {
      onRetry: (e, attempt, delay) => {
        console.warn(
          `[recolor retry] job=${ctx.job.id} idx=${ctx.item.idx} color=${itemMeta.colorName} attempt=${attempt} delay=${Math.round(delay)}ms: ${
            e instanceof Error ? e.message.slice(0, 100) : String(e)
          }`,
        );
      },
    },
  );

  const ext = gen.mimeType.includes("png") ? "png" : "jpg";
  const filename = `recolor_${ctx.userId}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;
  const filePath = path.join(outputsDir, filename);
  await fs.writeFile(filePath, gen.data);

  recordUsage({
    userId: ctx.userId,
    model: ctx.job.model,
    feature: "recolor",
    usageMetadata: gen.usageMetadata,
    success: true,
    notes: {
      job_id: ctx.job.id,
      color: itemMeta.colorName,
      hex: itemMeta.hex,
      image_index: itemMeta.imgIdx,
      aspect_ratio: p.aspect_ratio,
      quality_level: p.quality_level,
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
