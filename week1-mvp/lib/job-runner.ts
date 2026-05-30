/**
 * 后台任务执行器
 *
 * ─────────────────────────────────────────────
 * 设计：
 *   POST /api/jobs/recolor 创建 job 后立即返回 job_id（fire-and-forget）。
 *   本模块提供 runJob(jobId, handler) —— 在进程内 async 循环处理每个 item：
 *
 *     for item in items:
 *       if job.status == 'canceling' → 把剩下的标 canceled，退出
 *       mark item as waiting_quota
 *       await acquireToken(model)            ← 被 rate limiter 卡住时阻塞
 *       mark item as processing
 *       try:
 *         result = await handler(item, ctx)
 *         mark item completed + 写入 result
 *       except:
 *         mark item failed + 记 error
 *       recomputeJobStats(jobId)
 *
 *   item 间状态完全落 DB，前端轮询 GET /api/jobs/:id 能实时看到进度。
 *
 * 注意：
 *   - Next.js route handler 函数返回后，进程继续运行，async 任务能跑完
 *   - handler 内部异常不会冒泡炸进程，每个 item 独立 try/catch
 *   - 一个 job 对应一个 async 循环（串行）。多个 job 可以同时跑（不同循环）
 *   - 跨 job 的 rate limiter 共享同一 token bucket（per model）
 *   - 进程重启会打断，db.ts 里的 recoverOrphanJobs() 会把中断的 item 标成 failed
 * ─────────────────────────────────────────────
 */

import {
  getJob,
  getJobItemByIdx,
  getJobItems,
  readJobStatus,
  recomputeJobStats,
  finalizeCanceledJob,
  updateJobItem,
  type JobRow,
  type JobItemRow,
} from "./jobs-db";
import {
  acquireToken,
  peekNextTokenAtMs,
  getImageConcurrency,
} from "./rate-limiter";
import { runWithConcurrency } from "./concurrency";
import { getDb } from "./db";

/** 单条 item 成功后 handler 返回的结果 */
export interface ItemResult {
  result_image_path?: string;
  result_image_url?: string;
  /** 模型直出原图（未做色彩校正），给手动滑块校色用。仅 recolor 任务设置 */
  raw_image_path?: string | null;
  /** 校正元信息 JSON 字符串，给手动滑块校色用 */
  correction_meta?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  cost_cny?: number;
}

/** handler 回调上下文 */
export interface HandlerContext {
  job: JobRow;
  item: JobItemRow;
  /** 全量 job.params JSON 反序列化结果 */
  params: Record<string, unknown>;
  /** 每次 retry 递增，便于 handler 自己做去重命名等 */
  attempt: number;
  /** 等了 rate limiter 多久（ms），handler 自己判断要不要记到日志里 */
  waitedMs: number;
  /** 用户 id 的快捷访问 */
  userId: number;
}

export type ItemHandler = (
  ctx: HandlerContext,
) => Promise<ItemResult>;

interface StartOptions {
  /** 所有 item 跑完后执行一次（成功 / 取消 / 失败 均触发）。用于清理临时文件等 */
  onJobEnd?: (job: JobRow) => void | Promise<void>;
}

/**
 * 启动 job 的后台 worker（非阻塞，立即返回）
 *
 * 调用方拿到 job_id 返回给客户端后就可以走，本函数内部的 promise
 * 会在 Node event loop 里继续跑直到完成。
 */
export function startJobWorker(
  jobId: string,
  handler: ItemHandler,
  options: StartOptions = {},
): void {
  // 立即返回，内部 promise 不 await
  void runLoop(jobId, handler, options).catch((e) => {
    console.error(`[job-runner] job ${jobId} 主循环异常:`, e);
  });
}

async function runLoop(
  jobId: string,
  handler: ItemHandler,
  options: StartOptions,
): Promise<void> {
  const job = getJob(jobId);
  if (!job) {
    console.error(`[job-runner] job ${jobId} 不存在，跳过`);
    return;
  }
  console.log(
    `[job-runner] 启动 job=${jobId} feature=${job.feature} model=${job.model} items=${job.total_count}`,
  );

  const params: Record<string, unknown> = job.params
    ? safeParse(job.params)
    : {};

  // 取并发数（受 token bucket 节流，设大也不会超 RPM）
  const concurrency = getImageConcurrency();
  console.log(
    `[job-runner] job ${jobId} 用并发 ${concurrency}（受 RPM 节流）`,
  );

  const indices = Array.from({ length: job.total_count }, (_, i) => i);

  // 单个 item 的处理逻辑（被 N 个 worker 并发调用）
  const processItem = async (idx: number): Promise<void> => {
    // 每个 item 前检查 job 状态
    const status = readJobStatus(jobId);
    if (
      status === "canceling" ||
      status === "canceled" ||
      status === "failed" ||
      status === "completed"
    ) {
      return;
    }

    const item = getJobItemByIdx(jobId, idx);
    if (!item) {
      console.error(`[job-runner] item ${jobId}#${idx} 丢失，跳过`);
      return;
    }

    // 已经是终态（比如 recover 时被标 failed）就跳
    if (
      item.status === "completed" ||
      item.status === "failed" ||
      item.status === "canceled"
    ) {
      return;
    }

    // 1) 等 rate limiter（让前端能显示"等待 Google quota"）
    const nextTokenAtMs = peekNextTokenAtMs(job.model);
    const willWait = nextTokenAtMs - Date.now();
    if (willWait > 100) {
      updateJobItem(item.id, {
        status: "waiting_quota",
        wait_until_ms: nextTokenAtMs,
      });
    }

    const waitedMs = await acquireToken(job.model);

    // 取消检查（acquire 等待期间可能被取消）
    const statusAfter = readJobStatus(jobId);
    if (statusAfter === "canceling" || statusAfter === "canceled") {
      // token 已经拿到但我们不用 —— 稍微浪费，但 bucket 会 refill 回来
      updateJobItem(item.id, {
        status: "canceled",
        markFinished: true,
      });
      return;
    }

    // 2) 进入 processing
    updateJobItem(item.id, {
      status: "processing",
      wait_until_ms: null,
      markStarted: true,
    });

    // 3) 调用 handler
    try {
      const result = await handler({
        job,
        item,
        params,
        attempt: (item.retry_count ?? 0) + 1,
        waitedMs,
        userId: job.user_id,
      });

      updateJobItem(item.id, {
        status: "completed",
        result_image_path: result.result_image_path ?? null,
        result_image_url: result.result_image_url ?? null,
        raw_image_path: result.raw_image_path ?? null,
        correction_meta: result.correction_meta ?? null,
        input_tokens: result.input_tokens ?? null,
        output_tokens: result.output_tokens ?? null,
        cost_cny: result.cost_cny ?? null,
        markFinished: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[job-runner] item ${jobId}#${idx} 失败: ${msg.slice(0, 200)}`,
      );
      updateJobItem(item.id, {
        status: "failed",
        error_message: msg.slice(0, 1000),
        markFinished: true,
      });
    }

    // 4) 刷新 job 聚合状态（每个 item 完成后都刷一次，并发场景下也安全）
    try {
      recomputeJobStats(jobId);
    } catch (e) {
      console.error(`[job-runner] recomputeJobStats ${jobId} 失败:`, e);
    }
  };

  // 按并发数 fan-out 执行所有 item
  await runWithConcurrency(indices, concurrency, processItem);

  // 退出循环：如果是被取消就 finalize
  const endStatus = readJobStatus(jobId);
  let finalJob: JobRow | null = null;
  if (endStatus === "canceling") {
    finalJob = finalizeCanceledJob(jobId);
  } else {
    finalJob = recomputeJobStats(jobId);
  }

  console.log(
    `[job-runner] job ${jobId} 结束 status=${finalJob.status} ` +
      `completed=${finalJob.completed_count} failed=${finalJob.failed_count} canceled=${finalJob.canceled_count}`,
  );

  // 写入 generations 表（兼容老 /history 页面）
  try {
    writeGenerationFromJob(finalJob);
  } catch (e) {
    console.error(`[job-runner] 写 generations ${jobId} 失败:`, e);
  }

  if (options.onJobEnd) {
    try {
      await options.onJobEnd(finalJob);
    } catch (e) {
      console.error(`[job-runner] onJobEnd ${jobId} 异常:`, e);
    }
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * 把 render_job 的结果落一份到 generations 表
 *
 * 老的 /history 页面从 generations 表读。新的任务队列只写
 * render_jobs + render_job_items，不写 generations，所以历史页看不到新任务。
 *
 * 这里在 job 结束时把成功的结果整合成一条 generations 记录插入，
 * 保证历史页能看到所有任务（新老接口都兼容）。
 */
function writeGenerationFromJob(job: JobRow): void {
  const items = getJobItems(job.id);
  const successful = items.filter(
    (it) => it.status === "completed" && it.result_image_url,
  );

  // 把 feature 映射成老 kind 字段值（兼容老 UI）
  const kind = job.feature === "recolor" ? "recolor" : "on_model";

  const outputImages = JSON.stringify(
    successful.map((it) => it.result_image_url),
  );

  // 从 job.params（里面可能有 colors/poses 等元信息）+ 新增 job_id / item_summary 融合 params
  const params = safeParse(job.params || "{}");
  params.job_id = job.id;
  params.total_count = job.total_count;
  params.completed_count = job.completed_count;
  params.failed_count = job.failed_count;
  params.canceled_count = job.canceled_count;
  params.total_cost_cny = job.total_cost_cny;
  params.model = job.model;

  const durationMs =
    job.started_at !== null && job.finished_at !== null
      ? (job.finished_at - job.started_at) * 1000
      : null;

  const success = successful.length > 0 ? 1 : 0;
  const errorMsg =
    successful.length === 0
      ? job.error_message ||
        items.find((it) => it.error_message)?.error_message ||
        `全部 ${job.total_count} 张失败`
      : null;

  const db = getDb();
  db.prepare(
    `INSERT INTO generations (user_id, kind, input_images, output_images, params, duration_ms, success, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.user_id,
    kind,
    null, // input_images：新版任务不保留输入图路径到历史（避免暴露临时文件）
    outputImages,
    JSON.stringify(params),
    durationMs,
    success,
    errorMsg,
  );
}
