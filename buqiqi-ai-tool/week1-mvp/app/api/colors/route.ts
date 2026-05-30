import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";

export const runtime = "nodejs";

type ColorRow = {
  id: number;
  name: string;
  hex: string;
  color_group: string | null;
  is_popular: number;
  sort_order: number;
  created_at: number;
};

// 9 个核心色系的中文显示名（与 migrateReplaceColorsV2 的 50 色色卡对齐）
// 兼容历史值："Yellow"（单数 legacy）/ "Pinks & Reds"（v1 合并组）
const COLOR_GROUP_LABELS: Record<string, string> = {
  Yellows: "黄色系",
  Yellow: "黄色系", // legacy
  Purples: "紫色系",
  Pinks: "粉色系",
  Oranges: "橙色系",
  Neutrals: "中性色系",
  Greens: "绿色系",
  Darks: "深色系",
  Blues: "蓝色系",
  Reds: "红色系",
  "Pinks & Reds": "粉/红色系", // legacy v1 合并组
};

function withGroupLabel<T extends { color_group: string | null }>(row: T) {
  return {
    ...row,
    color_group_label:
      row.color_group && COLOR_GROUP_LABELS[row.color_group]
        ? COLOR_GROUP_LABELS[row.color_group]
        : row.color_group || null,
  };
}

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
        `SELECT id, name, hex, color_group, is_popular, sort_order, created_at
         FROM colors ORDER BY sort_order ASC, id ASC`,
      )
      .all() as ColorRow[];
    return NextResponse.json(rows.map(withGroupLabel));
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
      color_group?: string;
      is_popular?: boolean;
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
    const colorGroup = (body.color_group || "").trim() || null;
    const isPopular = body.is_popular ? 1 : 0;

    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO colors (name, hex, color_group, is_popular, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(name, hex, colorGroup, isPopular, body.sort_order ?? 0, user.id);

    const row = db
      .prepare(
        `SELECT id, name, hex, color_group, is_popular, sort_order, created_at
         FROM colors WHERE id = ?`,
      )
      .get(result.lastInsertRowid) as ColorRow;

    return NextResponse.json(withGroupLabel(row), { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
