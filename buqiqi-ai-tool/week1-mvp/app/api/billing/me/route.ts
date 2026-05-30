import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getUserBudgetStatus, getUsdToCny } from "@/lib/pricing";

export const runtime = "nodejs";

/**
 * GET /api/billing/me
 *
 * 返回当前用户的本月账单摘要 + 最近 50 条使用记录
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const db = getDb();
    const url = new URL(req.url);
    const limit = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get("limit") || "50")),
    );

    const budget = getUserBudgetStatus(user.id);

    // 本月按模型聚合
    const now = new Date();
    const firstOfMonth = Math.floor(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, -8) / 1000,
    );
    const byModel = db
      .prepare(
        `SELECT model, feature,
                COUNT(*) AS count,
                SUM(prompt_tokens) AS prompt_tokens,
                SUM(completion_tokens) AS completion_tokens,
                SUM(cost_usd) AS cost_usd,
                SUM(cost_cny) AS cost_cny
         FROM usage_records
         WHERE user_id = ? AND created_at >= ?
         GROUP BY model, feature
         ORDER BY cost_cny DESC`,
      )
      .all(user.id, firstOfMonth);

    const recent = db
      .prepare(
        `SELECT id, model, feature, prompt_tokens, completion_tokens, total_tokens,
                cost_usd, cost_cny, success, error, notes, created_at
         FROM usage_records
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(user.id, limit);

    return NextResponse.json({
      user: { id: user.id, username: user.username },
      usd_to_cny: getUsdToCny(),
      budget,
      this_month_by_model: byModel,
      recent,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
