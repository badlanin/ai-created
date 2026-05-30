/**
 * 带并发上限的任务执行器
 *
 * 对比 Promise.all（全并发，容易撞 429）和 for 循环（完全串行，太慢），
 * 这个函数允许你指定"同时跑 N 个"，剩下的排队，一个结束就塞下一个进去。
 *
 * 返回按原顺序排列的结果数组，每项包含 value 或 error，不会因为单个失败而
 * 打断整批。
 */

export interface ConcurrencyResult<R> {
  index: number;
  value?: R;
  error?: unknown;
}

/**
 * @param items 输入任务列表
 * @param limit 并发上限（建议 Flash Image = 2-3，Pro Image = 1-2）
 * @param handler 单个任务的处理函数
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<R>,
): Promise<ConcurrencyResult<R>[]> {
  if (items.length === 0) return [];

  const results: ConcurrencyResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  // N 个 worker 并行从任务池里抢任务
  const workers: Promise<void>[] = [];
  const workerCount = Math.max(1, Math.min(limit, items.length));

  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = nextIndex++;
          if (i >= items.length) return;
          try {
            const value = await handler(items[i], i);
            results[i] = { index: i, value };
          } catch (error) {
            results[i] = { index: i, error };
          }
        }
      })(),
    );
  }

  await Promise.all(workers);
  return results;
}

/**
 * 简化版：基于 model 推荐的并发上限
 * Pro Image 因为 thinking 阶段和 quota 问题，推荐 1；Flash 系列 2-3
 */
export function recommendConcurrency(modelId: string): number {
  if (modelId.includes("pro-image")) return 1;
  if (modelId.includes("-image")) return 2;
  // 默认文本模型
  return 3;
}
