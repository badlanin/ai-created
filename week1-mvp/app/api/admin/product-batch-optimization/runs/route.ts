import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listProductBatchRuns } from "@/lib/product-batch-optimization";
import { getShopifyDeviceIdFromRequest } from "@/lib/shopify-device";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const runs = await listProductBatchRuns({ userId: user.id, deviceId });
    return NextResponse.json({ ok: true, runs });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}