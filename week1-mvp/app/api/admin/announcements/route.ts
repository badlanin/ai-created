import { NextRequest, NextResponse } from "next/server";
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

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw Object.assign(new Error("仅管理员"), { status: 403 });
  }
  return user;
}

/** 管理员列表（含未启用的） */
export async function GET() {
  await requireAdmin();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM announcements ORDER BY created_at DESC LIMIT 200`,
    )
    .all() as AnnouncementRow[];
  return NextResponse.json({ items: rows });
}

/** 新建公告 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const body = (await req.json()) as {
      content?: string;
      tone?: "info" | "success" | "warn" | "danger";
      enabled?: boolean;
      dismissible?: boolean;
      starts_at?: number | null;
      ends_at?: number | null;
    };
    if (!body.content || !body.content.trim()) {
      return NextResponse.json({ error: "content 必填" }, { status: 400 });
    }
    const tone = (["info", "success", "warn", "danger"] as const).includes(
      body.tone as "info" | "success" | "warn" | "danger",
    )
      ? body.tone!
      : "info";
    const db = getDb();
    const r = db
      .prepare(
        `INSERT INTO announcements
           (content, tone, enabled, dismissible, starts_at, ends_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        body.content.trim(),
        tone,
        body.enabled === false ? 0 : 1,
        body.dismissible === false ? 0 : 1,
        body.starts_at ?? null,
        body.ends_at ?? null,
        user.id,
      );
    return NextResponse.json({ id: r.lastInsertRowid });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
