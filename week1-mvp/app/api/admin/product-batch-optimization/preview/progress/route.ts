import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getProductBatchPreviewProgress } from "@/lib/product-batch-optimization";
import { getShopifyDeviceIdFromRequest } from "@/lib/shopify-device";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const jobId = req.nextUrl.searchParams.get("jobId") || "";
    if (!jobId) {
      return NextResponse.json({ error: "jobId 必填" }, { status: 400 });
    }
    const progress = getProductBatchPreviewProgress(jobId, {
      userId: user.id,
      deviceId,
    });
    return NextResponse.json({ ok: true, progress });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}