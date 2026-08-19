import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getAmazonDashboard,
  startAmazonSupplierCollection,
} from "@/lib/amazon-info-collection";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as { jobId?: unknown };
    const job = startAmazonSupplierCollection(
      user.id,
      typeof body.jobId === "string" ? body.jobId : undefined,
    );
    return NextResponse.json(getAmazonDashboard(user.id, job.id));
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
