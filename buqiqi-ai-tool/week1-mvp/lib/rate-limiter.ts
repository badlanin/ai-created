/**
 * 令牌桶限流器（per model 独立桶）
 *
 * ─────────────────────────────────────────────
 * 为什么需要：
 *   Google Gemini preview 图片模型的 image_gen quota 默认是
 *   **2/min per base_model per project**。我们全项目所有用户所有功能
 *   共享这 2 个槽，超了会报 429。
 *
 *   我们在客户端主动限流到 2/min 是为了：
 *     1. 让 429 不再成为常态（重试成本高、体验差）
 *     2. UX 能精确倒计时"下个 token 多少秒后"
 *
 * 算法：
 *   - 经典 token bucket
 *   - capacity = burst（桶容量），默认 2
 *   - refill rate = ratePerMin/60 token/秒，默认 2/60 ≈ 0.033/s
 *   - acquire() 阻塞直到有 token 可取
 *
 * 每个 base_model 一个独立桶。
 * 桶存在模块级内存里 —— 进程重启会清空（但 quota 本身也是按分钟滚动的，
 * 进程重启后桶从 0 开始反而比 2 保守，更安全）。
 *
 * 提额后：管理员在 settings 改 image_rate_limit_per_min，调用
 *   setRateForModel(model, newRate) 即可热更新（无需重启）。
 * ─────────────────────────────────────────────
 */

import { getDb } from "./db";

export interface BucketState {
  model: string;
  capacity: number;
  refillPerSecond: number;
  /** 当前桶内 token 数（浮点，连续累积） */
  tokens: number;
  /** 下个整数 token 可用的时间戳（毫秒） */
  nextTokenReadyAtMs: number;
  /** 累计获取次数（debug） */
  acquiredCount: number;
  /** 正在等待的协程数 */
  waitingCount: number;
}

class TokenBucket {
  capacity: number;
  refillPerSecond: number;
  tokens: number;
  lastRefillAtMs: number;
  acquiredCount = 0;
  waitingCount = 0;

  constructor(capacity: number, refillPerSecond: number) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = capacity; // 启动时满桶
    this.lastRefillAtMs = Date.now();
  }

  /** 根据经过时间重新计算当前 token 数 */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillAtMs) / 1000;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillPerSecond,
    );
    this.lastRefillAtMs = now;
  }

  /** 返回下个整数 token 什么时候可用（毫秒时间戳） */
  getNextTokenReadyAtMs(): number {
    this.refill();
    if (this.tokens >= 1) return Date.now();
    const tokensNeeded = 1 - this.tokens;
    const waitSeconds = tokensNeeded / this.refillPerSecond;
    return Date.now() + waitSeconds * 1000;
  }

  /**
   * 等待并取走 1 个 token
   *
   * @returns 等待时长（毫秒），0 表示没等
   */
  async acquire(): Promise<number> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.acquiredCount += 1;
      return 0;
    }

    // 不够：等 refill
    this.waitingCount += 1;
    const tokensNeeded = 1 - this.tokens;
    const waitSeconds = tokensNeeded / this.refillPerSecond;
    // 加 30ms buffer 防止浮点误差让刚刚计算出的时间点还差一点点
    const waitMs = Math.ceil(waitSeconds * 1000) + 30;
    const startedAt = Date.now();
    await new Promise((r) => setTimeout(r, waitMs));
    this.waitingCount -= 1;

    // 等完了再刷一次，取 token
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.acquiredCount += 1;
      return Date.now() - startedAt;
    }
    // 极端情况（多个 waiter 被唤醒抢 token），再试一次递归
    const extra = await this.acquire();
    return Date.now() - startedAt + extra;
  }

  snapshot(): Omit<BucketState, "model"> {
    this.refill();
    return {
      capacity: this.capacity,
      refillPerSecond: this.refillPerSecond,
      tokens: this.tokens,
      nextTokenReadyAtMs: this.getNextTokenReadyAtMs(),
      acquiredCount: this.acquiredCount,
      waitingCount: this.waitingCount,
    };
  }

  /**
   * 热更新容量 + 补充速率（不重置已持有的 token）
   */
  reconfigure(capacity: number, refillPerSecond: number) {
    this.refill();
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = Math.min(this.tokens, capacity);
  }
}

/* ─────────── 模块级单例 ─────────── */

const buckets = new Map<string, TokenBucket>();
// 按 provider 类型缓存费率（gemini / openai 两类不同的 settings 字段）
const cachedRate = new Map<
  "gemini" | "openai",
  { capacity: number; refillPerSecond: number }
>();

/**
 * 按 modelId 前缀决定 provider 类别。OpenAI 走自己的 settings 字段（openai_ipm_limit），
 * 其他全部归 Gemini（image_rate_limit_per_min）。
 */
function getProviderClass(model: string): "gemini" | "openai" {
  return model.startsWith("gpt-image") ? "openai" : "gemini";
}

/**
 * 从 settings 表读对应 provider 的费率配置
 */
function readRateFromSettings(
  provider: "gemini" | "openai",
): {
  capacity: number;
  refillPerSecond: number;
} {
  try {
    const db = getDb();
    if (provider === "openai") {
      // OpenAI Tier 1 默认 5 IPM。capacity = ratePerMin（burst 不单独配，让 5 张/分钟也能瞬时发出）
      const row = db
        .prepare(`SELECT value FROM settings WHERE key = 'openai_ipm_limit'`)
        .get() as { value: string } | undefined;
      const ipm = Number(row?.value ?? "5");
      const ratePerMin = Number.isFinite(ipm) && ipm > 0 ? ipm : 5;
      return {
        capacity: ratePerMin,
        refillPerSecond: ratePerMin / 60,
      };
    }
    // Gemini
    const rows = db
      .prepare(
        `SELECT key, value FROM settings WHERE key IN ('image_rate_limit_per_min', 'image_rate_burst')`,
      )
      .all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const perMin = Number(map.get("image_rate_limit_per_min") ?? "2");
    const burst = Number(map.get("image_rate_burst") ?? "2");
    const ratePerMin = Number.isFinite(perMin) && perMin > 0 ? perMin : 2;
    const capacity = Number.isFinite(burst) && burst > 0 ? burst : ratePerMin;
    return {
      capacity,
      refillPerSecond: ratePerMin / 60,
    };
  } catch {
    // DB 还没起或出错时用安全默认值
    return provider === "openai"
      ? { capacity: 5, refillPerSecond: 5 / 60 }
      : { capacity: 2, refillPerSecond: 2 / 60 };
  }
}

/**
 * 获取某模型的 bucket。首次访问时懒加载，按 provider 选对应费率。
 */
export function getBucket(model: string): TokenBucket {
  let b = buckets.get(model);
  if (!b) {
    const provider = getProviderClass(model);
    let rate = cachedRate.get(provider);
    if (!rate) {
      rate = readRateFromSettings(provider);
      cachedRate.set(provider, rate);
    }
    b = new TokenBucket(rate.capacity, rate.refillPerSecond);
    buckets.set(model, b);
  }
  return b;
}

/**
 * 从 DB 热加载费率并应用到所有已创建的 bucket。
 * admin 改完 image_rate_limit_per_min 或 openai_ipm_limit 后调一次。
 */
export function refreshRateFromSettings(): {
  gemini: { capacity: number; refillPerSecond: number };
  openai: { capacity: number; refillPerSecond: number };
} {
  const gem = readRateFromSettings("gemini");
  const oai = readRateFromSettings("openai");
  cachedRate.set("gemini", gem);
  cachedRate.set("openai", oai);
  for (const [model, b] of buckets.entries()) {
    const r = getProviderClass(model) === "openai" ? oai : gem;
    b.reconfigure(r.capacity, r.refillPerSecond);
  }
  return { gemini: gem, openai: oai };
}

/**
 * 手动 override 某模型的费率（测试用）
 */
export function setRateForModel(
  model: string,
  capacity: number,
  refillPerSecond: number,
): void {
  const b = getBucket(model);
  b.reconfigure(capacity, refillPerSecond);
}

/**
 * 看所有 bucket 的状态（admin 诊断 / 前端调试面板用）
 */
export function getAllBucketStates(): BucketState[] {
  const out: BucketState[] = [];
  for (const [model, b] of buckets.entries()) {
    out.push({ model, ...b.snapshot() });
  }
  return out;
}

/**
 * 对单个 model 执行 acquire。主要对外 API。
 *
 * 用法：
 *   const waitedMs = await acquireToken("gemini-3.1-flash-image-preview");
 *   console.log(`等了 ${waitedMs}ms，开始调用 Gemini`);
 */
export async function acquireToken(model: string): Promise<number> {
  const b = getBucket(model);
  return b.acquire();
}

/**
 * 查询某 model 下一个 token 何时可用（不消耗）
 */
export function peekNextTokenAtMs(model: string): number {
  return getBucket(model).getNextTokenReadyAtMs();
}

/* ─────────── 并发数 ─────────── */

let cachedConcurrency: number | null = null;

/**
 * 从 settings 读图像生成 job 内并发数
 *
 * - Vertex 默认 1（串行最稳）
 * - Gemini API 推荐 4-5（用满 RPM）
 *
 * 真实并发被 token bucket 节流，所以即使设很大也不会超 RPM——
 * 只是允许多个 item 同时进入"等待 token"或"AI 算图"状态。
 */
export function getImageConcurrency(): number {
  if (cachedConcurrency !== null) return cachedConcurrency;
  try {
    const db = getDb();
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = 'image_concurrency'`)
      .get() as { value: string } | undefined;
    const n = Number(row?.value ?? "1");
    cachedConcurrency = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  } catch {
    cachedConcurrency = 1;
  }
  return cachedConcurrency;
}

/**
 * settings PATCH 完调一次，清缓存
 */
export function refreshConcurrencyFromSettings(): number {
  cachedConcurrency = null;
  return getImageConcurrency();
}
