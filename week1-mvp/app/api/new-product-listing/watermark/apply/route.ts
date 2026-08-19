import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { DATA_DIR_PATH } from "@/lib/db";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/new-product-listing/watermark/apply
 *
 * 给指定图片按归一化坐标叠加水印。
 *
 * 请求体: { items: [{ key, imageUrl, placement }], watermarkId: string }
 *   placement: { x, y, width }，均为相对图片尺寸的 0-1 数值；x/y 是中心点
 *   watermarkId: 水印的 id（来自 GET /api/new-product-listing/watermark）
 *
 * 响应: { ok: true, results: [{ originalUrl, url }] }
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = (await req.json()) as {
      imageUrl?: string;
      imageUrls?: string[];
      watermarkId?: string;
      placement?: WatermarkPlacement;
      items?: Array<{
        key?: string;
        imageUrl?: string;
        placement?: WatermarkPlacement;
      }>;
    };
    const legacyUrls = body.imageUrls || (body.imageUrl ? [body.imageUrl] : []);
    const items = Array.isArray(body.items)
      ? body.items
          .filter((item) => typeof item.imageUrl === "string" && item.imageUrl)
          .map((item) => ({
            key: item.key || item.imageUrl!,
            imageUrl: item.imageUrl!,
            placement: normalizePlacement(item.placement || body.placement),
          }))
      : legacyUrls.map((imageUrl) => ({
          key: imageUrl,
          imageUrl,
          placement: normalizePlacement(body.placement),
        }));
    const watermarkId = body.watermarkId;

    if (items.length === 0) {
      return NextResponse.json(
        { error: "请提供 imageUrl、imageUrls 或 items" },
        { status: 400 },
      );
    }
    if (!watermarkId) {
      return NextResponse.json({ error: "请提供 watermarkId" }, { status: 400 });
    }

    // 读取水印文件
    const wmPath = path.join(
      DATA_DIR_PATH,
      "new-product-listing-watermark",
      `${watermarkId}.png`,
    );
    let watermarkBuffer: Buffer;
    try {
      watermarkBuffer = await fs.readFile(wmPath);
    } catch {
      return NextResponse.json({ error: "水印文件不存在，请到设置页重新上传" }, { status: 400 });
    }

    const results: Array<{
      key: string;
      originalUrl: string;
      url: string | null;
      error?: string;
    }> = [];

    for (const item of items) {
      const { key, imageUrl, placement } = item;
      try {
        // 把访问路径转为本地文件路径
        // /assets/uploads/product-media/xxx.png → DATA_DIR/uploads/product-media/xxx.png
        const relPath = imageUrl.replace(/^\/assets\//, "");
        const absPath = path.resolve(DATA_DIR_PATH, relPath);
        if (!absPath.startsWith(path.resolve(DATA_DIR_PATH) + path.sep)) {
          results.push({ key, originalUrl: imageUrl, url: null, error: "非法路径" });
          continue;
        }

        // 读取原图，获取宽高
        const origMeta = await sharp(absPath).metadata();
        const origWidth = origMeta.width || 1024;
        const origHeight = origMeta.height || 1024;

        // 前端传相对宽度，后端按原图真实像素重新计算，保证不同分辨率视觉一致。
        const targetWmWidth = Math.max(
          8,
          Math.min(Math.round(origWidth * placement.width), origWidth),
        );
        const wmResized = await sharp(watermarkBuffer)
          .resize({
            width: targetWmWidth,
            height: origHeight,
            fit: "inside",
            withoutEnlargement: false,
          })
          .toBuffer();

        const wmResizedMeta = await sharp(wmResized).metadata();
        const renderedWidth = wmResizedMeta.width || targetWmWidth;
        const renderedHeight = wmResizedMeta.height || 1;
        const left = clampInt(
          Math.round(placement.x * origWidth - renderedWidth / 2),
          0,
          Math.max(0, origWidth - renderedWidth),
        );
        const top = clampInt(
          Math.round(placement.y * origHeight - renderedHeight / 2),
          0,
          Math.max(0, origHeight - renderedHeight),
        );

        const watermarked = await sharp(absPath)
          .composite([{
            input: wmResized,
            left,
            top,
            blend: "over",
          }])
          .png({ quality: 95 })
          .toBuffer();

        // 保存到 watermarked 目录
        const sourceBase = path.basename(relPath, path.extname(relPath));
        const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const fileName = `watermarked_${sourceBase}_${unique}.png`;
        const outDir = path.join(
          DATA_DIR_PATH,
          "uploads",
          "new-product-listing-watermarked",
        );
        await fs.mkdir(outDir, { recursive: true });
        const outPath = path.join(outDir, fileName);
        await fs.writeFile(outPath, watermarked);

        const outUrl = `/assets/uploads/new-product-listing-watermarked/${fileName}`;
        results.push({ key, originalUrl: imageUrl, url: outUrl });
      } catch (e) {
        results.push({
          key,
          originalUrl: imageUrl,
          url: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // 单图兼容返回 { url }
    if (items.length === 1 && results[0]?.url) {
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

type WatermarkPlacement = { x?: number; y?: number; width?: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

function normalizePlacement(
  placement?: WatermarkPlacement,
): { x: number; y: number; width: number } {
  return {
    x: clamp(Number(placement?.x ?? 0.78), 0, 1),
    y: clamp(Number(placement?.y ?? 0.9), 0, 1),
    width: clamp(Number(placement?.width ?? 0.4), 0.08, 0.9),
  };
}
