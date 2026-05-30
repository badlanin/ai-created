import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUser();
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, name, description, constraints_text, is_default, sort_order, created_at
         FROM realism_presets ORDER BY is_default DESC, sort_order ASC, id ASC`,
      )
      .all();
    return NextResponse.json(rows);
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
    const user = await requireAdmin();
    const body = (await req.json()) as {
      name?: string;
      description?: string;
      constraints_text?: string;
      is_default?: boolean | number;
      sort_order?: number;
    };

    const name = (body.name || "").trim();
    const constraints_text = (body.constraints_text || "").trim();
    if (!name || !constraints_text) {
      return NextResponse.json(
        { error: "名称和约束内容必填" },
        { status: 400 },
      );
    }

    const db = getDb();
    const is_default = body.is_default ? 1 : 0;

    const tx = db.transaction(() => {
      if (is_default) {
        db.prepare(`UPDATE realism_presets SET is_default = 0`).run();
      }
      const result = db
        .prepare(
          `INSERT INTO realism_presets (name, description, constraints_text, is_default, sort_order, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          name,
          body.description?.trim() || null,
          constraints_text,
          is_default,
          body.sort_order ?? 0,
          user.id,
        );
      return result.lastInsertRowid as number;
    });
    const newId = tx();

    const row = db
      .prepare(`SELECT * FROM realism_presets WHERE id = ?`)
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
