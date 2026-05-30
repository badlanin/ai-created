import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";

export const runtime = "nodejs";

type PoseRow = {
  id: number;
  name: string;
  text: string;
  type: "full" | "half" | "closeup";
  tags: string | null;
  notes: string | null;
  is_hero: number;
  sort_order: number;
  created_at: number;
};

const POSE_COLS =
  "id, name, text, type, tags, notes, is_hero, sort_order, created_at";

/**
 * GET /api/poses?type=full|half|closeup
 * 所有已登录用户可读，不传 type 返回全部
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const db = getDb();
    const url = new URL(req.url);
    const type = url.searchParams.get("type");

    let rows: PoseRow[];
    if (type && ["full", "half", "closeup"].includes(type)) {
      rows = db
        .prepare(
          `SELECT ${POSE_COLS} FROM poses WHERE type = ? ORDER BY is_hero DESC, sort_order ASC, id ASC`,
        )
        .all(type) as PoseRow[];
    } else {
      rows = db
        .prepare(
          `SELECT ${POSE_COLS} FROM poses ORDER BY is_hero DESC, type ASC, sort_order ASC, id ASC`,
        )
        .all() as PoseRow[];
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
 * POST /api/poses
 * body: { name, text, type, tags?, notes?, sort_order? }
 * 仅管理员
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const body = (await req.json()) as {
      name?: string;
      text?: string;
      type?: string;
      tags?: string;
      notes?: string;
      is_hero?: boolean | number;
      sort_order?: number;
    };

    const name = (body.name || "").trim();
    const text = (body.text || "").trim();
    const type = body.type;

    if (!name) {
      return NextResponse.json({ error: "名称必填" }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: "姿势描述必填" }, { status: 400 });
    }
    if (type !== "full" && type !== "half" && type !== "closeup") {
      return NextResponse.json(
        { error: "type 必须是 full / half / closeup 之一" },
        { status: 400 },
      );
    }

    const isHero = body.is_hero ? 1 : 0;

    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO poses (name, text, type, tags, notes, is_hero, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        text,
        type,
        body.tags?.trim() || null,
        body.notes?.trim() || null,
        isHero,
        body.sort_order ?? 0,
        user.id,
      );

    const row = db
      .prepare(`SELECT ${POSE_COLS} FROM poses WHERE id = ?`)
      .get(result.lastInsertRowid) as PoseRow;

    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
