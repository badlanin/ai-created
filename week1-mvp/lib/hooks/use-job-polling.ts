"use client";

import { useEffect, useRef, useState } from "react";

/** 后端 API 返回的 job 对象（对照 lib/jobs-db.ts 的 JobRow） */
export interface PolledJob {
  id: string;
  user_id: number;
  feature: "recolor" | "batch_photo";
  model: string;
  status: "running" | "canceling" | "canceled" | "completed" | "failed";
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

export interface PolledJobItem {
  id: number;
  job_id: string;
  idx: number;
  status:
    | "queued"
    | "waiting_quota"
    | "processing"
    | "completed"
    | "failed"
    | "canceled";
  label: string | null;
  result_image_path: string | null;
  result_image_url: string | null;
  /** 模型直出原图路径（仅 recolor 任务）*/
  raw_image_path?: string | null;
  /** 校正元信息 JSON（仅 recolor 任务）*/
  correction_meta?: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_cny: number | null;
  error_message: string | null;
  retry_count: number;
  wait_until_ms: number | null;
  started_at: number | null;
  finished_at: number | null;
}

export interface PollResult {
  job: PolledJob;
  items: PolledJobItem[];
  next_token_eta_ms: number;
  next_token_ready_at_ms: number;
  server_time_ms: number;
}

export interface PollState {
  loading: boolean;
  data: PollResult | null;
  error: string | null;
}

/**
 * 轮询单个任务状态
 *
 * - jobId 为 null 时停止轮询
 * - job 进入终态（completed/canceled/failed）后自动停止
 * - 间隔默认 1500ms
 * - 组件卸载时自动清理
 *
 * 关键实现：
 *   onFinished 用 ref 存，**不放进 useEffect 依赖**，避免调用方传内联函数
 *   导致 useEffect 每次 re-render 都重新订阅（那会造成无限循环卡死浏览器）。
 *
 * @example
 *   const { data, loading, error } = useJobPolling(jobId);
 */
export function useJobPolling(
  jobId: string | null,
  options: {
    intervalMs?: number;
    /** 一次成功拉取到终态后的回调，用于 toast/通知/重置状态等 */
    onFinished?: (result: PollResult) => void;
  } = {},
): PollState {
  const { intervalMs = 1500, onFinished } = options;

  // 用 ref 存最新的 onFinished，让内部 poll() 总能拿到最新闭包，
  // 但 useEffect 不需要把它放进 deps。
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const [state, setState] = useState<PollState>({
    loading: false,
    data: null,
    error: null,
  });
  const finishedFiredRef = useRef(false);

  useEffect(() => {
    if (!jobId) {
      // 只有在真的变过的时候才 setState，避免无意义的 re-render
      setState((prev) => {
        if (!prev.loading && !prev.data && !prev.error) return prev;
        return { loading: false, data: null, error: null };
      });
      finishedFiredRef.current = false;
      return;
    }

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (!alive) return;
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) {
          const msg =
            res.status === 404
              ? "任务不存在"
              : ((await res.json().catch(() => ({}))).error as string) ||
                `HTTP ${res.status}`;
          if (alive) setState({ loading: false, data: null, error: msg });
          return;
        }
        const data = (await res.json()) as PollResult;
        if (!alive) return;
        setState({ loading: false, data, error: null });

        const terminal =
          data.job.status === "completed" ||
          data.job.status === "canceled" ||
          data.job.status === "failed";

        if (terminal) {
          if (!finishedFiredRef.current) {
            finishedFiredRef.current = true;
            try {
              onFinishedRef.current?.(data);
            } catch (e) {
              console.error("[use-job-polling] onFinished 回调异常:", e);
            }
          }
          return;
        }

        timer = setTimeout(poll, intervalMs);
      } catch (e) {
        if (!alive) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        }));
        timer = setTimeout(poll, 5000);
      }
    }

    setState({ loading: true, data: null, error: null });
    finishedFiredRef.current = false;
    poll();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // 注意：只依赖真正会变的 jobId 和 intervalMs，不包含 onFinished（用 ref）
  }, [jobId, intervalMs]);

  return state;
}

/**
 * 向服务器发送取消请求
 */
export async function cancelJob(jobId: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, message: body.error || `HTTP ${res.status}` };
  }
  const body = (await res.json()) as { ok: boolean; message: string };
  return body;
}
