import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

const EXPR_COLS = "id, name, text, is_default, sort_order, created_at";

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id 不合法" }, { status: 400 });
    }
    const body = (await req.json()) as Record<string, unknown>;

    const updates: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, val: unknown) => {
      updates.push(`${col} = ?`);
      values.push(val);
    };

    if (typeof body.name === "string") push("name", body.name.trim());
    if (typeof body.text === "string") push("text", body.text.trim());
    if (typeof body.sort_order === "number")
      push("sort_order", body.sort_order);

    const wantDefault =
      typeof body.is_default === "boolean" || typeof body.is_default === "number";

    if (updates.length === 0 && !wantDefault) {
      return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });
    }

    const db = getDb();

    // is_default = 全局唯一，设了就清其它
    if (wantDefault && body.is_default) {
      db.prepare(`UPDATE expressions SET is_default = 0`).run();
      push("is_default", 1);
    } else if (wantDefault && !body.is_default) {
      push("is_default", 0);
    }

    if (updates.length > 0) {
      const info = db
        .prepare(`UPDATE expressions SET ${updates.join(", ")} WHERE id = ?`)
        .run(...values, id);
      if (info.changes === 0) {
        return NextResponse.json({ error: "表情不存在" }, { status: 404 });
      }
    }

    const row = db
      .prepare(`SELECT ${EXPR_COLS} FROM expressions WHERE id = ?`)
      .get(id);
    return NextResponse.json(row);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id 不合法" }, { status: 400 });
    }
    const db = getDb();
    const info = db.prepare("DELETE FROM expressions WHERE id = ?").run(id);
    if (info.changes === 0) {
      return NextResponse.json({ error: "表情不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
