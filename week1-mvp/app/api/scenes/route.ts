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
  usage: "single" | "poster";
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
 * GET /api/scenes?usage=single|poster
 *
 * 返回场景列表，附 image_url + category_label。
 * 不传 usage 参数 = 全部返回（admin 后台用）；
 * 传 usage=single = 只返主图场景库（批量摄影 + 背景换图用）；
 * 传 usage=poster = 只返海报大场景库（氛围海报用）。
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const db = getDb();
    const url = new URL(req.url);
    const usage = url.searchParams.get("usage");

    let rows: SceneRow[];
    if (usage === "single" || usage === "poster") {
      rows = db
        .prepare(
          `SELECT id, name, image_path, tags, notes, category, usage, sort_order, created_at
           FROM scenes WHERE usage = ? ORDER BY sort_order ASC, id ASC`,
        )
        .all(usage) as SceneRow[];
    } else {
      rows = db
        .prepare(
          `SELECT id, name, image_path, tags, notes, category, usage, sort_order, created_at
           FROM scenes ORDER BY sort_order ASC, id ASC`,
        )
        .all() as SceneRow[];
    }
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

    // 验证 usage：'single' / 'poster'，缺省 'single'
    const rawUsage = (formData.get("usage") as string | null)?.trim() || "";
    const usage: "single" | "poster" =
      rawUsage === "poster" ? "poster" : "single";

    const saved = await saveUploadFile(image, "scenes");

    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO scenes (name, image_path, tags, notes, category, usage, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        saved.relPath,
        (formData.get("tags") as string | null)?.trim() || null,
        (formData.get("notes") as string | null)?.trim() || null,
        category,
        usage,
        Number(formData.get("sort_order")) || 0,
        user.id,
      );

    const row = db
      .prepare(
        `SELECT id, name, image_path, tags, notes, category, usage, sort_order, created_at
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
