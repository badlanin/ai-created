import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw Object.assign(new Error("仅管理员"), { status: 403 });
  }
  return user;
}

/** 更新公告 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = (await req.json()) as {
      content?: string;
      tone?: "info" | "success" | "warn" | "danger";
      enabled?: boolean;
      dismissible?: boolean;
      starts_at?: number | null;
      ends_at?: number | null;
    };
    const db = getDb();
    const sets: string[] = [];
    const vals: Array<string | number | null> = [];
    if (typeof body.content === "string") {
      sets.push("content = ?");
      vals.push(body.content.trim());
    }
    if (body.tone) {
      sets.push("tone = ?");
      vals.push(body.tone);
    }
    if (typeof body.enabled === "boolean") {
      sets.push("enabled = ?");
      vals.push(body.enabled ? 1 : 0);
    }
    if (typeof body.dismissible === "boolean") {
      sets.push("dismissible = ?");
      vals.push(body.dismissible ? 1 : 0);
    }
    if ("starts_at" in body) {
      sets.push("starts_at = ?");
      vals.push(body.starts_at ?? null);
    }
    if ("ends_at" in body) {
      sets.push("ends_at = ?");
      vals.push(body.ends_at ?? null);
    }
    if (sets.length === 0) {
      return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });
    }
    sets.push("updated_at = ?");
    vals.push(Math.floor(Date.now() / 1000));
    vals.push(Number(id));
    const r = db
      .prepare(`UPDATE announcements SET ${sets.join(", ")} WHERE id = ?`)
      .run(...vals);
    return NextResponse.json({ updated: r.changes });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/** 删除公告 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const db = getDb();
    const r = db
      .prepare(`DELETE FROM announcements WHERE id = ?`)
      .run(Number(id));
    return NextResponse.json({ deleted: r.changes });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
