import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { syncShopifyProduct, type ShopifyProductDraftInput } from "@/lib/shopify";
import {
  normalizeShopifyDeviceKey,
  SHOPIFY_DEVICE_HEADER,
} from "@/lib/shopify-device";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceKey = normalizeShopifyDeviceKey(
      req.headers.get(SHOPIFY_DEVICE_HEADER),
    );
    const body = (await req.json()) as { product?: ShopifyProductDraftInput };
    if (!body.product) {
      return NextResponse.json({ error: "product 必填" }, { status: 400 });
    }
    const result = await syncShopifyProduct(user.id, body.product, deviceKey);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
