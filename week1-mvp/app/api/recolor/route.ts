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

export const runtime = "nodejs";
// 换色每张：Flash Image 5-15 秒，Pro Image 带 Thinking 可达 3-5 分钟
// 批量 + Pro 时要给足时间。600s 覆盖最坏情况
export const maxDuration = 600;

type ColorRow = { id: number; name: string; hex: string };

interface RecolorResult {
  color_id: number;
  color_name: string;
  hex: string;
  image_index: number; // 对应第几张原图（0-based）
  image_label: string; // 原图文件名，方便用户对照
  success: boolean;
  image_url?: string; // 生成图的 URL（/assets/outputs/xxx.png）
  error?: string;
}

/**
 * POST /api/recolor
 * formData:
 *   - image: 原始产品图（必须）
 *   - color_ids: JSON array of ids, e.g. "[1,2,3]"
 *
 * 或者直接传 custom_colors: [{name, hex}, ...]
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await requireUser();
    const db = getDb();

    const formData = await req.formData();

    // 多图上传：支持 image / image0 / image1 ... imageN 多种命名
    const uploadedFiles: File[] = [];
    // 旧兼容：单张 "image"
    const legacyImage = formData.get("image");
    if (legacyImage instanceof File) uploadedFiles.push(legacyImage);
    // 新：image0, image1, image2 ...
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

    const colorIdsRaw = formData.get("color_ids");
    const customColorsRaw = formData.get("custom_colors");
    const modelRaw = formData.get("model");
    const model = resolveModelId(
      "image_gen",
      typeof modelRaw === "string" ? modelRaw : undefined,
    );

    // 新：材质 ids（用户在前端勾的 + 自动匹配后保留的）
    const materialIdsRaw = formData.get("material_ids");
    let materialIds: number[] = [];
    if (typeof materialIdsRaw === "string" && materialIdsRaw.trim()) {
      try {
        const parsed = JSON.parse(materialIdsRaw);
        if (Array.isArray(parsed)) {
          materialIds = parsed.filter((v) => Number.isFinite(v));
        }
      } catch {
        // ignore bad JSON
      }
    }

    // 新：真实感预设 id
    const realismIdRaw = formData.get("realism_id");
    const realismId =
      typeof realismIdRaw === "string" && realismIdRaw.trim()
        ? Number(realismIdRaw)
        : null;

    // 新：款式解析结果 JSON（前端解析后传过来，避免服务端再解析一次）
    const garmentAttrsRaw = formData.get("garment_attrs");
    let garmentAttrs: Record<string, string | string[]> | null = null;
    if (typeof garmentAttrsRaw === "string" && garmentAttrsRaw.trim()) {
      try {
        garmentAttrs = JSON.parse(garmentAttrsRaw);
      } catch {
        // ignore bad JSON
      }
    }

    // 新：用户追加指令
    const userSeed =
      typeof formData.get("user_seed") === "string"
        ? String(formData.get("user_seed")).trim()
        : "";

    // 新：输出比例
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

    // 新：输出清晰度档位（给模型"按 4K 重绘"的指令，不是真 4K 输出）
    const qualityLevelRaw = formData.get("quality_level");
    const qualityLevel: "hd" | "2k" | "4k" =
      qualityLevelRaw === "hd" || qualityLevelRaw === "2k"
        ? qualityLevelRaw
        : "4k";

    // 读材质 + 真实感
    const materials = getMaterialsByIds(materialIds);
    const realismPreset = getRealismPreset(realismId);

    const materialDetailsText = formatMaterialDetails(materials);
    const realismConstraintsText = formatRealismConstraints(realismPreset);
    const garmentAttrsText = formatGarmentAttrs(garmentAttrs);

    // 解析要用的颜色列表
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
          id: -(i + 1), // 负 id 表示临时色
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

    // 把所有上传图读为 Buffer
    const inputImages: GenImageInput[] = [];
    const imageLabels: string[] = [];
    for (const f of uploadedFiles) {
      const buffer = Buffer.from(await f.arrayBuffer());
      inputImages.push({ buffer, mimeType: f.type || "image/jpeg" });
      imageLabels.push(f.name || `image${inputImages.length}`);
    }

    // 确保输出目录存在
    const outputsDir = path.join(DATA_DIR_PATH, "outputs");
    await fs.mkdir(outputsDir, { recursive: true });

    // 串行调用：外层遍历颜色，内层遍历每张图
    // 每次调用把所有上传图作为参考传入，target 是第 i 张
    // prompt 里明确"请修改第 N 张图，其他作为同款参考"
    const results: RecolorResult[] = [];
    for (const c of colorsToApply) {
      for (let imgIdx = 0; imgIdx < inputImages.length; imgIdx++) {
        const label = imageLabels[imgIdx];
        try {
          // 把目标图放第一位（Nano Banana 最关注第一张），其余作为参考
          const reordered: GenImageInput[] = [
            inputImages[imgIdx],
            ...inputImages.filter((_, i) => i !== imgIdx),
          ];

          const multiImageHint =
            inputImages.length > 1
              ? `\n【多图说明】这是同一款产品的 ${inputImages.length} 张不同视角图。请仅修改第 1 张的颜色，其他图作为参考帮你理解产品结构、面料、装饰。所有图输出时必须是一模一样的目标色（保持批次色差一致）。`
              : "";

          const prompt =
            buildRecolorPrompt(c.name, c.hex, {
              garmentAttrs: garmentAttrsText || undefined,
              materialDetails: materialDetailsText || undefined,
              realismConstraints: realismConstraintsText || undefined,
              userSeed: userSeed || undefined,
              qualityLevel,
            }) + multiImageHint;

          const gen = await generateImage(reordered, prompt, model, {
            aspectRatio,
          });

          const ext = gen.mimeType.includes("png") ? "png" : "jpg";
          const filename = `recolor_${user.id}_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}.${ext}`;
          const filePath = path.join(outputsDir, filename);
          await fs.writeFile(filePath, gen.data);

          results.push({
            color_id: c.id,
            color_name: c.name,
            hex: c.hex,
            image_index: imgIdx,
            image_label: label,
            success: true,
            image_url: `/assets/outputs/${filename}`,
          });
        } catch (e) {
          results.push({
            color_id: c.id,
            color_name: c.name,
            hex: c.hex,
            image_index: imgIdx,
            image_label: label,
            success: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    // 记录生成历史
    const successCount = results.filter((r) => r.success).length;
    db.prepare(
      `INSERT INTO generations (user_id, kind, output_images, params, duration_ms, success)
       VALUES (?, 'recolor', ?, ?, ?, ?)`,
    ).run(
      user.id,
      JSON.stringify(results.filter((r) => r.success).map((r) => r.image_url)),
      JSON.stringify({
        model,
        aspect_ratio: aspectRatio || null,
        quality_level: qualityLevel,
        image_count: inputImages.length,
        image_labels: imageLabels,
        colors: colorsToApply.map((c) => ({
          id: c.id,
          name: c.name,
          hex: c.hex,
        })),
        material_ids: materials.map((m) => m.id),
        material_names: materials.map((m) => m.name),
        realism_id: realismPreset?.id ?? null,
        realism_name: realismPreset?.name ?? null,
        has_garment_attrs: Boolean(garmentAttrsText),
        user_seed: userSeed || null,
      }),
      Date.now() - startedAt,
      successCount > 0 ? 1 : 0,
    );

    return NextResponse.json({ results, model });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/recolor] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
