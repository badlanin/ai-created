import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

const EDITABLE = [
  "name",
  "english_name",
  "aliases",
  "description",
  "visual_traits",
  "light_behavior",
  "texture_rules",
  "dont_confuse_with",
  "sort_order",
] as const;

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

    for (const col of EDITABLE) {
      if (col in body) {
        let val = body[col];
        if (typeof val === "string") val = val.trim() || null;
        if (col === "sort_order" && typeof val !== "number") continue;
        if (col === "name" && !val) {
          return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
        }
        updates.push(`${col} = ?`);
        values.push(val);
      }
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });
    }

    const db = getDb();
    const info = db
      .prepare(`UPDATE materials SET ${updates.join(", ")} WHERE id = ?`)
      .run(...values, id);
    if (info.changes === 0) {
      return NextResponse.json({ error: "材质不存在" }, { status: 404 });
    }

    const row = db.prepare(`SELECT * FROM materials WHERE id = ?`).get(id);
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
    const info = db.prepare("DELETE FROM materials WHERE id = ?").run(id);
    if (info.changes === 0) {
      return NextResponse.json({ error: "材质不存在" }, { status: 404 });
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
