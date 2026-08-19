import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  createAmazonCollectionImport,
  getAmazonDashboard,
  startAmazonSupplierCollection,
} from "@/lib/amazon-info-collection";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { input?: unknown; urls?: unknown };
    const input =
      typeof body.input === "string"
        ? body.input
        : Array.isArray(body.urls)
          ? body.urls.join("\n")
          : "";
    const dashboard = createAmazonCollectionImport(user.id, input);
    if (dashboard.job) {
      startAmazonSupplierCollection(user.id, dashboard.job.id);
      return NextResponse.json(getAmazonDashboard(user.id, dashboard.job.id));
    }
    return NextResponse.json(dashboard);
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
