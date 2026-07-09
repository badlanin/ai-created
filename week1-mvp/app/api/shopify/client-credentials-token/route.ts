import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  exchangeShopifyClientCredentialsToken,
  getShopifyConnection,
  getShopifyConnections,
  maskToken,
  saveShopifyConnection,
  testShopifyConnection,
} from "@/lib/shopify";
import { getShopifyDeviceIdFromRequest } from "@/lib/shopify-device";
import {
  readShopifyOAuthCredentials,
  saveShopifyOAuthCredentials,
} from "@/lib/shopify-oauth-env";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const body = (await req.json()) as {
      useStored?: boolean;
      shopDomain?: string;
      clientId?: string;
      clientSecret?: string;
    };
    const shopDomain = String(body.shopDomain || "");
    const storedCredentials = body.useStored
      ? await readShopifyOAuthCredentials(shopDomain)
      : null;
    const clientId =
      String(body.clientId || "").trim() || storedCredentials?.clientId || "";
    const clientSecret =
      String(body.clientSecret || "").trim() ||
      storedCredentials?.clientSecret ||
      "";
    const token = await exchangeShopifyClientCredentialsToken({
      shopDomain,
      clientId,
      clientSecret,
    });
    const expiresIn =
      token.expiresIn && token.expiresIn > 0 ? token.expiresIn : 24 * 60 * 60;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    const oauthCredentials = body.useStored
      ? { written: false }
      : await saveShopifyOAuthCredentials({
          shopDomain,
          clientId,
          clientSecret,
        });
    if (body.useStored) {
      const testResult = await testShopifyConnection({
        authMode: "access_token",
        shopDomain,
        accessToken: token.accessToken,
      });
      saveShopifyConnection({
        userId: user.id,
        deviceId,
        authMode: "access_token",
        shopDomain,
        accessToken: token.accessToken,
        tokenExpiresAt: expiresAt,
        testResult,
      });
    }
    return NextResponse.json({
      ok: true,
      accessToken: token.accessToken,
      expiresIn,
      tokenExpiresAt: expiresAt,
      tokenPreview: maskToken(token.accessToken),
      oauthCredentialsSaved: oauthCredentials.written,
      connection: body.useStored ? getShopifyConnection(user.id, deviceId) : null,
      connections: body.useStored
        ? getShopifyConnections(user.id, deviceId)
        : undefined,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 400;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
