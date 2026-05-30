import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getStoredShopifyAccessToken,
  testShopifyConnection,
  updateShopifyLastTested,
} from "@/lib/shopify";
import {
  normalizeShopifyDeviceKey,
  SHOPIFY_DEVICE_HEADER,
} from "@/lib/shopify-device";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceKey = normalizeShopifyDeviceKey(
      req.headers.get(SHOPIFY_DEVICE_HEADER),
    );
    const body = (await req.json()) as {
      authMode?: "access_token" | "oauth_app" | "client_credentials";
      shopDomain?: string;
      accessToken?: string;
      clientId?: string;
      clientSecret?: string;
      useStored?: boolean;
    };

    const authMode =
      body.authMode === "oauth_app"
        ? "oauth_app"
        : body.authMode === "client_credentials"
          ? "client_credentials"
          : "access_token";
    let shopDomain = String(body.shopDomain || "").trim();
    let accessToken = String(body.accessToken || "").trim();
    let clientId = String(body.clientId || "").trim();
    let clientSecret = String(body.clientSecret || "").trim();

    if (body.useStored) {
      const stored = await getStoredShopifyAccessToken(user.id, deviceKey);
      if (!stored) {
        return NextResponse.json(
          { error: "尚未绑定 Shopify" },
          { status: 400 },
        );
      }
      shopDomain = stored.shopDomain;
      accessToken = stored.accessToken;
      clientId = "";
      clientSecret = "";
    }

    const result = await testShopifyConnection({
      authMode: body.useStored ? "access_token" : authMode,
      shopDomain,
      accessToken,
      clientId,
      clientSecret,
    });
    if (body.useStored) {
      updateShopifyLastTested(user.id, result, deviceKey);
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
