import { NextRequest, NextResponse } from "next/server";
import { getOrGenerateThumb, type ThumbFormat } from "@/lib/thumbnails";

export const runtime = "nodejs";
// 单次缩略图生成最多给 30s，避免超大原图卡死
export const maxDuration = 30;

/**
 * GET /api/thumb?path=outputs/abc.png&w=400&q=80&fmt=webp
 *
 * 按需生成 + 缓存缩略图。前端 Thumbnail 组件统一调这个端点。
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const relativePath = url.searchParams.get("path") || "";
    const w = Number(url.searchParams.get("w") || "400");
    const q = Number(url.searchParams.get("q") || "80");
    const fmtRaw = url.searchParams.get("fmt") || "webp";
    const fmt: ThumbFormat =
      fmtRaw === "avif" ? "avif" : fmtRaw === "jpeg" ? "jpeg" : "webp";

    const result = await getOrGenerateThumb(relativePath, {
      width: w,
      quality: q,
      format: fmt,
    });

    if (!result.cacheHit) {
      const ratio =
        result.originalSize > 0
          ? ((result.thumbSize / result.originalSize) * 100).toFixed(1)
          : "?";
      console.log(
        `[thumb] new ${relativePath} w=${w} ${fmt} q=${q} → ${result.thumbSize} 字节 (${ratio}% of orig)`,
      );
    }

    return new NextResponse(result.data as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Thumb-Cache": result.cacheHit ? "HIT" : "MISS",
        "Content-Length": String(result.data.length),
      },
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    if (status !== 404) console.error("[/api/thumb] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
