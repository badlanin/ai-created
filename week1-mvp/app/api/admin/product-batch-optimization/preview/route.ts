import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  createProductBatchPreview,
  failProductBatchPreview,
} from "@/lib/product-batch-optimization";
import { getShopifyDeviceIdFromRequest } from "@/lib/shopify-device";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const body = (await req.json()) as {
      jobId?: string;
      storeKeys?: string[];
      query?: string;
      start?: number;
      limit?: number;
      prompt?: string;
      includeImages?: boolean;
      includeApplied?: boolean;
      model?: string | null;
      background?: boolean;
    };
    const input = {
      user,
      deviceId,
      jobId: body.jobId,
      storeKeys: body.storeKeys,
      query: body.query,
      start: body.start,
      limit: body.limit,
      prompt: body.prompt,
      includeImages: body.includeImages,
      includeApplied: body.includeApplied,
      model: body.model,
    };
    if (body.background && body.jobId) {
      void createProductBatchPreview(input).catch((error) => {
        failProductBatchPreview(body.jobId || "", error);
      });
      return NextResponse.json({ ok: true, queued: true, jobId: body.jobId });
    }
    const run = await createProductBatchPreview(input);
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}