import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * /api/scene-categories
 *
 * GET  — 列表（公开给所有登录用户，前端下拉用）
 * POST — admin 新增分类
 */

interface CategoryRow {
  id: number;
  key_id: string;
  label: string;
  sort_order: number;
}

export async function GET() {
  await requireUser();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, key_id, label, sort_order FROM scene_categories
       ORDER BY sort_order ASC, id ASC`,
    )
    .all() as CategoryRow[];
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as Partial<CategoryRow>;
    const keyId = String(body.key_id || "").trim();
    const label = String(body.label || "").trim();
    if (!keyId || !label) {
      return NextResponse.json(
        { error: "key_id 和 label 都必填" },
        { status: 400 },
      );
    }
    if (!/^[a-z][a-z0-9_]*$/.test(keyId)) {
      return NextResponse.json(
        { error: "key_id 只能用小写字母 / 数字 / 下划线，且字母开头" },
        { status: 400 },
      );
    }
    const sortOrder = Number(body.sort_order ?? 999);
    const db = getDb();
    const exists = db
      .prepare(`SELECT id FROM scene_categories WHERE key_id = ?`)
      .get(keyId) as { id: number } | undefined;
    if (exists) {
      return NextResponse.json(
        { error: `已存在 key_id="${keyId}"` },
        { status: 409 },
      );
    }
    const result = db
      .prepare(
        `INSERT INTO scene_categories (key_id, label, sort_order)
         VALUES (?, ?, ?)`,
      )
      .run(keyId, label, Number.isFinite(sortOrder) ? sortOrder : 999);
    const row = db
      .prepare(
        `SELECT id, key_id, label, sort_order FROM scene_categories WHERE id = ?`,
      )
      .get(result.lastInsertRowid) as CategoryRow;
    return NextResponse.json(row);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
