import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";
import { saveUploadFile } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 60;

type SceneRow = {
  id: number;
  name: string;
  image_path: string;
  tags: string | null;
  notes: string | null;
  sort_order: number;
  created_at: number;
};

export async function GET() {
  try {
    await requireUser();
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, name, image_path, tags, notes, sort_order, created_at
         FROM scenes ORDER BY sort_order ASC, id ASC`,
      )
      .all() as SceneRow[];
    const withUrl = rows.map((r) => ({
      ...r,
      image_url: r.image_path.startsWith("uploads/")
        ? `/assets/${r.image_path}`
        : r.image_path,
    }));
    return NextResponse.json(withUrl);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * POST /api/scenes
 * formData: { image, name, tags?, notes?, sort_order? }
 * 场景图允许任意格式（JPG/PNG/WEBP），不强制透明
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const formData = await req.formData();

    const image = formData.get("image");
    if (!(image instanceof File)) {
      return NextResponse.json({ error: "请上传图片" }, { status: 400 });
    }
    const name = (formData.get("name") as string | null)?.trim() || "";
    if (!name) {
      return NextResponse.json({ error: "名称必填" }, { status: 400 });
    }

    if (image.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "图片太大（限 20MB 内），请压缩后重试" },
        { status: 400 },
      );
    }

    const saved = await saveUploadFile(image, "scenes");

    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO scenes (name, image_path, tags, notes, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        saved.relPath,
        (formData.get("tags") as string | null)?.trim() || null,
        (formData.get("notes") as string | null)?.trim() || null,
        Number(formData.get("sort_order")) || 0,
        user.id,
      );

    const row = db
      .prepare(
        `SELECT id, name, image_path, tags, notes, sort_order, created_at
         FROM scenes WHERE id = ?`,
      )
      .get(result.lastInsertRowid) as SceneRow;

    return NextResponse.json(
      { ...row, image_url: `/assets/${row.image_path}` },
      { status: 201 },
    );
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
