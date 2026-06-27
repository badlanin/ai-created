import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { deleteProductBatchStore } from "@/lib/product-batch-optimization";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    await requireAdmin();
    const { key } = await params;
    const result = await deleteProductBatchStore(key);
    return NextResponse.json(result);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
