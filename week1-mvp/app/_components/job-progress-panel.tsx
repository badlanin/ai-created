"use client";

import { useEffect, useState } from "react";
import type { PolledJob, PolledJobItem } from "@/lib/hooks/use-job-polling";
import { cancelJob } from "@/lib/hooks/use-job-polling";
import { Thumbnail, ThumbnailBadge } from "./thumbnail";
import {
  downloadImagesAsZip,
  downloadSingleImage,
} from "@/lib/download-zip";

export interface JobProgressPanelProps {
  job: PolledJob;
  items: PolledJobItem[];
  /** 下个 token 可用的服务端时间戳（ms） */
  nextTokenReadyAtMs?: number;
  /** 服务端时间，用来校正本地时钟偏差 */
  serverTimeMs?: number;
  /** 结束按钮点击回调（父组件负责清理 UI 状态） */
  onCancelDone?: () => void;
}

/**
 * 右栏任务进度看板
 *
 * 展示：
 *   - 汇总：X/Y 完成 · 耗时 · 累计成本 · 状态徽标
 *   - 取消按钮（只有 running 状态显示）
 *   - 调试日志（可折叠，显示每个 item 的 waiting_quota 倒计时）
 *   - 缩略图网格：已完成的图实时出现（failed 标红色边框，canceled 隐藏）
 */
export function JobProgressPanel({
  job,
  items,
  nextTokenReadyAtMs,
  serverTimeMs,
  onCancelDone,
}: JobProgressPanelProps) {
  const [cancelling, setCancelling] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // 服务端时钟 vs 本地时钟的偏差校正
  const clockSkewMs = serverTimeMs ? serverTimeMs - Date.now() : 0;

  // 每秒 tick，用于倒计时 UI 刷新
  const [, setTick] = useState(0);
  useEffect(() => {
    if (job.status !== "running" && job.status !== "canceling") return;
    const interval = setInterval(() => setTick((v) => v + 1), 500);
    return () => clearInterval(interval);
  }, [job.status]);

  const activeCount = items.filter(
    (it) =>
      it.status === "queued" ||
      it.status === "waiting_quota" ||
      it.status === "processing",
  ).length;

  const completed = items.filter((it) => it.status === "completed");
  const failed = items.filter((it) => it.status === "failed");
  const waitingItem = items.find((it) => it.status === "waiting_quota");

  // 耗时
  const elapsedMs =
    job.started_at !== null
      ? (job.finished_at ?? Math.floor(Date.now() / 1000)) * 1000 -
        job.started_at * 1000
      : 0;

  // 预估剩余：根据已完成的平均耗时 × 剩余数量
  const estimatedRemainingMs = (() => {
    if (completed.length === 0 || activeCount === 0) return null;
    const totalCompletedMs = completed.reduce((acc, it) => {
      if (!it.started_at || !it.finished_at) return acc;
      return acc + (it.finished_at - it.started_at) * 1000;
    }, 0);
    const avgMs = totalCompletedMs / Math.max(1, completed.length);
    return Math.round(avgMs * activeCount);
  })();

  async function handleCancel() {
    if (!confirm("确定要强制停止任务吗？\n\n已在生成的图会完成；未开始的图会被跳过，不产生费用。")) {
      return;
    }
    setCancelling(true);
    const r = await cancelJob(job.id);
    setCancelling(false);
    if (!r.ok) alert(r.message);
  }

  const running = job.status === "running" || job.status === "canceling";

  return (
    <div className="space-y-3">
      {/* 汇总卡片 */}
      <div className="rounded-md border border-blue-200 bg-blue-50/50 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <StatusDot status={job.status} />
            <span>{jobStatusLabel(job.status)}</span>
            <span className="text-xs text-gray-500 font-mono">
              #{job.id.slice(0, 8)}
            </span>
          </div>
          {running ? (
            <button
              onClick={handleCancel}
              disabled={cancelling || job.status === "canceling"}
              className="px-2 py-1 text-xs rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40"
              title="已在生成的不受影响，仅丢弃队列剩余"
            >
              {cancelling || job.status === "canceling" ? "取消中…" : "强制停止"}
            </button>
          ) : onCancelDone ? (
            <button
              onClick={onCancelDone}
              className="px-2 py-1 text-xs rounded text-gray-500 hover:text-gray-800"
            >
              收起
            </button>
          ) : null}
        </div>

        <div className="space-y-1.5 text-xs text-gray-700">
          <ProgressBar
            completed={job.completed_count}
            total={job.total_count}
            failed={job.failed_count}
            canceled={job.canceled_count}
          />
          <div className="flex justify-between text-[11px] text-gray-600">
            <span>
              <b className="text-gray-900">{job.completed_count}</b> /{" "}
              {job.total_count} 完成
              {job.failed_count > 0 ? (
                <span className="ml-1.5 text-red-600">
                  · {job.failed_count} 失败
                </span>
              ) : null}
              {job.canceled_count > 0 ? (
                <span className="ml-1.5 text-gray-400">
                  · {job.canceled_count} 跳过
                </span>
              ) : null}
            </span>
            <span>¥{job.total_cost_cny.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-[11px] text-gray-500">
            <span>耗时 {formatDuration(elapsedMs)}</span>
            {estimatedRemainingMs !== null && running ? (
              <span>
                预估剩余 ~{formatDuration(estimatedRemainingMs)}
              </span>
            ) : null}
          </div>

          {/* 被 quota 挡住时的倒计时 */}
          {running && waitingItem && nextTokenReadyAtMs ? (
            <div className="mt-2 rounded bg-amber-50 border border-amber-200 px-2 py-1.5 flex items-center justify-between">
              <span className="text-[11px] text-amber-800">
                等待 Google quota…
              </span>
              <span className="text-[11px] font-mono text-amber-700">
                {formatCountdown(nextTokenReadyAtMs + clockSkewMs - Date.now())}
              </span>
            </div>
          ) : null}

          {job.error_message ? (
            <div className="mt-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 break-all">
              {job.error_message}
            </div>
          ) : null}
        </div>
      </div>

      {/* 调试日志（折叠） */}
      {items.length > 0 ? (
        <div className="rounded-md border border-gray-200">
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-gray-500 hover:text-gray-800 hover:bg-gray-50"
          >
            <span>详细日志（{items.length} 条）</span>
            <span>{showLog ? "▾" : "▸"}</span>
          </button>
          {showLog ? (
            <div className="px-3 pb-2 space-y-0.5 max-h-48 overflow-y-auto text-[10px] font-mono text-gray-600">
              {items.map((it) => (
                <div key={it.id} className="flex items-center gap-1.5 truncate">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${itemStatusColor(it.status)}`}
                  />
                  <span className="w-12 tabular-nums text-gray-400">
                    #{it.idx + 1}
                  </span>
                  <span className="w-16 shrink-0">{it.status}</span>
                  <span className="truncate flex-1">
                    {it.label ?? ""}
                    {it.error_message ? ` — ${it.error_message}` : ""}
                  </span>
                  {it.cost_cny !== null ? (
                    <span className="shrink-0 tabular-nums text-gray-500">
                      ¥{it.cost_cny.toFixed(3)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 结果缩略图网格（排序：完成 → 失败） */}
      {completed.length > 0 || failed.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-1.5 gap-2">
            <div className="text-[11px] text-gray-500">
              已完成（{completed.length}）
              {failed.length > 0 ? `· 失败 ${failed.length}` : ""}
            </div>
            {completed.length > 0 ? (
              <div className="flex gap-1">
                {selectedIds.size > 0 ? (
                  <button
                    onClick={() => downloadChosen(completed.filter((it) => selectedIds.has(it.id)))}
                    disabled={zipping}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {zipping && zipProgress
                      ? `打包 ${zipProgress.done}/${zipProgress.total}`
                      : `ZIP 选中 (${selectedIds.size})`}
                  </button>
                ) : null}
                <button
                  onClick={() => downloadChosen(completed)}
                  disabled={zipping}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {zipping && zipProgress
                    ? `打包 ${zipProgress.done}/${zipProgress.total}`
                    : "下载全部"}
                </button>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {completed.map((it) => {
              const isSel = selectedIds.has(it.id);
              return (
                <Thumbnail
                  key={it.id}
                  src={it.result_image_url || ""}
                  alt={it.label || `#${it.idx + 1}`}
                  ratio="3/4"
                  fit="contain"
                  selected={isSel}
                  onClick={() => toggleSelect(it.id)}
                  checkbox={
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(it.id);
                      }}
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center text-[9px] ${
                        isSel
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "bg-white/90 border-gray-400"
                      }`}
                    >
                      {isSel ? "✓" : ""}
                    </button>
                  }
                  badge={
                    it.cost_cny !== null ? (
                      <ThumbnailBadge tone="gray">
                        ¥{it.cost_cny.toFixed(2)}
                      </ThumbnailBadge>
                    ) : undefined
                  }
                  hoverOverlay={
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (it.result_image_url) {
                          downloadSingleImage(
                            it.result_image_url,
                            filenameOf(it),
                          );
                        }
                      }}
                      className="px-2 py-0.5 bg-white/90 text-gray-800 text-[10px] rounded"
                    >
                      下载
                    </button>
                  }
                />
              );
            })}
            {failed.map((it) => (
              <div
                key={it.id}
                title={it.error_message ?? "生成失败"}
                className="relative aspect-[3/4] rounded-md bg-red-50 border border-red-300 flex items-center justify-center text-[10px] text-red-700 p-1.5 text-center overflow-hidden"
              >
                <div>
                  <div className="font-medium">✕ 失败</div>
                  <div className="truncate mt-0.5">{it.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  /* ─── 内部函数 ─── */

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function filenameOf(it: PolledJobItem): string {
    const safe = (it.label || `item_${it.idx + 1}`).replace(/[/\\?%*:|"<>]/g, "_");
    return `${safe}.png`;
  }

  async function downloadChosen(items: PolledJobItem[]) {
    const entries = items
      .filter((it) => it.result_image_url)
      .map((it) => ({
        url: it.result_image_url!,
        filename: filenameOf(it),
      }));
    if (entries.length === 0) return;
    setZipping(true);
    setZipProgress({ done: 0, total: entries.length });
    try {
      await downloadImagesAsZip(
        entries,
        `${job.feature}_${job.id.slice(0, 8)}.zip`,
        (done, total) => setZipProgress({ done, total }),
      );
    } finally {
      setZipping(false);
      setZipProgress(null);
    }
  }
}

/* ─────────── 内部小件 ─────────── */

function jobStatusLabel(s: PolledJob["status"]): string {
  return (
    {
      running: "进行中",
      canceling: "取消中…",
      canceled: "已停止",
      completed: "已完成",
      failed: "失败",
    }[s] || s
  );
}

function StatusDot({ status }: { status: PolledJob["status"] }) {
  const color =
    status === "running"
      ? "bg-blue-500 animate-pulse"
      : status === "canceling"
        ? "bg-amber-500 animate-pulse"
        : status === "completed"
          ? "bg-green-500"
          : status === "canceled"
            ? "bg-gray-400"
            : "bg-red-500";
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function itemStatusColor(s: PolledJobItem["status"]): string {
  return (
    {
      queued: "bg-gray-300",
      waiting_quota: "bg-amber-500",
      processing: "bg-blue-500 animate-pulse",
      completed: "bg-green-500",
      failed: "bg-red-500",
      canceled: "bg-gray-300",
    }[s] || "bg-gray-300"
  );
}

function ProgressBar({
  completed,
  total,
  failed,
  canceled,
}: {
  completed: number;
  total: number;
  failed: number;
  canceled: number;
}) {
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="relative h-2 w-full rounded-full bg-gray-200 overflow-hidden flex">
      <div className="h-full bg-green-500" style={{ width: `${pct(completed)}%` }} />
      <div className="h-full bg-red-500" style={{ width: `${pct(failed)}%` }} />
      <div className="h-full bg-gray-400" style={{ width: `${pct(canceled)}%` }} />
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 0) return "-";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}:${String(rs).padStart(2, "0")}`;
}

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${s}s 后`;
}
