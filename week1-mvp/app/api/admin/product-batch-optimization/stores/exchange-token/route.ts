import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { exchangeAndSaveProductBatchStore } from "@/lib/product-batch-optimization";
import { getShopifyDeviceIdFromRequest } from "@/lib/shopify-device";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const body = (await req.json()) as {
      shopDomain?: string;
      clientId?: string;
      clientSecret?: string;
    };
    const result = await exchangeAndSaveProductBatchStore({
      ...body,
      userId: user.id,
      deviceId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}