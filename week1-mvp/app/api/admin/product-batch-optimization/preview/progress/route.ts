import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getProductBatchPreviewProgress } from "@/lib/product-batch-optimization";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const jobId = req.nextUrl.searchParams.get("jobId") || "";
    if (!jobId) {
      return NextResponse.json({ error: "jobId 必填" }, { status: 400 });
    }
    const progress = getProductBatchPreviewProgress(jobId);
    return NextResponse.json({ ok: true, progress });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
