import { NextRequest, NextResponse } from "next/server";
import { analyzeGarment } from "@/lib/gemini";
import { resolveModelId } from "@/lib/ai-models";

// 强制 Node.js 运行时（因为用到 Buffer 和长超时）
export const runtime = "nodejs";
// 允许长达 60 秒（默认 10 秒不够 Gemini 调用）
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const images: { buffer: Buffer; mimeType: string }[] = [];

    for (const [key, value] of formData.entries()) {
      if (key.startsWith("image") && value instanceof File) {
        const buffer = Buffer.from(await value.arrayBuffer());
        // 客户端已压缩为 JPEG，这里默认 image/jpeg
        images.push({ buffer, mimeType: value.type || "image/jpeg" });
      }
    }

    const modelRaw = formData.get("model");
    const model = resolveModelId(
      "vision",
      typeof modelRaw === "string" ? modelRaw : undefined,
    );

    if (images.length === 0) {
      return NextResponse.json(
        { error: "请至少上传一张服装图" },
        { status: 400 },
      );
    }
    if (images.length > 2) {
      return NextResponse.json(
        { error: "最多上传 2 张（正面 + 背面）" },
        { status: 400 },
      );
    }

    const result = await analyzeGarment(images, model);
    return NextResponse.json({ ...result, _model: model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/analyze] 失败:", msg);
    return NextResponse.json(
      { error: `解析失败：${msg}` },
      { status: 500 },
    );
  }
}
