import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { exchangeShopifyClientCredentialsToken, maskToken } from "@/lib/shopify";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = (await req.json()) as {
      shopDomain?: string;
      clientId?: string;
      clientSecret?: string;
    };
    const token = await exchangeShopifyClientCredentialsToken({
      shopDomain: String(body.shopDomain || ""),
      clientId: String(body.clientId || ""),
      clientSecret: String(body.clientSecret || ""),
    });
    return NextResponse.json({
      ok: true,
      accessToken: token.accessToken,
      expiresIn: token.expiresIn,
      tokenPreview: maskToken(token.accessToken),
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 400;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
