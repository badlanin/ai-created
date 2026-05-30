import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";

export const runtime = "nodejs";

type PromptRow = {
  id: number;
  name: string;
  kind: string;
  template: string;
  notes: string | null;
  sort_order: number;
  created_at: number;
};

/**
 * GET /api/prompts?kind=on_model|recolor|generic
 * 所有已登录用户可读，不传 kind 返回全部
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const db = getDb();
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");

    let rows: PromptRow[];
    if (kind) {
      rows = db
        .prepare(
          "SELECT id, name, kind, template, notes, sort_order, created_at FROM prompt_templates WHERE kind = ? ORDER BY sort_order ASC, id ASC",
        )
        .all(kind) as PromptRow[];
    } else {
      rows = db
        .prepare(
          "SELECT id, name, kind, template, notes, sort_order, created_at FROM prompt_templates ORDER BY kind, sort_order ASC, id ASC",
        )
        .all() as PromptRow[];
    }
    return NextResponse.json(rows);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * POST /api/prompts
 * body: { name, kind, template, notes?, sort_order? }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const body = (await req.json()) as {
      name?: string;
      kind?: string;
      template?: string;
      notes?: string;
      sort_order?: number;
    };

    const name = (body.name || "").trim();
    const template = (body.template || "").trim();
    const kind = body.kind;

    if (!name) {
      return NextResponse.json({ error: "名称必填" }, { status: 400 });
    }
    if (!template) {
      return NextResponse.json({ error: "模板内容必填" }, { status: 400 });
    }
    if (!kind || !["recolor", "on_model", "generic"].includes(kind)) {
      return NextResponse.json(
        { error: "kind 必须是 recolor / on_model / generic" },
        { status: 400 },
      );
    }

    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO prompt_templates (name, kind, template, notes, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        kind,
        template,
        body.notes?.trim() || null,
        body.sort_order ?? 0,
        user.id,
      );

    const row = db
      .prepare(
        "SELECT id, name, kind, template, notes, sort_order, created_at FROM prompt_templates WHERE id = ?",
      )
      .get(result.lastInsertRowid);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
