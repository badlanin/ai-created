import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  deleteShopifyConnection,
  getShopifyConnection,
  getShopifyConnections,
  saveShopifyConnection,
  selectShopifyConnection,
  testShopifyConnection,
} from "@/lib/shopify";
import { getShopifyDeviceIdFromRequest } from "@/lib/shopify-device";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const connection = getShopifyConnection(user.id, deviceId);
    const connections = getShopifyConnections(user.id, deviceId);
    return NextResponse.json(
      connection
        ? { ...connection, connection, connections }
        : { bound: false, connection: null, connections },
    );
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
    const deviceId = getShopifyDeviceIdFromRequest(req);
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
      deviceId,
      shopDomain,
      authMode,
      accessToken,
      clientId,
      clientSecret,
      testResult,
    });
    return NextResponse.json({
      ok: true,
      connection: getShopifyConnection(user.id, deviceId),
      connections: getShopifyConnections(user.id, deviceId),
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const body = (await req.json()) as { shopDomain?: string };
    selectShopifyConnection(user.id, deviceId, String(body.shopDomain || ""));
    return NextResponse.json({
      ok: true,
      connection: getShopifyConnection(user.id, deviceId),
      connections: getShopifyConnections(user.id, deviceId),
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const shopDomain = req.nextUrl.searchParams.get("shopDomain") || undefined;
    deleteShopifyConnection(user.id, deviceId, shopDomain);
    const connection = getShopifyConnection(user.id, deviceId);
    const connections = getShopifyConnections(user.id, deviceId);
    return NextResponse.json(
      connection
        ? { ok: true, ...connection, connection, connections }
        : { ok: true, bound: false, connection: null, connections },
    );
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
