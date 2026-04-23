import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

type GenRow = {
  id: number;
  user_id: number;
  username?: string;
  kind: string;
  input_images: string | null;
  output_images: string | null;
  params: string | null;
  duration_ms: number | null;
  success: number;
  error: string | null;
  created_at: number;
};

/**
 * GET /api/generations?page=1&limit=20&kind=recolor|on_model|analyze&scope=me|all
 *
 * - 普通用户：只能看自己的（即使传 scope=all 也强制 me）
 * - 管理员：scope=all 时看所有人（带 username 字段）
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const db = getDb();
    const url = new URL(req.url);

    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit") || "20")),
    );
    const kind = url.searchParams.get("kind");
    const scope = url.searchParams.get("scope") || "me";
    const showAll = scope === "all" && user.role === "admin";

    const conditions: string[] = [];
    const values: unknown[] = [];
    if (!showAll) {
      conditions.push("g.user_id = ?");
      values.push(user.id);
    }
    if (kind && ["recolor", "on_model"].includes(kind)) {
      conditions.push("g.kind = ?");
      values.push(kind);
    }
    const whereClause = conditions.length
      ? "WHERE " + conditions.join(" AND ")
      : "";

    const countRow = db
      .prepare(`SELECT COUNT(*) AS c FROM generations g ${whereClause}`)
      .get(...values) as { c: number };

    const rows = db
      .prepare(
        `SELECT g.id, g.user_id, g.kind, g.input_images, g.output_images,
                g.params, g.duration_ms, g.success, g.error, g.created_at,
                u.username
         FROM generations g
         LEFT JOIN users u ON u.id = g.user_id
         ${whereClause}
         ORDER BY g.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, (page - 1) * limit) as GenRow[];

    return NextResponse.json({
      total: countRow.c,
      page,
      limit,
      showing_all: showAll,
      items: rows,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
