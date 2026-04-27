import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";
import { saveUploadFile } from "@/lib/uploads";
import {
  SCENE_CATEGORY_LABELS,
  sceneCategoryLabel,
} from "@/lib/scene-categories";

export const runtime = "nodejs";
export const maxDuration = 60;

type SceneRow = {
  id: number;
  name: string;
  image_path: string;
  tags: string | null;
  notes: string | null;
  category: string | null;
  sort_order: number;
  created_at: number;
};

function decorateScene(r: SceneRow) {
  return {
    ...r,
    image_url: r.image_path.startsWith("uploads/")
      ? `/assets/${r.image_path}`
      : r.image_path,
    category_label: r.category ? sceneCategoryLabel(r.category) : null,
  };
}

/**
 * GET /api/scenes
 *
 * 返回所有场景，附 image_url + category_label。
 * （前端按 category_label 分组展示）
 */
export async function GET() {
  try {
    await requireUser();
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, name, image_path, tags, notes, category, sort_order, created_at
         FROM scenes ORDER BY sort_order ASC, id ASC`,
      )
      .all() as SceneRow[];
    return NextResponse.json(rows.map(decorateScene));
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * GET /api/scenes/categories  ← 注：不要这条；分类列表用前端常量即可
 *
 * 暴露分类元数据给前端：[{ key, label }]
 */

/**
 * POST /api/scenes
 * formData: { image, name, tags?, notes?, category?, sort_order? }
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

    // 验证 category：必须在白名单里，否则记 null
    const rawCategory = (formData.get("category") as string | null)?.trim() || "";
    const category =
      rawCategory in SCENE_CATEGORY_LABELS ? rawCategory : null;

    const saved = await saveUploadFile(image, "scenes");

    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO scenes (name, image_path, tags, notes, category, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        saved.relPath,
        (formData.get("tags") as string | null)?.trim() || null,
        (formData.get("notes") as string | null)?.trim() || null,
        category,
        Number(formData.get("sort_order")) || 0,
        user.id,
      );

    const row = db
      .prepare(
        `SELECT id, name, image_path, tags, notes, category, sort_order, created_at
         FROM scenes WHERE id = ?`,
      )
      .get(result.lastInsertRowid) as SceneRow;

    return NextResponse.json(decorateScene(row), { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
