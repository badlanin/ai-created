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
let cachedRate: { capacity: number; refillPerSecond: number } | null = null;

/**
 * 从 settings 表读当前费率配置
 */
function readRateFromSettings(): {
  capacity: number;
  refillPerSecond: number;
} {
  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT key, value FROM settings WHERE key IN ('image_rate_limit_per_min', 'image_rate_burst')`,
      )
      .all() as Array<{ key: string; value: string }>;
    const map = new Map(row.map((r) => [r.key, r.value]));
    const perMin = Number(map.get("image_rate_limit_per_min") ?? "2");
    const burst = Number(map.get("image_rate_burst") ?? "2");
    const ratePerMin = Number.isFinite(perMin) && perMin > 0 ? perMin : 2;
    const capacity = Number.isFinite(burst) && burst > 0 ? burst : ratePerMin;
    return {
      capacity,
      refillPerSecond: ratePerMin / 60,
    };
  } catch {
    // DB 还没起或出错时用默认值，不阻塞
    return { capacity: 2, refillPerSecond: 2 / 60 };
  }
}

/**
 * 获取某模型的 bucket。首次访问时懒加载。
 */
export function getBucket(model: string): TokenBucket {
  let b = buckets.get(model);
  if (!b) {
    if (!cachedRate) cachedRate = readRateFromSettings();
    b = new TokenBucket(cachedRate.capacity, cachedRate.refillPerSecond);
    buckets.set(model, b);
  }
  return b;
}

/**
 * 从 DB 热加载费率并应用到所有已创建的 bucket
 *
 * admin 在管理页修改 image_rate_limit_per_min 后调用一次即可。
 */
export function refreshRateFromSettings(): {
  capacity: number;
  refillPerSecond: number;
} {
  cachedRate = readRateFromSettings();
  for (const b of buckets.values()) {
    b.reconfigure(cachedRate.capacity, cachedRate.refillPerSecond);
  }
  return cachedRate;
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
