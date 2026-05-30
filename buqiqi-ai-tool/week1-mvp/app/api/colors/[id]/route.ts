import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

type ColorRow = {
  id: number;
  name: string;
  hex: string;
  color_group: string | null;
  is_popular: number;
  sort_order: number;
};

function normalizeHex(input: string): string | null {
  let s = input.trim().toUpperCase();
  if (!s.startsWith("#")) s = "#" + s;
  if (/^#[0-9A-F]{3}$/.test(s)) {
    s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }
  if (!/^#[0-9A-F]{6}$/.test(s)) return null;
  return s;
}

/**
 * PATCH /api/colors/:id  body: { name?, hex?, sort_order? }
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id: idStr } = await ctx.params;
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id))
      return NextResponse.json({ error: "无效 id" }, { status: 400 });

    const body = (await req.json()) as {
      name?: string;
      hex?: string;
      color_group?: string | null;
      is_popular?: boolean;
      sort_order?: number;
    };

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name)
        return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
      updates.push("name = ?");
      values.push(name);
    }
    if (body.hex !== undefined) {
      const hex = normalizeHex(body.hex);
      if (!hex)
        return NextResponse.json(
          { error: "HEX 色号不合法" },
          { status: 400 },
        );
      updates.push("hex = ?");
      values.push(hex);
    }
    if (body.color_group !== undefined) {
      const cg =
        body.color_group === null ? null : (body.color_group || "").trim() || null;
      updates.push("color_group = ?");
      values.push(cg);
    }
    if (body.is_popular !== undefined) {
      updates.push("is_popular = ?");
      values.push(body.is_popular ? 1 : 0);
    }
    if (body.sort_order !== undefined) {
      updates.push("sort_order = ?");
      values.push(body.sort_order);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });
    }

    values.push(id);
    const db = getDb();
    db.prepare(`UPDATE colors SET ${updates.join(", ")} WHERE id = ?`).run(
      ...values,
    );

    const row = db
      .prepare(
        `SELECT id, name, hex, color_group, is_popular, sort_order
         FROM colors WHERE id = ?`,
      )
      .get(id) as ColorRow | undefined;

    if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
    return NextResponse.json(row);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * DELETE /api/colors/:id
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id: idStr } = await ctx.params;
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id))
      return NextResponse.json({ error: "无效 id" }, { status: 400 });

    const db = getDb();
    db.prepare("DELETE FROM colors WHERE id = ?").run(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
