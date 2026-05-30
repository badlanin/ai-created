import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

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
    if (typeof body.type === "string") {
      if (!["full", "half", "closeup"].includes(body.type)) {
        return NextResponse.json({ error: "type 非法" }, { status: 400 });
      }
      push("type", body.type);
    }
    if (typeof body.tags === "string")
      push("tags", body.tags.trim() || null);
    if (typeof body.notes === "string")
      push("notes", body.notes.trim() || null);
    if (typeof body.is_hero === "boolean" || typeof body.is_hero === "number") {
      push("is_hero", body.is_hero ? 1 : 0);
    }
    if (typeof body.sort_order === "number")
      push("sort_order", body.sort_order);

    if (updates.length === 0) {
      return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });
    }

    const db = getDb();
    const info = db
      .prepare(`UPDATE poses SET ${updates.join(", ")} WHERE id = ?`)
      .run(...values, id);
    if (info.changes === 0) {
      return NextResponse.json({ error: "姿势不存在" }, { status: 404 });
    }

    const row = db
      .prepare(
        "SELECT id, name, text, type, tags, notes, is_hero, sort_order, created_at FROM poses WHERE id = ?",
      )
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
    const info = db.prepare("DELETE FROM poses WHERE id = ?").run(id);
    if (info.changes === 0) {
      return NextResponse.json({ error: "姿势不存在" }, { status: 404 });
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
