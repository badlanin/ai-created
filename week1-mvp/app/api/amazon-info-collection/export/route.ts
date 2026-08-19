import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { exportAmazonCollectionCsv } from "@/lib/amazon-info-collection";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const jobId = req.nextUrl.searchParams.get("jobId") || undefined;
    const file = exportAmazonCollectionCsv(user.id, jobId);
    return new NextResponse(file.content, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      },
    });
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
