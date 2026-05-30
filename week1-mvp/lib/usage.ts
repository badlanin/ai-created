/**
 * 使用记录工具 - 每次 AI 调用都会写一条
 */
import { getDb } from "./db";
import { calcCost } from "./pricing";

export interface UsageMetadataLike {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  // Gemini SDK 字段名可能在不同版本略有差异，都兼容
  prompt_token_count?: number;
  candidates_token_count?: number;
  total_token_count?: number;
}

/**
 * 从 Gemini response.usageMetadata 中提取 token 数
 *
 * 不同 SDK 版本字段命名有差异，这里都兼容
 */
export function extractTokens(
  usageMetadata: UsageMetadataLike | null | undefined,
): {
  prompt: number;
  completion: number;
  total: number;
} {
  if (!usageMetadata) return { prompt: 0, completion: 0, total: 0 };
  const prompt =
    usageMetadata.promptTokenCount ?? usageMetadata.prompt_token_count ?? 0;
  const completion =
    usageMetadata.candidatesTokenCount ??
    usageMetadata.candidates_token_count ??
    0;
  const total =
    usageMetadata.totalTokenCount ??
    usageMetadata.total_token_count ??
    prompt + completion;
  return { prompt, completion, total };
}

export interface RecordUsageInput {
  userId: number;
  generationId?: number | null;
  model: string;
  feature: "analyze" | "recolor" | "batch_photo" | "remove_bg" | "other";
  usageMetadata?: UsageMetadataLike | null;
  success?: boolean;
  error?: string | null;
  notes?: Record<string, unknown> | null;
  /**
   * 固定单价覆盖（USD）。OpenAI gpt-image-2 是按 size×quality 固定价计费，
   * 不是 token × per-1M-rate，所以 OpenAI 路径要直接传这个值绕过 calcCost
   * 的 token 计算。Gemini 路径留空，走原 token 计费。
   */
  costOverrideUsd?: number;
}

/**
 * 记录一次使用 - 不阻塞主流程（try/catch 吞异常）
 */
export function recordUsage(input: RecordUsageInput): void {
  try {
    const tokens = extractTokens(input.usageMetadata);
    const tokenCost = calcCost(input.model, tokens.prompt, tokens.completion);

    // OpenAI 固定单价覆盖：cost_usd 来自调用方，cost_cny 用当前汇率换算
    let costUsd = tokenCost.cost_usd;
    let costCny = tokenCost.cost_cny;
    if (typeof input.costOverrideUsd === "number" && input.costOverrideUsd >= 0) {
      costUsd = input.costOverrideUsd;
      costCny = input.costOverrideUsd * tokenCost.usd_to_cny;
    }

    const db = getDb();
    db.prepare(
      `INSERT INTO usage_records
         (user_id, generation_id, model, feature,
          prompt_tokens, completion_tokens, total_tokens,
          cost_usd, cost_cny, success, error, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.userId,
      input.generationId ?? null,
      input.model,
      input.feature,
      tokenCost.prompt_tokens,
      tokenCost.completion_tokens,
      tokenCost.total_tokens,
      costUsd,
      costCny,
      input.success === false ? 0 : 1,
      input.error ?? null,
      input.notes ? JSON.stringify(input.notes) : null,
    );
  } catch (e) {
    // 记账失败不应影响主流程
    console.error(
      "[usage.recordUsage] 写入失败（不影响主流程）:",
      e instanceof Error ? e.message : String(e),
    );
  }
}
