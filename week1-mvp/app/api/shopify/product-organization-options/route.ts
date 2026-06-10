import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getShopifyProductOrganizationOptions } from "@/lib/shopify";
import { getShopifyDeviceIdFromRequest } from "@/lib/shopify-device";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const categoryId = req.nextUrl.searchParams.get("categoryId") || "";
    const result = await getShopifyProductOrganizationOptions(user.id, deviceId, {
      categoryId,
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
