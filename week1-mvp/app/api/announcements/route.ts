import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

interface AnnouncementRow {
  id: number;
  content: string;
  tone: "info" | "success" | "warn" | "danger";
  enabled: number;
  dismissible: number;
  starts_at: number | null;
  ends_at: number | null;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * GET /api/announcements
 *
 * 返回当前生效的公告（enabled=1、在 starts_at..ends_at 窗口内）。
 * 按 created_at DESC 排序。通常只有 1 条活跃，但支持多条并存。
 */
export async function GET() {
  await requireUser();
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const rows = db
    .prepare(
      `SELECT * FROM announcements
       WHERE enabled = 1
         AND (starts_at IS NULL OR starts_at <= ?)
         AND (ends_at IS NULL OR ends_at >= ?)
       ORDER BY created_at DESC
       LIMIT 5`,
    )
    .all(now, now) as AnnouncementRow[];
  return NextResponse.json({ items: rows });
}
