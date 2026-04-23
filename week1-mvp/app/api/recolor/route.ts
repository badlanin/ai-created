import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { getDb, DATA_DIR_PATH } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  buildRecolorPrompt,
  generateImage,
  type GenImageInput,
} from "@/lib/gemini-image";
import { resolveImageModel } from "@/lib/image-models";

export const runtime = "nodejs";
// 换色每张约 5-15 秒，批量时要给足时间
export const maxDuration = 300;

type ColorRow = { id: number; name: string; hex: string };

interface RecolorResult {
  color_id: number;
  color_name: string;
  hex: string;
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
    const imageFile = formData.get("image");
    if (!(imageFile instanceof File)) {
      return NextResponse.json(
        { error: "请上传原始产品图" },
        { status: 400 },
      );
    }

    const colorIdsRaw = formData.get("color_ids");
    const customColorsRaw = formData.get("custom_colors");
    const modelRaw = formData.get("model");
    const model = resolveImageModel(
      typeof modelRaw === "string" ? modelRaw : undefined,
    );

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

    const inputBuffer = Buffer.from(await imageFile.arrayBuffer());
    const inputMime = imageFile.type || "image/jpeg";
    const inputImage: GenImageInput = {
      buffer: inputBuffer,
      mimeType: inputMime,
    };

    // 确保输出目录存在
    const outputsDir = path.join(DATA_DIR_PATH, "outputs");
    await fs.mkdir(outputsDir, { recursive: true });

    // 串行调用（Nano Banana 同时并发容易 429，先串行保证稳定）
    const results: RecolorResult[] = [];
    for (const c of colorsToApply) {
      try {
        const prompt = buildRecolorPrompt(c.name, c.hex);
        const gen = await generateImage([inputImage], prompt, model);

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
          success: true,
          image_url: `/assets/outputs/${filename}`,
        });
      } catch (e) {
        results.push({
          color_id: c.id,
          color_name: c.name,
          hex: c.hex,
          success: false,
          error: e instanceof Error ? e.message : String(e),
        });
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
        colors: colorsToApply.map((c) => ({
          id: c.id,
          name: c.name,
          hex: c.hex,
        })),
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
