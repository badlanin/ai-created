import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/materials
 * 所有登录用户可读
 */
export async function GET() {
  try {
    await requireUser();
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, name, english_name, aliases, description,
                visual_traits, light_behavior, texture_rules, dont_confuse_with,
                sort_order, created_at
         FROM materials ORDER BY sort_order ASC, id ASC`,
      )
      .all();
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
 * POST /api/materials
 * body: { name, english_name?, aliases?, description?, visual_traits?, light_behavior?, texture_rules?, dont_confuse_with?, sort_order? }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const body = (await req.json()) as Record<string, unknown>;
    const name = (body.name as string | undefined)?.trim();
    if (!name) {
      return NextResponse.json({ error: "名称必填" }, { status: 400 });
    }

    const db = getDb();
    const fields = {
      name,
      english_name: (body.english_name as string)?.trim() || null,
      aliases: (body.aliases as string)?.trim() || null,
      description: (body.description as string)?.trim() || null,
      visual_traits: (body.visual_traits as string)?.trim() || null,
      light_behavior: (body.light_behavior as string)?.trim() || null,
      texture_rules: (body.texture_rules as string)?.trim() || null,
      dont_confuse_with: (body.dont_confuse_with as string)?.trim() || null,
      sort_order: typeof body.sort_order === "number" ? body.sort_order : 0,
      created_by: user.id,
    };

    const result = db
      .prepare(
        `INSERT INTO materials
           (name, english_name, aliases, description, visual_traits, light_behavior,
            texture_rules, dont_confuse_with, sort_order, created_by)
         VALUES (@name, @english_name, @aliases, @description, @visual_traits, @light_behavior,
                 @texture_rules, @dont_confuse_with, @sort_order, @created_by)`,
      )
      .run(fields);

    const row = db
      .prepare(`SELECT * FROM materials WHERE id = ?`)
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
