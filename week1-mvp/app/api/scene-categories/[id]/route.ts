import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const idNum = Number(id);
    if (!Number.isFinite(idNum)) {
      return NextResponse.json({ error: "id 非法" }, { status: 400 });
    }
    const body = await req.json();
    const db = getDb();
    const exists = db
      .prepare(`SELECT id FROM scene_categories WHERE id = ?`)
      .get(idNum) as { id: number } | undefined;
    if (!exists) {
      return NextResponse.json({ error: "分类不存在" }, { status: 404 });
    }
    const sets: string[] = [];
    const args: Record<string, unknown> = { id: idNum };
    if (typeof body.label === "string" && body.label.trim()) {
      sets.push("label = @label");
      args.label = body.label.trim();
    }
    if (Number.isFinite(Number(body.sort_order))) {
      sets.push("sort_order = @sort_order");
      args.sort_order = Number(body.sort_order);
    }
    // key_id 不允许改（被 scenes.category 引用）
    if (sets.length === 0) {
      return NextResponse.json({ error: "没有可更新字段" }, { status: 400 });
    }
    db.prepare(
      `UPDATE scene_categories SET ${sets.join(", ")} WHERE id = @id`,
    ).run(args);
    const row = db
      .prepare(
        `SELECT id, key_id, label, sort_order FROM scene_categories WHERE id = ?`,
      )
      .get(idNum);
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const idNum = Number(id);
    if (!Number.isFinite(idNum)) {
      return NextResponse.json({ error: "id 非法" }, { status: 400 });
    }
    const db = getDb();
    const row = db
      .prepare(`SELECT key_id FROM scene_categories WHERE id = ?`)
      .get(idNum) as { key_id: string } | undefined;
    if (!row) {
      return NextResponse.json({ error: "分类不存在" }, { status: 404 });
    }
    // 检查是否有 scenes 还引用这个 category（避免悬挂引用）
    const used = db
      .prepare(`SELECT COUNT(*) AS c FROM scenes WHERE category = ?`)
      .get(row.key_id) as { c: number };
    if (used.c > 0) {
      return NextResponse.json(
        {
          error: `还有 ${used.c} 张场景使用该分类，请先把那些场景改成其他分类再删`,
        },
        { status: 400 },
      );
    }
    db.prepare(`DELETE FROM scene_categories WHERE id = ?`).run(idNum);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
