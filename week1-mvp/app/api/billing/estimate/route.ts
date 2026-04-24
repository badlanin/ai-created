import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  estimateBatchCost,
  getUserBudgetStatus,
  getUsdToCny,
} from "@/lib/pricing";

export const runtime = "nodejs";

/**
 * POST /api/billing/estimate
 * body: { model, quality_level: 'hd'|'2k'|'4k', image_count: number }
 *
 * 返回：估价 + 当前余额 + 是否能负担
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      model?: string;
      quality_level?: string;
      image_count?: number;
    };

    const model = (body.model || "").trim();
    const quality: "hd" | "2k" | "4k" =
      body.quality_level === "hd" ||
      body.quality_level === "2k" ||
      body.quality_level === "4k"
        ? body.quality_level
        : "2k";
    const imageCount = Math.max(0, Math.floor(Number(body.image_count) || 0));

    const estimate = estimateBatchCost(model, quality, imageCount);
    const budget = getUserBudgetStatus(user.id);

    // 管理员无限制 / 或 is_unlimited=true
    const skipLimit = user.role === "admin" || budget.is_unlimited;

    const affordable = skipLimit
      ? true
      : estimate.total_cost_cny <= budget.remaining_cny;

    // 如果余额不足，能出多少张
    const canAffordCount =
      skipLimit || estimate.per_image_cny === 0
        ? imageCount
        : Math.floor(budget.remaining_cny / estimate.per_image_cny);

    return NextResponse.json({
      user_role: user.role,
      usd_to_cny: getUsdToCny(),
      budget,
      estimate,
      affordable,
      can_afford_count: Math.max(0, canAffordCount),
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
