import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { deleteUploadFile } from "@/lib/uploads";
import { SCENE_CATEGORY_LABELS } from "@/lib/scene-categories";

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
    if (typeof body.sort_order === "number")
      push("sort_order", body.sort_order);
    // category：null = 清空；字符串 = 验证白名单
    if (body.category === null) {
      push("category", null);
    } else if (typeof body.category === "string") {
      const c = body.category.trim();
      const valid = c === "" ? null : c in SCENE_CATEGORY_LABELS ? c : null;
      push("category", valid);
    }
    // usage：'single' / 'poster'，其他值忽略
    if (typeof body.usage === "string") {
      const u = body.usage.trim();
      if (u === "single" || u === "poster") {
        push("usage", u);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });
    }

    const db = getDb();
    const info = db
      .prepare(`UPDATE scenes SET ${updates.join(", ")} WHERE id = ?`)
      .run(...values, id);
    if (info.changes === 0) {
      return NextResponse.json({ error: "场景不存在" }, { status: 404 });
    }
    const row = db.prepare(`SELECT * FROM scenes WHERE id = ?`).get(id);
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
      .prepare(`SELECT image_path FROM scenes WHERE id = ?`)
      .get(id) as { image_path: string } | undefined;
    if (!row) {
      return NextResponse.json({ error: "场景不存在" }, { status: 404 });
    }
    db.prepare(`DELETE FROM scenes WHERE id = ?`).run(id);
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
