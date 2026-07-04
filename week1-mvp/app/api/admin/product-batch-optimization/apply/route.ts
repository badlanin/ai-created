import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { applyProductBatchRun } from "@/lib/product-batch-optimization";
import { getShopifyDeviceIdFromRequest } from "@/lib/shopify-device";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const body = (await req.json()) as {
      runId?: string;
      selectedProductIds?: string[];
      selectedProposalKeys?: string[];
      selectedStoreKeys?: string[];
      skipImageAlt?: boolean;
      applyFaq?: boolean;
      setDraft?: boolean;
    };
    if (!body.runId) {
      return NextResponse.json({ error: "runId 必填" }, { status: 400 });
    }
    const result = await applyProductBatchRun({
      user,
      deviceId,
      runId: body.runId,
      selectedProductIds: body.selectedProductIds,
      selectedProposalKeys: body.selectedProposalKeys,
      selectedStoreKeys: body.selectedStoreKeys,
      skipImageAlt: body.skipImageAlt !== false,
      applyFaq: body.applyFaq,
      setDraft: body.setDraft,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
