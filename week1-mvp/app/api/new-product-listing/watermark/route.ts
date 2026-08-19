import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireUser } from "@/lib/auth";
import { DATA_DIR_PATH } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

/**
 * 水印文件约定：
 *   文件存到 DATA_DIR/watermark/{id}.png
 *   元信息存到 DATA_DIR/watermark/manifest.json
 *
 * manifest.json 结构：
 *   { watermarks: [{ id, name, uploadedAt }] }
 */
const WATERMARK_DIR = path.join(
  DATA_DIR_PATH,
  "new-product-listing-watermark",
);
const MANIFEST_PATH = path.join(WATERMARK_DIR, "manifest.json");

type WatermarkEntry = {
  id: string;
  name: string;
  uploadedAt: number;
};

async function readManifest(): Promise<WatermarkEntry[]> {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data.watermarks) ? data.watermarks : [];
  } catch {
    return [];
  }
}

async function writeManifest(entries: WatermarkEntry[]) {
  await fs.mkdir(WATERMARK_DIR, { recursive: true });
  await fs.writeFile(MANIFEST_PATH, JSON.stringify({ watermarks: entries }, null, 2), "utf-8");
}

/**
 * GET /api/new-product-listing/watermark — 返回所有水印列表（所有登录用户可用）
 */
export async function GET() {
  try {
    await requireUser();
    const entries = await readManifest();
    const list = entries.map((e) => ({
      ...e,
      previewUrl: `/assets/new-product-listing-watermark/${e.id}.png?t=${e.uploadedAt}`,
    }));
    return NextResponse.json({ watermarks: list });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * POST /api/new-product-listing/watermark — 上传水印（仅管理员）
 * formData: { file, name }
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const formData = await req.formData();
    const file = formData.get("file");
    const name = (formData.get("name") as string)?.trim();
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "请上传 PNG 文件" }, { status: 400 });
    }
    if (!file.type.startsWith("image/png")) {
      return NextResponse.json({ error: "仅支持 PNG 格式" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "水印文件不能超过 10MB" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "请输入水印名称" }, { status: 400 });
    }

    // 生成唯一 ID
    const id = `wm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.mkdir(WATERMARK_DIR, { recursive: true });
    await fs.writeFile(path.join(WATERMARK_DIR, `${id}.png`), buffer);

    const entries = await readManifest();
    entries.push({ id, name, uploadedAt: Date.now() });
    await writeManifest(entries);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * DELETE /api/new-product-listing/watermark — 删除水印（仅管理员）
 * body: { id }
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as { id?: string };
    if (!body.id) {
      return NextResponse.json({ error: "请提供水印 id" }, { status: 400 });
    }
    // 删除文件
    await fs.unlink(path.join(WATERMARK_DIR, `${body.id}.png`)).catch(() => {});
    // 从 manifest 移除
    const entries = await readManifest();
    await writeManifest(entries.filter((e) => e.id !== body.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
