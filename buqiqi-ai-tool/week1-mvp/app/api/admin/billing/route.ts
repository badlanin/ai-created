import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getUsdToCny } from "@/lib/pricing";

export const runtime = "nodejs";

/**
 * GET /api/admin/billing?month=YYYY-MM
 *
 * 仅管理员。返回全团队某月的账单汇总：每人消费 + 每模型消费 + 总额
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const db = getDb();
    const url = new URL(req.url);
    const monthParam = url.searchParams.get("month");

    // 默认当月
    let year: number, month: number;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      [year, month] = monthParam.split("-").map(Number);
      month -= 1; // JS month 0-based
    } else {
      const now = new Date();
      year = now.getUTCFullYear();
      month = now.getUTCMonth();
    }

    // 北京时间的月初和月末（CST = UTC+8，所以 UTC 上减 8 小时）
    const monthStart = Math.floor(Date.UTC(year, month, 1, -8) / 1000);
    const monthEnd = Math.floor(Date.UTC(year, month + 1, 1, -8) / 1000);

    // 团队总计
    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS total_calls,
                SUM(cost_usd) AS total_usd,
                SUM(cost_cny) AS total_cny,
                SUM(prompt_tokens) AS total_prompt_tokens,
                SUM(completion_tokens) AS total_completion_tokens
         FROM usage_records
         WHERE created_at >= ? AND created_at < ?`,
      )
      .get(monthStart, monthEnd) as {
      total_calls: number;
      total_usd: number | null;
      total_cny: number | null;
      total_prompt_tokens: number | null;
      total_completion_tokens: number | null;
    };

    // 按用户聚合
    const byUser = db
      .prepare(
        `SELECT u.id AS user_id, u.username, u.display_name,
                u.role,
                COALESCE(b.monthly_budget_cny, 0) AS monthly_budget_cny,
                COALESCE(b.is_unlimited, 1) AS is_unlimited,
                COUNT(r.id) AS call_count,
                COALESCE(SUM(r.cost_cny), 0) AS cost_cny,
                COALESCE(SUM(r.cost_usd), 0) AS cost_usd,
                COALESCE(SUM(r.prompt_tokens), 0) AS prompt_tokens,
                COALESCE(SUM(r.completion_tokens), 0) AS completion_tokens
         FROM users u
         LEFT JOIN user_budgets b ON b.user_id = u.id
         LEFT JOIN usage_records r ON r.user_id = u.id
              AND r.created_at >= ? AND r.created_at < ?
         GROUP BY u.id
         ORDER BY cost_cny DESC, u.id ASC`,
      )
      .all(monthStart, monthEnd);

    // 按模型 x feature 聚合
    const byModel = db
      .prepare(
        `SELECT model, feature,
                COUNT(*) AS count,
                SUM(prompt_tokens) AS prompt_tokens,
                SUM(completion_tokens) AS completion_tokens,
                SUM(cost_cny) AS cost_cny,
                SUM(cost_usd) AS cost_usd
         FROM usage_records
         WHERE created_at >= ? AND created_at < ?
         GROUP BY model, feature
         ORDER BY cost_cny DESC`,
      )
      .all(monthStart, monthEnd);

    // 按天聚合（画趋势）
    const byDay = db
      .prepare(
        `SELECT date(created_at, 'unixepoch', '+8 hours') AS day,
                COUNT(*) AS count,
                SUM(cost_cny) AS cost_cny
         FROM usage_records
         WHERE created_at >= ? AND created_at < ?
         GROUP BY day
         ORDER BY day ASC`,
      )
      .all(monthStart, monthEnd);

    return NextResponse.json({
      month: `${year}-${String(month + 1).padStart(2, "0")}`,
      usd_to_cny: getUsdToCny(),
      total: {
        calls: totalRow.total_calls,
        prompt_tokens: totalRow.total_prompt_tokens ?? 0,
        completion_tokens: totalRow.total_completion_tokens ?? 0,
        cost_usd: totalRow.total_usd ?? 0,
        cost_cny: totalRow.total_cny ?? 0,
      },
      by_user: byUser,
      by_model: byModel,
      by_day: byDay,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
