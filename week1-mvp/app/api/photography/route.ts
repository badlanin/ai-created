import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";

export const runtime = "nodejs";

type PhotographyRow = {
  id: number;
  name: string;
  description: string | null;
  params_text: string;
  is_default: 0 | 1;
  sort_order: number;
  created_at: number;
};

/**
 * GET /api/photography
 * 所有已登录用户可读
 */
export async function GET() {
  try {
    await requireUser();
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT id, name, description, params_text, is_default, sort_order, created_at FROM photography_params ORDER BY is_default DESC, sort_order ASC, id ASC",
      )
      .all() as PhotographyRow[];
    return NextResponse.json(rows);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * POST /api/photography
 * body: { name, description?, params_text, is_default?, sort_order? }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const body = (await req.json()) as {
      name?: string;
      description?: string;
      params_text?: string;
      is_default?: boolean | number;
      sort_order?: number;
    };

    const name = (body.name || "").trim();
    const params_text = (body.params_text || "").trim();

    if (!name) {
      return NextResponse.json({ error: "名称必填" }, { status: 400 });
    }
    if (!params_text) {
      return NextResponse.json(
        { error: "摄影参数内容必填" },
        { status: 400 },
      );
    }

    const db = getDb();
    const is_default = body.is_default ? 1 : 0;

    const tx = db.transaction(() => {
      if (is_default) {
        db.prepare(`UPDATE photography_params SET is_default = 0`).run();
      }
      const result = db
        .prepare(
          `INSERT INTO photography_params (name, description, params_text, is_default, sort_order, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          name,
          body.description?.trim() || null,
          params_text,
          is_default,
          body.sort_order ?? 0,
          user.id,
        );
      return result.lastInsertRowid as number;
    });
    const newId = tx();

    const row = db
      .prepare(
        "SELECT id, name, description, params_text, is_default, sort_order, created_at FROM photography_params WHERE id = ?",
      )
      .get(newId);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
