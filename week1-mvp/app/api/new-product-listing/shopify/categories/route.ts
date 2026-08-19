import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getShopifyTaxonomyCategoryOptions } from "@/lib/new-product-listing-shopify";
import { getShopifyDeviceIdFromRequest } from "@/lib/new-product-listing-shopify-device";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const search = req.nextUrl.searchParams.get("search") || "";
    const childrenOf = req.nextUrl.searchParams.get("childrenOf") || "";
    const result = await getShopifyTaxonomyCategoryOptions(user.id, deviceId, {
      search,
      childrenOf,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
