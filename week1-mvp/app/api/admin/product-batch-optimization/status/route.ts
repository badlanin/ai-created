import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getProductBatchStatus } from "@/lib/product-batch-optimization";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const status = await getProductBatchStatus();
    return NextResponse.json({ ok: true, ...status });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
