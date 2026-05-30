import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession, requireUser } from "@/lib/auth";
import {
  buildShopifyOAuthAuthorizeUrl,
  normalizeShopDomain,
  SHOPIFY_OAUTH_SCOPES,
} from "@/lib/shopify";
import { getShopifyDeviceIdFromRequest } from "@/lib/shopify-device";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const body = (await req.json()) as {
      shopDomain?: string;
      clientId?: string;
      clientSecret?: string;
    };
    const shopDomain = normalizeShopDomain(String(body.shopDomain || ""));
    const clientId = String(body.clientId || "").trim();
    const clientSecret = String(body.clientSecret || "").trim();
    if (!clientId) throw new Error("客户端 ID 不能为空");
    if (!clientSecret) throw new Error("客户端密钥不能为空");

    const origin = new URL(req.url).origin;
    const redirectUri = new URL("/api/shopify/oauth/callback", origin).toString();
    const state = crypto.randomBytes(20).toString("hex");
    const session = await getSession();
    session.shopifyOAuth = {
      state,
      shopDomain,
      clientId,
      clientSecret,
      redirectUri,
      userId: user.id,
      deviceId,
      createdAt: Date.now(),
    };
    await session.save();

    const authorizeUrl = buildShopifyOAuthAuthorizeUrl({
      shopDomain,
      clientId,
      redirectUri,
      state,
      scopes: SHOPIFY_OAUTH_SCOPES,
    });

    return NextResponse.json({
      ok: true,
      authorizeUrl,
      redirectUri,
      scopes: SHOPIFY_OAUTH_SCOPES,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 400;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
