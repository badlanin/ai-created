import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession, requireUser } from "@/lib/auth";
import {
  buildShopifyOAuthAuthorizeUrl,
  normalizeShopDomain,
  SHOPIFY_OAUTH_SCOPES,
} from "@/lib/shopify";
import { getShopifyDeviceIdFromRequest } from "@/lib/shopify-device";
import { readShopifyOAuthCredentials } from "@/lib/shopify-oauth-env";

export const runtime = "nodejs";

function getShopifyAppOrigin(req: NextRequest) {
  const configuredUrl = (
    process.env.SHOPIFY_APP_URL ||
    process.env.DOMAIN ||
    ""
  ).trim();

  if (configuredUrl) {
    try {
      return new URL(configuredUrl).origin;
    } catch {
      throw new Error("SHOPIFY_APP_URL/DOMAIN must be a valid http(s) URL");
    }
  }

  return new URL(req.url).origin;
}

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
    const storedCredentials = await readShopifyOAuthCredentials(shopDomain);
    const clientId = String(body.clientId || "").trim() || storedCredentials.clientId;
    const clientSecret =
      String(body.clientSecret || "").trim() || storedCredentials.clientSecret;
    if (!clientId) {
      throw new Error("客户端 ID 不能为空，请先上传 Shopify 配置文件兑换 Token，或配置 SHOPIFY_CLIENT_ID/SHOPIFY_API_KEY");
    }
    if (!clientSecret) {
      throw new Error("客户端密钥不能为空，请先上传 Shopify 配置文件兑换 Token，或配置 SHOPIFY_CLIENT_SECRET/SHOPIFY_API_SECRET");
    }

    const origin = getShopifyAppOrigin(req);
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
      managedInstallation: true,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 400;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
