import { NextRequest, NextResponse } from "next/server";
import {
  ensureInitialAdmin,
  getSession,
  verifyPassword,
} from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureInitialAdmin();

    const body = (await req.json()) as {
      username?: string;
      password?: string;
    };
    const username = (body.username || "").trim();
    const password = body.password || "";

    if (!username || !password) {
      return NextResponse.json(
        { error: "请输入用户名和密码" },
        { status: 400 },
      );
    }

    const db = getDb();
    const row = db
      .prepare(
        "SELECT id, username, password_hash, role FROM users WHERE username = ?",
      )
      .get(username) as
      | { id: number; username: string; password_hash: string; role: "admin" | "user" }
      | undefined;

    if (!row) {
      // 统一的错误文案，避免泄露用户名是否存在
      return NextResponse.json(
        { error: "用户名或密码错误" },
        { status: 401 },
      );
    }

    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) {
      return NextResponse.json(
        { error: "用户名或密码错误" },
        { status: 401 },
      );
    }

    const session = await getSession();
    session.userId = row.id;
    session.username = row.username;
    session.role = row.role;
    session.loggedInAt = Date.now();
    await session.save();

    return NextResponse.json({
      id: row.id,
      username: row.username,
      role: row.role,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/auth/login] 失败:", msg);
    return NextResponse.json({ error: `登录失败: ${msg}` }, { status: 500 });
  }
}
