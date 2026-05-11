/**
 * 计费相关：价格查询 + 成本计算 + 汇率
 *
 * 计费有两条路径：
 *   1. Gemini  → token × per-1M-rate（走 model_prices 表）
 *   2. OpenAI gpt-image-* → size × quality 固定价（走 openai-image.estimateOpenAIImageCostUSD）
 *
 * estimateImageCost 会按 modelId 前缀分发到正确的路径。
 */
import { getDb } from "./db";
import { estimateOpenAIImageCostUSD } from "./openai-image";

export interface ModelPriceRow {
  model_id: string;
  input_per_1m_usd: number;
  output_per_1m_usd: number;
  tier: string;
  notes: string | null;
  updated_at: number;
}

export interface CostBreakdown {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  input_cost_usd: number;
  output_cost_usd: number;
  cost_usd: number;
  cost_cny: number;
  usd_to_cny: number;
  model: string;
  price_found: boolean;
}

/**
 * 读取某模型当前单价
 */
export function getModelPrice(modelId: string): ModelPriceRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT model_id, input_per_1m_usd, output_per_1m_usd, tier, notes, updated_at
       FROM model_prices WHERE model_id = ?`,
    )
    .get(modelId) as ModelPriceRow | undefined;
  return row ?? null;
}

/**
 * 列出所有模型单价（管理页用）
 */
export function getAllModelPrices(): ModelPriceRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT model_id, input_per_1m_usd, output_per_1m_usd, tier, notes, updated_at
       FROM model_prices ORDER BY model_id ASC`,
    )
    .all() as ModelPriceRow[];
}

/**
 * 读取全局配置值
 */
export function getSetting(key: string, fallback: string): string {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function getUsdToCny(): number {
  const v = parseFloat(getSetting("usd_to_cny", "7.2"));
  return Number.isFinite(v) && v > 0 ? v : 7.2;
}

/**
 * 核心：按 tokens + 模型单价算钱
 *
 * 如果模型单价表里没有这个 model_id，会返回 price_found=false 且成本为 0（不会报错，
 * 记账会照旧写入但金额是 0，方便管理员事后对账补价）。
 */
export function calcCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): CostBreakdown {
  const price = getModelPrice(modelId);
  const usdToCny = getUsdToCny();
  const totalTokens = promptTokens + completionTokens;

  if (!price) {
    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      input_cost_usd: 0,
      output_cost_usd: 0,
      cost_usd: 0,
      cost_cny: 0,
      usd_to_cny: usdToCny,
      model: modelId,
      price_found: false,
    };
  }

  const inputCostUsd = (promptTokens * price.input_per_1m_usd) / 1_000_000;
  const outputCostUsd =
    (completionTokens * price.output_per_1m_usd) / 1_000_000;
  const costUsd = inputCostUsd + outputCostUsd;
  const costCny = costUsd * usdToCny;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    input_cost_usd: inputCostUsd,
    output_cost_usd: outputCostUsd,
    cost_usd: costUsd,
    cost_cny: costCny,
    usd_to_cny: usdToCny,
    model: modelId,
    price_found: true,
  };
}

/**
 * 查某用户本月已消费（CNY）
 * 月份按 UTC+8 北京时间的自然月计算
 */
export function getUserMonthlyCostCny(userId: number): number {
  const now = new Date();
  // 北京时间的当月 1 日 0 点
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const firstOfMonth = Math.floor(
    Date.UTC(year, month, 1, -8) / 1000, // 减 8 小时是因为 CST = UTC+8
  );
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_cny), 0) AS sum FROM usage_records
       WHERE user_id = ? AND created_at >= ?`,
    )
    .get(userId, firstOfMonth) as { sum: number };
  return row.sum;
}

/**
 * 查某用户本月预算（返回 monthly_budget_cny, is_unlimited, used, remaining）
 */
export interface BudgetStatus {
  monthly_budget_cny: number;
  is_unlimited: boolean;
  used_this_month_cny: number;
  remaining_cny: number;
  percent_used: number; // 0-100
}

export function getUserBudgetStatus(userId: number): BudgetStatus {
  const db = getDb();
  const budget = db
    .prepare(
      `SELECT monthly_budget_cny, is_unlimited FROM user_budgets WHERE user_id = ?`,
    )
    .get(userId) as
    | { monthly_budget_cny: number; is_unlimited: number }
    | undefined;

  const used = getUserMonthlyCostCny(userId);
  const isUnlimited = !budget || budget.is_unlimited === 1;
  const monthly = budget?.monthly_budget_cny ?? 0;
  const remaining = isUnlimited ? Infinity : Math.max(0, monthly - used);
  const percent = isUnlimited
    ? 0
    : monthly > 0
      ? Math.min(100, (used / monthly) * 100)
      : 0;

  return {
    monthly_budget_cny: monthly,
    is_unlimited: isUnlimited,
    used_this_month_cny: used,
    remaining_cny: remaining,
    percent_used: percent,
  };
}

/**
 * 预算检查：如果超限则抛出带 HTTP 状态码的 Error（前端会收到 429）
 *
 * 调用时机：在 AI 生成 API 的入口，鉴权之后、真正调模型之前。
 * 管理员用户跳过检查（避免自己把自己锁了）。
 */
export function assertWithinBudget(
  userId: number,
  role: string,
): BudgetStatus {
  const status = getUserBudgetStatus(userId);
  if (role === "admin") return status; // 管理员不限
  if (status.is_unlimited) return status;
  if (status.used_this_month_cny >= status.monthly_budget_cny) {
    const e: Error & { status?: number } = new Error(
      `本月预算已用完（¥${status.used_this_month_cny.toFixed(2)} / ¥${status.monthly_budget_cny.toFixed(2)}），请联系管理员提升额度`,
    );
    e.status = 429;
    throw e;
  }
  return status;
}

/**
 * 预估单张图片生成成本（用于前端点击前预警）
 *
 * 基于用户实测数据的 token 估算：
 *   - Pro Image:   1K/2K 约 1120 output tokens，4K 约 2000 tokens
 *   - Flash Image: 1K ~1120, 2K ~1680, 4K ~2520 tokens
 *   - 每张图输入约 2000 tokens（prompt + 参考图）
 */
export function estimateImageCost(
  modelId: string,
  qualityLevel: "hd" | "2k" | "4k",
): { cost_usd: number; cost_cny: number; price_found: boolean } {
  const usdToCny = getUsdToCny();

  // ─── OpenAI gpt-image-* 走固定单价表（按 size×quality） ───
  if (modelId.startsWith("gpt-image")) {
    // 按 qualityLevel 映射默认竖向 size 和 quality 档位
    // 跟 lib/image-gen.ts 的 mapAspectAndSizeToOpenAI(portrait) 对齐。
    // legacy 模型（gpt-image-1 / 1.5 / 1-mini）只能 1024x1536，2K/4K 在那边被 clamp 回 1024x1536，
    // 这里 cost 估算也要同步降级，否则会高估
    const isLegacy =
      modelId.startsWith("gpt-image") && !modelId.startsWith("gpt-image-2");
    const sizeMap = isLegacy
      ? {
          hd: "1024x1536" as const,
          "2k": "1024x1536" as const, // legacy 2K 被 clamp 回 1024x1536
          "4k": "1024x1536" as const, // legacy 4K 被 clamp 回 1024x1536
        }
      : {
          hd: "1024x1536" as const,
          "2k": "1440x2560" as const,
          "4k": "2144x3824" as const,
        };
    const qualityMap = {
      hd: "medium" as const,
      "2k": "high" as const,
      "4k": "high" as const,
    };
    const cost_usd = estimateOpenAIImageCostUSD(
      sizeMap[qualityLevel],
      qualityMap[qualityLevel],
    );
    return {
      cost_usd,
      cost_cny: cost_usd * usdToCny,
      price_found: cost_usd > 0,
    };
  }

  // ─── Gemini token 计费路径 ───
  const price = getModelPrice(modelId);
  if (!price) {
    return { cost_usd: 0, cost_cny: 0, price_found: false };
  }

  const isProImage = modelId.includes("pro-image");
  const isFlashImage = modelId.includes("flash-image") || modelId.includes("image");

  // 输出 tokens 估算
  let outputTokens = 1200;
  if (isProImage) {
    outputTokens =
      qualityLevel === "4k" ? 2000 : qualityLevel === "2k" ? 1120 : 1120;
  } else if (isFlashImage) {
    outputTokens =
      qualityLevel === "4k"
        ? 2520
        : qualityLevel === "2k"
          ? 1680
          : 1120;
  }

  // 输入 tokens 约 2000（prompt + 参考图 ~560~1120/图）
  const inputTokens = 2000;

  const inputCostUsd = (inputTokens * price.input_per_1m_usd) / 1_000_000;
  const outputCostUsd = (outputTokens * price.output_per_1m_usd) / 1_000_000;
  const cost_usd = inputCostUsd + outputCostUsd;
  return {
    cost_usd,
    cost_cny: cost_usd * usdToCny,
    price_found: true,
  };
}

/**
 * 预估一批任务总成本
 */
export function estimateBatchCost(
  modelId: string,
  qualityLevel: "hd" | "2k" | "4k",
  imageCount: number,
): {
  image_count: number;
  per_image_cny: number;
  total_cost_usd: number;
  total_cost_cny: number;
  price_found: boolean;
} {
  const single = estimateImageCost(modelId, qualityLevel);
  return {
    image_count: imageCount,
    per_image_cny: single.cost_cny,
    total_cost_usd: single.cost_usd * imageCount,
    total_cost_cny: single.cost_cny * imageCount,
    price_found: single.price_found,
  };
}
