import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { syncShopifyProduct, type ShopifyProductDraftInput } from "@/lib/shopify";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { product?: ShopifyProductDraftInput };
    if (!body.product) {
      return NextResponse.json({ error: "product 必填" }, { status: 400 });
    }
    const result = await syncShopifyProduct(user.id, body.product);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
