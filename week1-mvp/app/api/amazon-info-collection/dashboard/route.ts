import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAmazonDashboard } from "@/lib/amazon-info-collection";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const jobId = req.nextUrl.searchParams.get("jobId") || undefined;
    return NextResponse.json(getAmazonDashboard(user.id, jobId));
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
