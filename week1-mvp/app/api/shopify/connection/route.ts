import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  deleteShopifyConnection,
  getShopifyConnection,
  saveShopifyConnection,
  testShopifyConnection,
} from "@/lib/shopify";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const connection = getShopifyConnection(user.id);
    return NextResponse.json(connection || { bound: false });
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
    const body = (await req.json()) as {
      shopDomain?: string;
      accessToken?: string;
    };
    const shopDomain = String(body.shopDomain || "").trim();
    const accessToken = String(body.accessToken || "").trim();
    const testResult = await testShopifyConnection({ shopDomain, accessToken });
    saveShopifyConnection({
      userId: user.id,
      shopDomain,
      accessToken,
      testResult,
    });
    return NextResponse.json({
      ok: true,
      connection: getShopifyConnection(user.id),
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    deleteShopifyConnection(user.id);
    return NextResponse.json({ ok: true, bound: false });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
