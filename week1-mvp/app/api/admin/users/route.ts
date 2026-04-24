import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin, hashPassword } from "@/lib/auth";
import { getUserBudgetStatus } from "@/lib/pricing";

export const runtime = "nodejs";

/**
 * GET /api/admin/users
 * 列出所有用户，含本月消费和预算
 */
export async function GET() {
  try {
    await requireAdmin();
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.role, u.created_at,
                b.monthly_budget_cny, b.is_unlimited, b.notes AS budget_notes
         FROM users u
         LEFT JOIN user_budgets b ON b.user_id = u.id
         ORDER BY u.created_at ASC`,
      )
      .all() as Array<{
      id: number;
      username: string;
      display_name: string | null;
      role: string;
      created_at: number;
      monthly_budget_cny: number | null;
      is_unlimited: number | null;
      budget_notes: string | null;
    }>;

    const enriched = rows.map((u) => {
      const status = getUserBudgetStatus(u.id);
      return {
        ...u,
        monthly_budget_cny: u.monthly_budget_cny ?? 0,
        is_unlimited: u.is_unlimited ?? 1,
        used_this_month_cny: status.used_this_month_cny,
      };
    });

    return NextResponse.json(enriched);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * POST /api/admin/users
 * body: { username, password, display_name?, role?, monthly_budget_cny?, is_unlimited? }
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as {
      username?: string;
      password?: string;
      display_name?: string;
      role?: string;
      monthly_budget_cny?: number;
      is_unlimited?: boolean;
    };

    const username = (body.username || "").trim();
    const password = body.password || "";
    if (!username) {
      return NextResponse.json({ error: "用户名必填" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: "密码至少 6 位" },
        { status: 400 },
      );
    }
    const role =
      body.role === "admin" || body.role === "user" ? body.role : "user";

    const db = getDb();
    const exists = db
      .prepare(`SELECT id FROM users WHERE username = ?`)
      .get(username);
    if (exists) {
      return NextResponse.json(
        { error: "用户名已存在" },
        { status: 409 },
      );
    }

    const hashed = await hashPassword(password);
    const tx = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          username,
          hashed,
          body.display_name?.trim() || null,
          role,
        );
      const userId = result.lastInsertRowid as number;

      if (
        typeof body.monthly_budget_cny === "number" ||
        typeof body.is_unlimited === "boolean"
      ) {
        db.prepare(
          `INSERT INTO user_budgets (user_id, monthly_budget_cny, is_unlimited)
           VALUES (?, ?, ?)`,
        ).run(
          userId,
          body.monthly_budget_cny ?? 0,
          body.is_unlimited !== false ? 1 : 0,
        );
      }
      return userId;
    });
    const userId = tx();

    const row = db
      .prepare(
        `SELECT id, username, display_name, role, created_at FROM users WHERE id = ?`,
      )
      .get(userId);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
