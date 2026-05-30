import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * 表情库 API（独立维度，仅描述脸部 / 眼神 / 嘴部 / 视线方向 / 情绪）
 *
 * 设计：批量摄影时全局单选——所有姿势共用同一个表情，注入 prompt 的
 *      {{expression}} 占位符。姿势文本只描述身体，互不冲突。
 */

type ExpressionRow = {
  id: number;
  name: string;
  text: string;
  is_default: number;
  sort_order: number;
  created_at: number;
};

const EXPR_COLS = "id, name, text, is_default, sort_order, created_at";

/** GET /api/expressions  所有登录用户可读 */
export async function GET() {
  try {
    await requireUser();
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT ${EXPR_COLS} FROM expressions ORDER BY is_default DESC, sort_order ASC, id ASC`,
      )
      .all() as ExpressionRow[];
    return NextResponse.json(rows);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/** POST /api/expressions  仅管理员 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const body = (await req.json()) as {
      name?: string;
      text?: string;
      is_default?: boolean | number;
      sort_order?: number;
    };

    const name = (body.name || "").trim();
    const text = (body.text || "").trim();
    if (!name) {
      return NextResponse.json({ error: "名称必填" }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: "表情描述必填" }, { status: 400 });
    }

    const isDefault = body.is_default ? 1 : 0;
    const db = getDb();

    // 设默认时清掉其他默认（保持唯一）
    if (isDefault) {
      db.prepare(`UPDATE expressions SET is_default = 0`).run();
    }

    const result = db
      .prepare(
        `INSERT INTO expressions (name, text, is_default, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(name, text, isDefault, body.sort_order ?? 0, user.id);

    const row = db
      .prepare(`SELECT ${EXPR_COLS} FROM expressions WHERE id = ?`)
      .get(result.lastInsertRowid) as ExpressionRow;

    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
