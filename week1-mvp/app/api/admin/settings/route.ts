import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/admin/settings
 * 列出所有全局配置（汇率等）
 */
export async function GET() {
  try {
    await requireAdmin();
    const db = getDb();
    const rows = db
      .prepare(`SELECT key, value, notes, updated_at FROM settings ORDER BY key`)
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
 * PATCH /api/admin/settings
 * body: { key, value }
 * upsert 一条配置
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as { key?: string; value?: string };
    const key = (body.key || "").trim();
    const value = (body.value ?? "").toString();
    if (!key) {
      return NextResponse.json({ error: "key 必填" }, { status: 400 });
    }
    const db = getDb();
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
    ).run(key, value);
    const row = db
      .prepare(`SELECT key, value, notes, updated_at FROM settings WHERE key = ?`)
      .get(key);
    return NextResponse.json(row);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
