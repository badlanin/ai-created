import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { cancelProductBatchPreview } from "@/lib/product-batch-optimization";
import { getShopifyDeviceIdFromRequest } from "@/lib/shopify-device";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const body = (await req.json()) as { jobId?: string };
    if (!body.jobId) {
      return NextResponse.json({ error: "jobId 必填" }, { status: 400 });
    }
    const result = cancelProductBatchPreview(body.jobId, {
      userId: user.id,
      deviceId,
    });
    return NextResponse.json(result);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}