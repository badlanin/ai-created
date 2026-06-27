import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createProductBatchPreview } from "@/lib/product-batch-optimization";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const body = (await req.json()) as {
      jobId?: string;
      storeKeys?: string[];
      query?: string;
      start?: number;
      limit?: number;
      prompt?: string;
      includeImages?: boolean;
      includeApplied?: boolean;
      model?: string | null;
    };
    const run = await createProductBatchPreview({
      user,
      jobId: body.jobId,
      storeKeys: body.storeKeys,
      query: body.query,
      start: body.start,
      limit: body.limit,
      prompt: body.prompt,
      includeImages: body.includeImages,
      includeApplied: body.includeApplied,
      model: body.model,
    });
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
