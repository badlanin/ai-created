import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listProductBatchRuns } from "@/lib/product-batch-optimization";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUser();
    const runs = await listProductBatchRuns();
    return NextResponse.json({ ok: true, runs });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
