import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  deleteShopifyConnection,
  getShopifyConnection,
  listShopifyConnections,
} from "@/lib/shopify";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const connectionId = Number(id);
    if (!Number.isFinite(connectionId)) {
      return NextResponse.json({ error: "店铺记录 id 无效" }, { status: 400 });
    }
    deleteShopifyConnection(user.id, connectionId);
    return NextResponse.json({
      ok: true,
      active: getShopifyConnection(user.id),
      connections: listShopifyConnections(user.id),
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
