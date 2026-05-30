import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  activateShopifyConnection,
  getShopifyConnection,
  listShopifyConnections,
} from "@/lib/shopify";
import {
  normalizeShopifyDeviceKey,
  SHOPIFY_DEVICE_HEADER,
} from "@/lib/shopify-device";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const deviceKey = normalizeShopifyDeviceKey(
      req.headers.get(SHOPIFY_DEVICE_HEADER),
    );
    const { id } = await params;
    const connectionId = Number(id);
    if (!Number.isFinite(connectionId)) {
      return NextResponse.json({ error: "店铺记录 id 无效" }, { status: 400 });
    }
    activateShopifyConnection(user.id, connectionId, deviceKey);
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
