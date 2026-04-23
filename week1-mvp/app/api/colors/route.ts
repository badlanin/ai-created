import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";

export const runtime = "nodejs";

type ColorRow = {
  id: number;
  name: string;
  hex: string;
  sort_order: number;
  created_at: number;
};

function normalizeHex(input: string): string | null {
  let s = input.trim().toUpperCase();
  if (!s.startsWith("#")) s = "#" + s;
  // 支持 #RGB 和 #RRGGBB
  if (/^#[0-9A-F]{3}$/.test(s)) {
    // 展开为 6 位
    s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }
  if (!/^#[0-9A-F]{6}$/.test(s)) return null;
  return s;
}

/**
 * GET /api/colors
 * 所有已登录用户可读
 */
export async function GET() {
  try {
    await requireUser();
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT id, name, hex, sort_order, created_at FROM colors ORDER BY sort_order ASC, id ASC",
      )
      .all() as ColorRow[];
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
 * POST /api/colors  body: { name, hex, sort_order? }
 * 仅管理员
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const body = (await req.json()) as {
      name?: string;
      hex?: string;
      sort_order?: number;
    };

    const name = (body.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "请填写名称" }, { status: 400 });
    }
    const hex = normalizeHex(body.hex || "");
    if (!hex) {
      return NextResponse.json(
        { error: "HEX 色号不合法，形如 #RRGGBB" },
        { status: 400 },
      );
    }

    const db = getDb();
    const result = db
      .prepare(
        "INSERT INTO colors (name, hex, sort_order, created_by) VALUES (?, ?, ?, ?)",
      )
      .run(name, hex, body.sort_order ?? 0, user.id);

    const row = db
      .prepare(
        "SELECT id, name, hex, sort_order, created_at FROM colors WHERE id = ?",
      )
      .get(result.lastInsertRowid) as ColorRow;

    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
