"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  XCircle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { getThumbUrl } from "@/lib/thumb-url";

/**
 * 任务看板（feature 页顶部）
 *
 * ─────────────────────────────────────────────
 * 解决的问题：
 *   - 当前用户的进行中 / 历史任务在 SPA 内无持久入口
 *   - 切换 feature 页 / 刷新后丢失"任务正在跑"的视觉反馈
 *   - 多 tab + 多任务并发时缺少全局总览
 *
 * 行为：
 *   - 拉 /api/jobs/list?feature=X&limit=10 拿当前用户该 feature 的最近 10 个 job
 *   - 进行中的任务（running / canceling）每 4s 刷新一次
 *   - 完成 / 失败的任务"留下"——不自动清掉（即使任务结束也保留入口）
 *   - 点击任务 → 跳到 /history/{id} 单任务详情页（新窗口打开，不影响当前编辑状态）
 *
 * 设计取舍：
 *   - 不直接在当前页面"加载这个任务的视窗"——那会和当前 tab 的状态冲突
 *   - 用新窗口看历史任务 = 不打断当前工作流
 * ─────────────────────────────────────────────
 */

type JobStatus = "running" | "canceling" | "completed" | "failed" | "canceled";

interface JobBrief {
  id: string;
  feature: string;
  status: JobStatus;
  total_count: number;
  completed_count: number;
  failed_count: number;
  canceled_count: number;
  total_cost_cny: number;
  cover_image_url: string | null;
  created_at: number;
  finished_at: number | null;
}

export interface TaskDockProps {
  /** 过滤的 feature 名（"recolor" / "batch_photo"）*/
  feature: "recolor" | "batch_photo";
  /** 默认折叠状态，再大也只显示 top N。默认 8 */
  limit?: number;
  /** 进行中任务自动刷新间隔。默认 4000ms */
  pollIntervalMs?: number;
}

export function TaskDock({
  feature,
  limit = 8,
  pollIntervalMs = 4000,
}: TaskDockProps) {
  const [jobs, setJobs] = useState<JobBrief[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/jobs/list?feature=${feature}&limit=${limit}`,
      );
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const data = (await res.json()) as { items: JobBrief[] };
      setJobs(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [feature, limit]);

  // 初次加载
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 进行中任务定时刷新（没有进行中就不刷 / 后台标签页时也不刷，省网络 + 主线程）
  useEffect(() => {
    const hasActive = jobs.some(
      (j) => j.status === "running" || j.status === "canceling",
    );
    if (!hasActive) return;

    let t: ReturnType<typeof setInterval> | null = null;
    function startPolling() {
      if (t) return;
      t = setInterval(() => {
        void refresh();
      }, pollIntervalMs);
    }
    function stopPolling() {
      if (t) {
        clearInterval(t);
        t = null;
      }
    }

    // 页面在前台才轮询
    function handleVisibility() {
      if (document.hidden) stopPolling();
      else startPolling();
    }

    if (!document.hidden) startPolling();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [jobs, pollIntervalMs, refresh]);

  if (jobs.length === 0 && !loading) {
    // 没历史任务时不渲染（避免占位空间）
    return null;
  }

  return (
    <div className="rounded-md border border-border-subtle bg-bg-card mb-4 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-bg-tertiary border-b border-border-subtle">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-fg-tertiary font-semibold">
          <span>我的最近任务</span>
          <span className="chip chip-gray text-[10px]">
            {jobs.length}
          </span>
          {error ? (
            <span className="text-danger normal-case font-normal">
              · 加载失败
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="text-fg-tertiary hover:text-fg-primary p-1 rounded hover:bg-bg-hover disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw
            size={12}
            strokeWidth={2.2}
            className={loading ? "animate-spin" : ""}
          />
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto p-3">
        {jobs.map((j) => (
          <JobPill key={j.id} job={j} />
        ))}
        <a
          href="/history"
          className="flex-shrink-0 flex items-center gap-1 px-3 py-2 rounded-md text-[12px] text-fg-tertiary hover:text-brand-400 hover:bg-bg-hover transition-colors self-stretch border border-dashed border-border-default"
          title="查看完整历史"
        >
          <ExternalLink size={11} strokeWidth={2.2} />
          全部历史
        </a>
      </div>
    </div>
  );
}

function JobPill({ job }: { job: JobBrief }) {
  const status = job.status;
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const elapsed = formatRelativeTime(job.created_at);
  const progress = job.total_count
    ? Math.round((job.completed_count / job.total_count) * 100)
    : 0;

  return (
    <a
      href={`/history?job=${job.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex-shrink-0 group flex items-stretch gap-0 rounded-md border transition-colors hover:border-brand-500 ${meta.borderClass}`}
      style={meta.bgStyle}
      title={`点击在新窗口查看详情 · ${meta.tooltip}`}
    >
      {/* 缩略图 —— 用 100px webp 缩略图，避免拉原图（节省 95% 带宽 + 防止主线程 jank）*/}
      <div className="w-12 h-12 bg-bg-tertiary flex items-center justify-center overflow-hidden rounded-l-md flex-shrink-0">
        {job.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getThumbUrl(job.cover_image_url, 100)}
            alt=""
            className="w-full h-full object-contain"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <Icon
            size={16}
            strokeWidth={2.2}
            className={`${meta.iconColor} ${
              status === "running" || status === "canceling"
                ? "animate-spin"
                : ""
            }`}
          />
        )}
      </div>

      {/* 信息 */}
      <div className="flex flex-col justify-center px-2.5 py-1 min-w-[110px]">
        <div className="flex items-center gap-1.5 text-[11px]">
          <Icon
            size={10}
            strokeWidth={2.2}
            className={`${meta.iconColor} ${
              status === "running" || status === "canceling"
                ? "animate-spin"
                : ""
            } shrink-0`}
          />
          <span className={`${meta.iconColor} font-medium`}>
            {meta.label}
          </span>
          <span className="text-fg-tertiary font-mono">
            {job.completed_count}/{job.total_count}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1.5 text-[10px] text-fg-tertiary mt-0.5">
          <span>{elapsed}</span>
          {status === "running" || status === "canceling" ? (
            <span>{progress}%</span>
          ) : (
            <span>¥{job.total_cost_cny?.toFixed?.(2) ?? "0.00"}</span>
          )}
        </div>
      </div>
    </a>
  );
}

const STATUS_META: Record<
  JobStatus,
  {
    icon: typeof Loader2;
    iconColor: string;
    borderClass: string;
    bgStyle: React.CSSProperties;
    label: string;
    tooltip: string;
  }
> = {
  running: {
    icon: Loader2,
    iconColor: "text-brand-400",
    borderClass: "border-[rgba(59,130,246,0.4)]",
    bgStyle: { background: "var(--brand-50-bg)" },
    label: "进行中",
    tooltip: "任务进行中",
  },
  canceling: {
    icon: Loader2,
    iconColor: "text-warn",
    borderClass: "border-[rgba(245,158,11,0.4)]",
    bgStyle: { background: "var(--warn-bg)" },
    label: "取消中",
    tooltip: "正在取消任务",
  },
  completed: {
    icon: CheckCircle2,
    iconColor: "text-success",
    borderClass: "border-border-subtle",
    bgStyle: { background: "var(--bg-card)" },
    label: "已完成",
    tooltip: "任务已完成",
  },
  failed: {
    icon: AlertCircle,
    iconColor: "text-danger",
    borderClass: "border-[rgba(239,68,68,0.3)]",
    bgStyle: { background: "var(--danger-bg)" },
    label: "失败",
    tooltip: "任务失败",
  },
  canceled: {
    icon: XCircle,
    iconColor: "text-fg-tertiary",
    borderClass: "border-border-subtle",
    bgStyle: { background: "var(--bg-tertiary)" },
    label: "已取消",
    tooltip: "任务已取消",
  },
};

function formatRelativeTime(unixTs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixTs;
  if (diff < 60) return `${diff}s 前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m 前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h 前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d 前`;
  return new Date(unixTs * 1000).toLocaleDateString("zh-CN");
}
