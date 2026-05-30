import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";
import { saveUploadFile } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 60;

type IdentityRow = {
  id: number;
  name: string;
  image_path: string;
  tags: string | null;
  notes: string | null;
  category: string | null;
  sort_order: number;
  created_at: number;
};

// 模特分类的中文显示名（与 seed-assets/identities/manifest.json 保持一致）
const IDENTITY_CATEGORY_LABELS: Record<string, string> = {
  universal: "通用",
  plus_size: "大码",
  maternity: "孕妇",
  teen: "青少年",
};

/**
 * GET /api/identities
 * 返回所有模特形象（models 表 kind='identity'）
 */
export async function GET() {
  try {
    await requireUser();
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, name, image_path, tags, notes, category, sort_order, created_at
         FROM models WHERE kind = 'identity'
         ORDER BY sort_order ASC, id ASC`,
      )
      .all() as IdentityRow[];

    // 附加可访问的 URL + 分类显示名
    const withUrl = rows.map((r) => ({
      ...r,
      image_url: r.image_path.startsWith("uploads/")
        ? `/assets/${r.image_path}`
        : r.image_path,
      category_label: r.category
        ? IDENTITY_CATEGORY_LABELS[r.category] || r.category
        : null,
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
 * POST /api/identities
 * formData: { image: File, name, tags?, notes?, sort_order? }
 *
 * 接受 PNG / JPG / WebP。透明底 PNG 合成效果最好但不强制 ——
 * 用户也可能用 AI 生成的带背景模特图（如假人模特带影棚背景）
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

    // 文件类型基础校验（图像即可）
    const mimeType = image.type || "";
    const isImage =
      mimeType.startsWith("image/") &&
      ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mimeType);
    if (!isImage) {
      return NextResponse.json(
        { error: "请上传 PNG / JPG / WebP 格式的图片" },
        { status: 400 },
      );
    }

    // 保存文件
    const saved = await saveUploadFile(image, "identities");

    // 分类（可选；管理员上传时按需指定）
    const rawCategory = (formData.get("category") as string | null)?.trim() || "";
    const category = rawCategory in IDENTITY_CATEGORY_LABELS ? rawCategory : null;

    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO models (kind, name, image_path, tags, notes, category, sort_order, created_by)
         VALUES ('identity', ?, ?, ?, ?, ?, ?, ?)`,
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
         FROM models WHERE id = ?`,
      )
      .get(result.lastInsertRowid) as IdentityRow;
    return NextResponse.json(
      {
        ...row,
        image_url: `/assets/${row.image_path}`,
        category_label: row.category
          ? IDENTITY_CATEGORY_LABELS[row.category] || row.category
          : null,
      },
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
