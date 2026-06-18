import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { DATA_DIR_PATH } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

/**
 * 水印文件约定：
 *   保存到 DATA_DIR/watermark/watermark.png
 *   可通过 /assets/watermark/watermark.png 访问（已有 /assets/[...path] 路由支持）
 */
const WATERMARK_FILE_PATH = path.join(DATA_DIR_PATH, "watermark", "watermark.png");

export async function GET() {
  try {
    await requireAdmin();
    const exists = await fs.stat(WATERMARK_FILE_PATH).then(() => true).catch(() => false);
    return NextResponse.json({ hasWatermark: exists });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "请上传 PNG 文件" }, { status: 400 });
    }
    if (!file.type.startsWith("image/png")) {
      return NextResponse.json({ error: "仅支持 PNG 格式" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "水印文件不能超过 10MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.mkdir(path.dirname(WATERMARK_FILE_PATH), { recursive: true });
    await fs.writeFile(WATERMARK_FILE_PATH, buffer);

    return NextResponse.json({
      ok: true,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

export async function DELETE() {
  try {
    await requireAdmin();
    await fs.unlink(WATERMARK_FILE_PATH).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
