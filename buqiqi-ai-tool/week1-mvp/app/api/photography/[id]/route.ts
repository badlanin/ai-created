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
    if (typeof body.description === "string")
      push("description", body.description.trim() || null);
    if (typeof body.params_text === "string")
      push("params_text", body.params_text.trim());
    if (typeof body.sort_order === "number")
      push("sort_order", body.sort_order);

    const db = getDb();
    const makeDefault =
      typeof body.is_default === "boolean" ||
      typeof body.is_default === "number"
        ? body.is_default
          ? true
          : false
        : null;

    if (updates.length === 0 && makeDefault === null) {
      return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });
    }

    const tx = db.transaction(() => {
      if (makeDefault === true) {
        db.prepare(
          "UPDATE photography_params SET is_default = 0 WHERE id <> ?",
        ).run(id);
        updates.push("is_default = 1");
      } else if (makeDefault === false) {
        updates.push("is_default = 0");
      }
      if (updates.length > 0) {
        db.prepare(
          `UPDATE photography_params SET ${updates.join(", ")} WHERE id = ?`,
        ).run(...values, id);
      }
    });
    tx();

    const row = db
      .prepare(
        "SELECT id, name, description, params_text, is_default, sort_order, created_at FROM photography_params WHERE id = ?",
      )
      .get(id);
    if (!row) {
      return NextResponse.json({ error: "摄影参数不存在" }, { status: 404 });
    }
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
    const info = db
      .prepare("DELETE FROM photography_params WHERE id = ?")
      .run(id);
    if (info.changes === 0) {
      return NextResponse.json({ error: "摄影参数不存在" }, { status: 404 });
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
