import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/ai-models/:id
 * body: 任意字段（label / description / enabled / is_default / badge / sort_order / category）
 *
 * is_default = true 时会自动把同 category 其他默认清掉。
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id 不合法" }, { status: 400 });
    }
    const body = (await req.json()) as Record<string, unknown>;

    const db = getDb();
    const existing = db
      .prepare(`SELECT id, category FROM ai_models WHERE id = ?`)
      .get(id) as { id: number; category: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: "模型不存在" }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, val: unknown) => {
      updates.push(`${col} = ?`);
      values.push(val);
    };

    if (typeof body.label === "string") push("label", body.label.trim());
    if (typeof body.description === "string")
      push("description", body.description.trim() || null);
    if (typeof body.badge === "string")
      push("badge", body.badge.trim() || null);
    if (typeof body.sort_order === "number")
      push("sort_order", body.sort_order);
    if (typeof body.enabled === "boolean" || typeof body.enabled === "number") {
      push("enabled", body.enabled ? 1 : 0);
    }

    let makeDefault = false;
    if (
      typeof body.is_default === "boolean" ||
      typeof body.is_default === "number"
    ) {
      if (body.is_default) {
        makeDefault = true;
      } else {
        push("is_default", 0);
      }
    }

    if (updates.length === 0 && !makeDefault) {
      return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });
    }

    const tx = db.transaction(() => {
      if (makeDefault) {
        // 同 category 其他先清掉
        db.prepare(
          `UPDATE ai_models SET is_default = 0 WHERE category = ? AND id <> ?`,
        ).run(existing.category, id);
        updates.push("is_default = 1");
      }
      if (updates.length > 0) {
        db.prepare(
          `UPDATE ai_models SET ${updates.join(", ")} WHERE id = ?`,
        ).run(...values, id);
      }
    });
    tx();

    const row = db.prepare(`SELECT * FROM ai_models WHERE id = ?`).get(id);
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
 * DELETE /api/admin/ai-models/:id
 * 硬删。如果删掉的是当前 category 的唯一默认项，记得去管理页重新设另一个。
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id 不合法" }, { status: 400 });
    }
    const db = getDb();
    const info = db.prepare(`DELETE FROM ai_models WHERE id = ?`).run(id);
    if (info.changes === 0) {
      return NextResponse.json({ error: "模型不存在" }, { status: 404 });
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
