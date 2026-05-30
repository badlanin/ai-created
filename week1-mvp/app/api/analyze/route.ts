import { NextRequest, NextResponse } from "next/server";
import { analyzeGarment } from "@/lib/gemini";
import { resolveModelId } from "@/lib/ai-models";
import { requireUser } from "@/lib/auth";
import { recordUsage } from "@/lib/usage";
import { assertWithinBudget } from "@/lib/pricing";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let user: { id: number; role: string } | null = null;
  let model = "unknown";
  try {
    user = await requireUser();
    assertWithinBudget(user.id, user.role);
    const formData = await req.formData();
    const images: { buffer: Buffer; mimeType: string }[] = [];

    for (const [key, value] of formData.entries()) {
      if (key.startsWith("image") && value instanceof File) {
        const buffer = Buffer.from(await value.arrayBuffer());
        images.push({ buffer, mimeType: value.type || "image/jpeg" });
      }
    }

    const modelRaw = formData.get("model");
    model = resolveModelId(
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

    // 计费：从 _meta.usageMetadata 拿 tokens
    const meta = (result as { _meta?: { usageMetadata?: unknown } })._meta;
    recordUsage({
      userId: user.id,
      model,
      feature: "analyze",
      usageMetadata: meta?.usageMetadata as never,
      success: true,
      notes: { image_count: images.length },
    });

    return NextResponse.json({ ...result, _model: model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = (e as { status?: number }).status || 500;
    console.error("[/api/analyze] 失败:", msg);
    if (user && status !== 429) {
      recordUsage({
        userId: user.id,
        model,
        feature: "analyze",
        success: false,
        error: msg,
      });
    }
    return NextResponse.json(
      { error: status === 429 ? msg : `解析失败：${msg}` },
      { status },
    );
  }
}
