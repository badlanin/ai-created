import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getStoredShopifyToken,
  testShopifyConnection,
  updateShopifyLastTested,
} from "@/lib/shopify";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      shopDomain?: string;
      accessToken?: string;
      useStored?: boolean;
    };

    let shopDomain = String(body.shopDomain || "").trim();
    let accessToken = String(body.accessToken || "").trim();

    if (body.useStored) {
      const stored = getStoredShopifyToken(user.id);
      if (!stored) {
        return NextResponse.json(
          { error: "尚未绑定 Shopify" },
          { status: 400 },
        );
      }
      shopDomain = stored.shopDomain;
      accessToken = stored.accessToken;
    }

    const result = await testShopifyConnection({ shopDomain, accessToken });
    if (body.useStored) {
      updateShopifyLastTested(user.id, result);
    }
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
