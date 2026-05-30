/**
 * 通用的重试 + 指数退避工具
 *
 * 典型用途：Nano Banana 调用偶尔会返回 429 (RESOURCE_EXHAUSTED)
 * 或 503，加个退避重试就能救回来。
 */

export interface RetryOptions {
  /** 最大重试次数（不含首次调用）。默认 5 */
  maxRetries?: number;
  /** 首次退避时长（毫秒）。默认 2000ms */
  initialDelayMs?: number;
  /** 退避上限。默认 60000ms */
  maxDelayMs?: number;
  /** 退避倍数。默认 2 */
  factor?: number;
  /** 判断错误是否可重试。默认识别 429/503/网络错误 */
  shouldRetry?: (error: unknown) => boolean;
  /** 每次重试前的回调（用于记日志） */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/** 默认的重试判定 */
export function defaultShouldRetry(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    /429/.test(msg) ||
    /RESOURCE_EXHAUSTED/i.test(msg) ||
    /503/.test(msg) ||
    /UNAVAILABLE/i.test(msg) ||
    // Gemini 服务端偶发 500 INTERNAL（"Internal error encountered."），
    // 通常机房/负载均衡/内部超时引起，是 transient，retry 一般能过
    /500.*INTERNAL/i.test(msg) ||
    /\bINTERNAL\b/.test(msg) ||
    /Internal error encountered/i.test(msg) ||
    /fetch failed/i.test(msg) ||
    /ECONNRESET/i.test(msg) ||
    /ETIMEDOUT/i.test(msg) ||
    /socket hang up/i.test(msg) ||
    // Nano Banana / Gemini Image 偶发"返回响应但里面没图像"的 bug
    // （safety filter 误拦 / 模型给文本不给图 / 空 candidates）
    // 这是 transient error，retry 一般能过。不重试 = 一次就败
    /没返回图片/.test(msg) ||
    /no image/i.test(msg) ||
    /no candidate/i.test(msg) ||
    /empty response/i.test(msg) ||
    // safety filter 触发（Gemini 把模特图当敏感内容拦了）—— retry 几次概率会过
    // （注：如果是真正违规内容，多次 retry 还是会失败，最终用户看到错误，体验合理）
    /SAFETY/i.test(msg) ||
    /blocked/i.test(msg) ||
    /finishReason.*safety/i.test(msg)
  );
}

/**
 * 跑一个异步函数，失败且可重试时按指数退避重试
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 5,
    initialDelayMs = 2000,
    maxDelayMs = 60_000,
    factor = 2,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === maxRetries || !shouldRetry(e)) {
        throw e;
      }
      // 指数退避 + ~0-1s 抖动，避免所有请求同时重发
      const exp = initialDelayMs * Math.pow(factor, attempt);
      const jitter = Math.random() * 1000;
      const delay = Math.min(exp + jitter, maxDelayMs);
      onRetry?.(e, attempt + 1, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
