import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";
import {
  saveUploadFile,
  checkPngTransparency,
  deleteUploadFile,
} from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 60;

type IdentityRow = {
  id: number;
  name: string;
  image_path: string;
  tags: string | null;
  notes: string | null;
  sort_order: number;
  created_at: number;
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
        `SELECT id, name, image_path, tags, notes, sort_order, created_at
         FROM models WHERE kind = 'identity'
         ORDER BY sort_order ASC, id ASC`,
      )
      .all() as IdentityRow[];

    // 附加可访问的 URL
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
 * POST /api/identities
 * formData: { image: File, name, tags?, notes?, sort_order? }
 * 强制 PNG 透明底（否则模特背景会污染场景）
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

    // 透明 PNG 校验
    const { isPng, hasAlphaChannel } = await checkPngTransparency(image);
    if (!isPng) {
      return NextResponse.json(
        {
          error:
            "请上传 PNG 透明背景图。模特图若带背景会污染最终场景。可用 Remove.bg 或 Photoshop 抠图后再上传。",
        },
        { status: 400 },
      );
    }
    if (!hasAlphaChannel) {
      return NextResponse.json(
        {
          error:
            "PNG 文件不包含透明通道（Alpha channel）。请确认是透明背景 PNG，而不是带白底的 PNG。",
        },
        { status: 400 },
      );
    }

    // 保存文件
    const saved = await saveUploadFile(image, "identities");

    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO models (kind, name, image_path, tags, notes, sort_order, created_by)
         VALUES ('identity', ?, ?, ?, ?, ?, ?)`,
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
         FROM models WHERE id = ?`,
      )
      .get(result.lastInsertRowid) as IdentityRow;
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
