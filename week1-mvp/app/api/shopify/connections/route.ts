import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getShopifyConnection,
  listShopifyConnections,
  saveShopifyConnection,
  testShopifyConnection,
} from "@/lib/shopify";
import {
  normalizeShopifyDeviceKey,
  SHOPIFY_DEVICE_HEADER,
} from "@/lib/shopify-device";

export const runtime = "nodejs";

function getDeviceKey(req: NextRequest): string {
  return normalizeShopifyDeviceKey(req.headers.get(SHOPIFY_DEVICE_HEADER));
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceKey = getDeviceKey(req);
    const active = getShopifyConnection(user.id, deviceKey);
    return NextResponse.json({
      active,
      connections: listShopifyConnections(user.id, deviceKey),
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceKey = getDeviceKey(req);
    const body = (await req.json()) as {
      authMode?: "access_token" | "oauth_app" | "client_credentials";
      shopDomain?: string;
      accessToken?: string;
      clientId?: string;
      clientSecret?: string;
    };
    const authMode =
      body.authMode === "oauth_app"
        ? "oauth_app"
        : body.authMode === "client_credentials"
          ? "client_credentials"
          : "access_token";
    const shopDomain = String(body.shopDomain || "").trim();
    const accessToken = String(body.accessToken || "").trim();
    const clientId = String(body.clientId || "").trim();
    const clientSecret = String(body.clientSecret || "").trim();
    const testResult = await testShopifyConnection({
      authMode,
      shopDomain,
      accessToken,
      clientId,
      clientSecret,
    });
    saveShopifyConnection({
      userId: user.id,
      deviceKey,
      shopDomain,
      authMode,
      accessToken,
      clientId,
      clientSecret,
      testResult,
    });
    return NextResponse.json({
      ok: true,
      active: getShopifyConnection(user.id, deviceKey),
      connections: listShopifyConnections(user.id, deviceKey),
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
