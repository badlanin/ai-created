/**
 * render_jobs + render_job_items 的 CRUD 助手
 */

import { randomUUID } from "crypto";
import { getDb } from "./db";

export type JobStatus =
  | "running"
  | "canceling"
  | "canceled"
  | "completed"
  | "failed";

export type ItemStatus =
  | "queued"
  | "waiting_quota"
  | "processing"
  | "completed"
  | "failed"
  | "canceled";

export type JobFeature =
  | "recolor"
  | "batch_photo"
  | "identity_gen"
  | "background_swap"
  | "poster"
  | "social_snap"
  | "replicate";

export interface JobRow {
  id: string;
  user_id: number;
  feature: JobFeature;
  model: string;
  status: JobStatus;
  total_count: number;
  completed_count: number;
  failed_count: number;
  canceled_count: number;
  total_cost_cny: number;
  params: string | null;
  error_message: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface JobItemRow {
  id: number;
  job_id: string;
  idx: number;
  status: ItemStatus;
  label: string | null;
  result_image_path: string | null;
  result_image_url: string | null;
  /** 模型直出原图（未做色彩校正）相对路径，给手动滑块校色用 */
  raw_image_path: string | null;
  /** 校正元信息（JSON 字符串） */
  correction_meta: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_cny: number | null;
  error_message: string | null;
  retry_count: number;
  wait_until_ms: number | null;
  started_at: number | null;
  finished_at: number | null;
}

/* ───────── 创建 ───────── */

export function createJob(args: {
  user_id: number;
  feature: JobFeature;
  model: string;
  items: Array<{ label: string }>;
  params?: Record<string, unknown>;
}): JobRow {
  const db = getDb();
  const jobId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const params =
    args.params === undefined ? null : JSON.stringify(args.params);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO render_jobs
         (id, user_id, feature, model, status, total_count, params, created_at, started_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
    ).run(
      jobId,
      args.user_id,
      args.feature,
      args.model,
      args.items.length,
      params,
      now,
      now,
    );

    const insertItem = db.prepare(
      `INSERT INTO render_job_items (job_id, idx, status, label)
       VALUES (?, ?, 'queued', ?)`,
    );
    args.items.forEach((it, i) => insertItem.run(jobId, i, it.label));
  });
  tx();

  return getJobRequired(jobId);
}

/**
 * 单次出图工具（identity-generator / background-swap / poster / social-snap）
 * 用这个 helper 写一条立即 status='completed' 的 1-item job，
 * 让产物能在 /history 页面里被翻到。
 *
 * 跟 createJob 不同：
 *   - 不走 worker / 异步队列
 *   - 创建瞬间已经"完成"
 *   - 直接附带产物的 image_path / image_url
 */
export function recordSingleShotJob(args: {
  user_id: number;
  feature: JobFeature;
  model: string;
  /** 缩略图展示用的标签，比如 "背景换图：常春藤古堡" */
  label: string;
  /** 相对 DATA_DIR 的路径，如 "outputs/swap_xxx.png" */
  result_image_path: string;
  /** 浏览器可访问 URL，如 "/assets/outputs/swap_xxx.png" */
  result_image_url: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  cost_cny?: number;
  params?: Record<string, unknown>;
}): JobRow {
  const db = getDb();
  const jobId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const params =
    args.params === undefined ? null : JSON.stringify(args.params);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO render_jobs
         (id, user_id, feature, model, status,
          total_count, completed_count, failed_count, canceled_count,
          total_cost_cny, params,
          created_at, started_at, finished_at)
       VALUES (?, ?, ?, ?, 'completed',
               1, 1, 0, 0,
               ?, ?,
               ?, ?, ?)`,
    ).run(
      jobId,
      args.user_id,
      args.feature,
      args.model,
      args.cost_cny ?? 0,
      params,
      now,
      now,
      now,
    );

    db.prepare(
      `INSERT INTO render_job_items
         (job_id, idx, status, label,
          result_image_path, result_image_url,
          input_tokens, output_tokens, cost_cny,
          started_at, finished_at)
       VALUES (?, 0, 'completed', ?,
               ?, ?,
               ?, ?, ?,
               ?, ?)`,
    ).run(
      jobId,
      args.label,
      args.result_image_path,
      args.result_image_url,
      args.prompt_tokens ?? null,
      args.completion_tokens ?? null,
      args.cost_cny ?? null,
      now,
      now,
    );
  });
  tx();

  return getJobRequired(jobId);
}

/* ───────── 读 ───────── */

export function getJob(jobId: string): JobRow | null {
  const db = getDb();
  return (
    (db
      .prepare(`SELECT * FROM render_jobs WHERE id = ?`)
      .get(jobId) as JobRow | undefined) ?? null
  );
}

function getJobRequired(jobId: string): JobRow {
  const j = getJob(jobId);
  if (!j) throw new Error(`job ${jobId} 不存在`);
  return j;
}

export function getJobItems(jobId: string): JobItemRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM render_job_items WHERE job_id = ? ORDER BY idx ASC`,
    )
    .all(jobId) as JobItemRow[];
}

export function getJobWithItems(
  jobId: string,
): { job: JobRow; items: JobItemRow[] } | null {
  const job = getJob(jobId);
  if (!job) return null;
  const items = getJobItems(jobId);
  return { job, items };
}

/** 某用户的活跃任务数（左栏徽标用） */
export function countActiveJobsForUser(userId: number): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM render_jobs
       WHERE user_id = ? AND status IN ('running', 'canceling')`,
    )
    .get(userId) as { c: number };
  return row.c;
}

/** 列出某用户的活跃任务（带 item 状态汇总） */
export function listActiveJobsForUser(userId: number): Array<{
  job: JobRow;
  completed: number;
  failed: number;
  canceled: number;
  processing: number;
  queued: number;
}> {
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT * FROM render_jobs
       WHERE user_id = ? AND status IN ('running', 'canceling')
       ORDER BY created_at DESC`,
    )
    .all(userId) as JobRow[];
  return jobs.map((job) => {
    const stats = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN status='canceled' THEN 1 ELSE 0 END) AS canceled,
           SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END) AS processing,
           SUM(CASE WHEN status IN ('queued','waiting_quota') THEN 1 ELSE 0 END) AS queued
         FROM render_job_items WHERE job_id = ?`,
      )
      .get(job.id) as {
      completed: number | null;
      failed: number | null;
      canceled: number | null;
      processing: number | null;
      queued: number | null;
    };
    return {
      job,
      completed: stats.completed ?? 0,
      failed: stats.failed ?? 0,
      canceled: stats.canceled ?? 0,
      processing: stats.processing ?? 0,
      queued: stats.queued ?? 0,
    };
  });
}

/* ───────── 更新 item ───────── */

export interface UpdateItemPatch {
  status?: ItemStatus;
  result_image_path?: string | null;
  result_image_url?: string | null;
  raw_image_path?: string | null;
  correction_meta?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_cny?: number | null;
  error_message?: string | null;
  retry_count?: number;
  wait_until_ms?: number | null;
  /** true = 把 started_at 设为当前时间 */
  markStarted?: boolean;
  /** true = 把 finished_at 设为当前时间 */
  markFinished?: boolean;
}

export function updateJobItem(itemId: number, patch: UpdateItemPatch): void {
  const db = getDb();
  const setParts: string[] = [];
  const params: Array<string | number | null> = [];

  for (const [key, val] of Object.entries(patch)) {
    if (key === "markStarted" || key === "markFinished") continue;
    if (val === undefined) continue;
    setParts.push(`${key} = ?`);
    params.push(val as string | number | null);
  }

  if (patch.markStarted) {
    setParts.push("started_at = ?");
    params.push(Math.floor(Date.now() / 1000));
  }
  if (patch.markFinished) {
    setParts.push("finished_at = ?");
    params.push(Math.floor(Date.now() / 1000));
  }

  if (setParts.length === 0) return;

  params.push(itemId);
  db.prepare(
    `UPDATE render_job_items SET ${setParts.join(", ")} WHERE id = ?`,
  ).run(...params);
}

/** 根据 (job_id, idx) 拿 item id（方便 handler 使用） */
export function getJobItemByIdx(
  jobId: string,
  idx: number,
): JobItemRow | null {
  const db = getDb();
  return (
    (db
      .prepare(
        `SELECT * FROM render_job_items WHERE job_id = ? AND idx = ?`,
      )
      .get(jobId, idx) as JobItemRow | undefined) ?? null
  );
}

/* ───────── 更新 job 聚合状态 ───────── */

/**
 * 根据 items 的当前状态重算 job 的 completed/failed/canceled_count
 * 以及可能的最终 status。worker 每处理完一个 item 后调用。
 */
export function recomputeJobStats(jobId: string): JobRow {
  const db = getDb();
  const stats = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status='canceled' THEN 1 ELSE 0 END) AS canceled,
         SUM(CASE WHEN status IN ('queued','waiting_quota','processing') THEN 1 ELSE 0 END) AS active,
         COALESCE(SUM(cost_cny), 0) AS total_cost
       FROM render_job_items WHERE job_id = ?`,
    )
    .get(jobId) as {
    completed: number | null;
    failed: number | null;
    canceled: number | null;
    active: number | null;
    total_cost: number | null;
  };

  const completed = stats.completed ?? 0;
  const failed = stats.failed ?? 0;
  const canceled = stats.canceled ?? 0;
  const active = stats.active ?? 0;
  const totalCost = stats.total_cost ?? 0;

  const current = getJobRequired(jobId);
  let newStatus: JobStatus = current.status;
  let finishedAt: number | null = current.finished_at;

  if (active === 0 && current.status !== "completed" && current.status !== "failed" && current.status !== "canceled") {
    // 全部终态了，判定最终状态
    if (canceled > 0 && completed === 0 && failed === 0) {
      newStatus = "canceled";
    } else if (failed > 0 && completed === 0) {
      newStatus = "failed";
    } else {
      newStatus = "completed"; // 部分成功也算 completed
    }
    finishedAt = Math.floor(Date.now() / 1000);
  }

  db.prepare(
    `UPDATE render_jobs
     SET completed_count = ?, failed_count = ?, canceled_count = ?,
         total_cost_cny = ?, status = ?, finished_at = ?
     WHERE id = ?`,
  ).run(completed, failed, canceled, totalCost, newStatus, finishedAt, jobId);

  return getJobRequired(jobId);
}

/* ───────── 取消 ───────── */

/**
 * 标记 job 为 canceling。worker 会在下个 item 前检测到并退出。
 * 返回是否标记成功（job 不存在或已是终态返回 false）。
 */
export function markJobCanceling(jobId: string): boolean {
  const db = getDb();
  const r = db
    .prepare(
      `UPDATE render_jobs SET status = 'canceling'
       WHERE id = ? AND status = 'running'`,
    )
    .run(jobId);
  return r.changes > 0;
}

/**
 * worker 检测到 canceling 后调用：把所有未完成 item 标为 canceled
 */
export function finalizeCanceledJob(jobId: string): JobRow {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE render_job_items
     SET status = 'canceled', finished_at = ?
     WHERE job_id = ? AND status IN ('queued','waiting_quota')`,
  ).run(now, jobId);
  return recomputeJobStats(jobId);
}

/** 读 job 当前的 status（worker 热检查用） */
export function readJobStatus(jobId: string): JobStatus | null {
  const db = getDb();
  const r = db
    .prepare(`SELECT status FROM render_jobs WHERE id = ?`)
    .get(jobId) as { status: JobStatus } | undefined;
  return r?.status ?? null;
}

/* ───────── 列表（历史页 / 账单页用）───────── */

export function listJobsForUser(
  userId: number,
  opts: {
    limit?: number;
    offset?: number;
    status?: JobStatus;
    feature?: JobFeature;
  } = {},
): JobRow[] {
  const db = getDb();
  const wheres: string[] = ["user_id = ?"];
  const params: Array<string | number> = [userId];
  if (opts.status) {
    wheres.push("status = ?");
    params.push(opts.status);
  }
  if (opts.feature) {
    wheres.push("feature = ?");
    params.push(opts.feature);
  }
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  params.push(limit, offset);

  return db
    .prepare(
      `SELECT * FROM render_jobs
       WHERE ${wheres.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params) as JobRow[];
}
