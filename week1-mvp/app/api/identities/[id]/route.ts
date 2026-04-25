import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { deleteUploadFile } from "@/lib/uploads";

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
    if (typeof body.tags === "string")
      push("tags", body.tags.trim() || null);
    if (typeof body.notes === "string")
      push("notes", body.notes.trim() || null);
    if (typeof body.category === "string" || body.category === null) {
      // 允许显式传 null 清空分类
      const v =
        body.category === null
          ? null
          : (body.category as string).trim() || null;
      push("category", v);
    }
    if (typeof body.sort_order === "number")
      push("sort_order", body.sort_order);

    if (updates.length === 0) {
      return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });
    }

    const db = getDb();
    const info = db
      .prepare(
        `UPDATE models SET ${updates.join(", ")} WHERE id = ? AND kind = 'identity'`,
      )
      .run(...values, id);
    if (info.changes === 0) {
      return NextResponse.json({ error: "模特不存在" }, { status: 404 });
    }
    const row = db
      .prepare(
        `SELECT id, name, image_path, tags, notes, category, sort_order, created_at FROM models WHERE id = ?`,
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
    const row = db
      .prepare(
        `SELECT image_path FROM models WHERE id = ? AND kind = 'identity'`,
      )
      .get(id) as { image_path: string } | undefined;
    if (!row) {
      return NextResponse.json({ error: "模特不存在" }, { status: 404 });
    }
    db.prepare(`DELETE FROM models WHERE id = ? AND kind = 'identity'`).run(id);
    await deleteUploadFile(row.image_path);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
