import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  exchangeShopifyOAuthCode,
  normalizeShopDomain,
  saveShopifyConnection,
  testShopifyConnection,
  verifyShopifyOAuthHmac,
} from "@/lib/new-product-listing-shopify";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const redirectToProductListing = (status: "success" | "error", message?: string) => {
    const target = new URL("/new-product-listing", url.origin);
    target.searchParams.set("shopify_oauth", status);
    if (message) target.searchParams.set("message", message);
    return NextResponse.redirect(target);
  };

  try {
    const session = await getSession();
    const pending = session.newProductListingShopifyOAuth;
    if (!pending) {
      return redirectToProductListing(
        "error",
        "Shopify 授权会话已失效，请重新点击开始授权。",
      );
    }

    if (!pending.deviceId) {
      throw new Error("本机 Shopify 绑定标识已失效，请重新开始授权。");
    }

    const state = url.searchParams.get("state") || "";
    const shopDomain = normalizeShopDomain(url.searchParams.get("shop") || "");
    const code = url.searchParams.get("code") || "";
    if (state !== pending.state) {
      throw new Error("Shopify OAuth state 校验失败，请重新开始授权。");
    }
    if (shopDomain !== normalizeShopDomain(pending.shopDomain)) {
      throw new Error("Shopify 回调店铺与发起授权的店铺不一致。");
    }
    if (!verifyShopifyOAuthHmac(url.searchParams, pending.clientSecret)) {
      throw new Error("Shopify OAuth HMAC 校验失败，请确认客户端密钥填写正确。");
    }

    const token = await exchangeShopifyOAuthCode({
      shopDomain,
      clientId: pending.clientId,
      clientSecret: pending.clientSecret,
      code,
    });
    const testResult = await testShopifyConnection({
      authMode: "access_token",
      shopDomain,
      accessToken: token.accessToken,
    });

    saveShopifyConnection({
      userId: pending.userId,
      deviceId: pending.deviceId,
      shopDomain,
      authMode: "oauth_app",
      accessToken: token.accessToken,
      clientId: pending.clientId,
      testResult,
    });

    delete session.newProductListingShopifyOAuth;
    await session.save();
    return redirectToProductListing("success");
  } catch (e) {
    try {
      const session = await getSession();
      delete session.newProductListingShopifyOAuth;
      await session.save();
    } catch {
      // Ignore cleanup failures; the redirect still carries the actionable error.
    }
    return redirectToProductListing(
      "error",
      e instanceof Error ? e.message : String(e),
    );
  }
}
