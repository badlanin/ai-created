import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { DATA_DIR_PATH, getDb } from "@/lib/db";
import { saveUploadFile } from "@/lib/uploads";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/watermark/apply
 *
 * 给指定图片叠加指定水印（右下角）。
 *
 * 请求体: { imageUrls: string[], watermarkId: string }
 *   imageUrls: 图片的访问路径数组
 *   watermarkId: 水印的 id（来自 GET /api/watermark）
 *
 * 响应: { ok: true, results: [{ originalUrl, url }] }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { imageUrl?: string; imageUrls?: string[]; watermarkId?: string };
    const urls = body.imageUrls || (body.imageUrl ? [body.imageUrl] : []);
    const watermarkId = body.watermarkId;

    if (urls.length === 0) {
      return NextResponse.json({ error: "请提供 imageUrl 或 imageUrls" }, { status: 400 });
    }
    if (!watermarkId) {
      return NextResponse.json({ error: "请提供 watermarkId" }, { status: 400 });
    }

    // 读取水印文件
    const wmPath = path.join(DATA_DIR_PATH, "watermark", `${watermarkId}.png`);
    let watermarkBuffer: Buffer;
    try {
      watermarkBuffer = await fs.readFile(wmPath);
    } catch {
      return NextResponse.json({ error: "水印文件不存在，请到设置页重新上传" }, { status: 400 });
    }

    // 把水印缩放到图片的 15% 宽度（自适应），最大 200px
    const wmMeta = await sharp(watermarkBuffer).metadata();
    const wmWidth = wmMeta.width || 200;

    const results: Array<{ originalUrl: string; url: string | null; error?: string }> = [];

    for (const imageUrl of urls) {
      try {
        // 把访问路径转为本地文件路径
        // /assets/uploads/product-media/xxx.png → DATA_DIR/uploads/product-media/xxx.png
        const relPath = imageUrl.replace(/^\/assets\//, "");
        const absPath = path.resolve(DATA_DIR_PATH, relPath);
        if (!absPath.startsWith(path.resolve(DATA_DIR_PATH) + path.sep)) {
          results.push({ originalUrl: imageUrl, url: null, error: "非法路径" });
          continue;
        }

        // 读取原图，获取宽高
        const origMeta = await sharp(absPath).metadata();
        const origWidth = origMeta.width || 1024;

        // 水印宽度 = 原图宽的 60%（最大 1600px），确保清晰可辨
        const targetWmWidth = Math.min(origWidth * 0.60, 1600);
        const wmResized = await sharp(watermarkBuffer)
          .resize(Math.round(targetWmWidth), null, { fit: "inside" })
          .toBuffer();

        // 读取原图信息
        const wmResizedMeta = await sharp(wmResized).metadata();
        const pad = Math.round(origWidth * 0.04); // 4% 边距
        const left = origWidth - (wmResizedMeta.width || 0) - pad;
        const top = (origMeta.height || 0) - (wmResizedMeta.height || 0) - pad;

        // 合成水印到右下角
        const watermarked = await sharp(absPath)
          .composite([{
            input: wmResized,
            top: Math.max(0, top),
            left: Math.max(0, left),
            blend: "over",
          }])
          .png({ quality: 95 })
          .toBuffer();

        // 保存到 watermarked 目录
        const fileName = `watermarked_${path.basename(relPath)}`;
        const outDir = path.join(DATA_DIR_PATH, "uploads", "watermarked");
        await fs.mkdir(outDir, { recursive: true });
        const outPath = path.join(outDir, fileName);
        await fs.writeFile(outPath, watermarked);

        const outUrl = `/assets/uploads/watermarked/${fileName}`;
        results.push({ originalUrl: imageUrl, url: outUrl });
      } catch (e) {
        results.push({
          originalUrl: imageUrl,
          url: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // 单图兼容返回 { url }
    if (urls.length === 1 && results[0]?.url) {
      return NextResponse.json({ ok: true, url: results[0].url, results });
    }

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
