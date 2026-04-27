"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Sparkles,
  Clock,
  CheckCircle2,
  AlertOctagon,
  CircleOff,
  Ban,
  Download,
  Copy,
} from "lucide-react";
import { Button, Chip, SegmentedProgressBar, Card } from "./ui";
import { Thumbnail } from "./thumbnail";
import type { PolledJob, PolledJobItem } from "@/lib/hooks/use-job-polling";
import { cancelJob } from "@/lib/hooks/use-job-polling";
import {
  downloadImagesAsZip,
  downloadSingleImage,
} from "@/lib/download-zip";

export interface TaskViewportProps {
  job: PolledJob;
  items: PolledJobItem[];
  nextTokenReadyAtMs?: number;
  serverTimeMs?: number;
  /** 点击"返回配置"回调。job 在跑的时候返回按钮仍可用（表单不会丢） */
  onBackToForm: () => void;
  /** 任务已结束时点击"开始新任务"回调（清空当前，回到表单） */
  onStartNew?: () => void;
  /** 结果文件名生成 */
  makeFilename?: (item: PolledJobItem) => string;
  /** zip 文件前缀 */
  zipPrefix?: string;
}

/**
 * 生图任务的中栏动态视窗
 *
 * 消除用户之前抱怨的"黑盒感"：任务运行时，整个中栏变成一个
 * 专注的"生成监视器" —— 大的进度条 + 实时缩略图流 + 单张/批量下载
 *
 * 用户可以随时点"返回配置"回到表单（任务继续在后台跑）。
 */
export function TaskViewport({
  job,
  items,
  nextTokenReadyAtMs,
  serverTimeMs,
  onBackToForm,
  onStartNew,
  makeFilename,
  zipPrefix = "task",
}: TaskViewportProps) {
  const [cancelling, setCancelling] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // 每秒重绘（倒计时 + 计时）
  const [, setTick] = useState(0);
  useEffect(() => {
    if (job.status !== "running" && job.status !== "canceling") return;
    const it = setInterval(() => setTick((v) => v + 1), 500);
    return () => clearInterval(it);
  }, [job.status]);

  const clockSkew = serverTimeMs ? serverTimeMs - Date.now() : 0;

  const completed = items.filter((it) => it.status === "completed");
  const failed = items.filter((it) => it.status === "failed");
  const canceled = items.filter((it) => it.status === "canceled");
  const active = items.filter(
    (it) =>
      it.status === "queued" ||
      it.status === "waiting_quota" ||
      it.status === "processing",
  );
  const waiting = items.find((it) => it.status === "waiting_quota");
  const processing = items.find((it) => it.status === "processing");

  const elapsedMs =
    job.started_at !== null
      ? (job.finished_at ?? Math.floor(Date.now() / 1000)) * 1000 -
        job.started_at * 1000
      : 0;

  const remainingMs = (() => {
    if (completed.length === 0 || active.length === 0) return null;
    const avg = completed.reduce((acc, it) => {
      if (!it.started_at || !it.finished_at) return acc;
      return acc + (it.finished_at - it.started_at) * 1000;
    }, 0) / Math.max(1, completed.length);
    return Math.round(avg * active.length);
  })();

  const running = job.status === "running" || job.status === "canceling";
  const terminal =
    job.status === "completed" ||
    job.status === "canceled" ||
    job.status === "failed";

  async function handleCancel() {
    if (
      !confirm(
        "强制停止本次生成？\n\n正在飞的图会完成（无法中断），队列中剩余的图会被跳过、不产生费用。",
      )
    )
      return;
    setCancelling(true);
    const r = await cancelJob(job.id);
    setCancelling(false);
    if (!r.ok) alert(r.message);
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(completed.map((it) => it.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function resolveFilename(it: PolledJobItem): string {
    if (makeFilename) return makeFilename(it);
    const safe = (it.label || `item_${it.idx + 1}`).replace(
      /[/\\?%*:|"<>]/g,
      "_",
    );
    return `${safe}.png`;
  }

  async function downloadChosen(list: PolledJobItem[]) {
    const entries = list
      .filter((it) => it.result_image_url)
      .map((it) => ({
        url: it.result_image_url!,
        filename: resolveFilename(it),
      }));
    if (entries.length === 0) return;
    setZipping(true);
    setZipProgress({ done: 0, total: entries.length });
    try {
      await downloadImagesAsZip(
        entries,
        `${zipPrefix}_${job.id.slice(0, 8)}_${Date.now()}.zip`,
        (done, total) => setZipProgress({ done, total }),
      );
    } finally {
      setZipping(false);
      setZipProgress(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部条：返回 + 状态 */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border-subtle bg-bg-secondary/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft size={14} strokeWidth={2.2} />}
            onClick={onBackToForm}
          >
            返回配置
          </Button>
          <div className="h-4 w-px bg-bg-elevated" />
          <StatusChip status={job.status} />
          <span className="text-[11px] text-fg-tertiary font-mono">
            #{job.id.slice(0, 8)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <Button
              variant="danger-outline"
              size="sm"
              leftIcon={<Ban size={14} strokeWidth={2} />}
              loading={cancelling || job.status === "canceling"}
              onClick={handleCancel}
            >
              强制停止
            </Button>
          ) : null}
          {terminal && onStartNew ? (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Sparkles size={14} strokeWidth={2} />}
              onClick={onStartNew}
            >
              开始新任务
            </Button>
          ) : null}
        </div>
      </div>

      {/* 主内容 */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-5 py-5 space-y-5">
          {/* 大进度卡片 */}
          <Card padding="md" elevated>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-[11px] text-fg-tertiary uppercase tracking-wider font-medium">
                  总进度
                </div>
                <div className="mt-0.5 text-3xl font-semibold text-fg-primary tabular-nums">
                  {job.completed_count}
                  <span className="text-fg-tertiary text-xl font-normal">
                    {" "}
                    / {job.total_count}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-fg-tertiary uppercase tracking-wider font-medium">
                  累计成本
                </div>
                <div className="mt-0.5 text-3xl font-semibold text-fg-primary tabular-nums">
                  ¥{job.total_cost_cny.toFixed(2)}
                </div>
              </div>
            </div>

            <SegmentedProgressBar
              total={job.total_count}
              segments={[
                { value: completed.length, tone: "success" },
                { value: failed.length, tone: "danger" },
                { value: canceled.length, tone: "gray" },
              ]}
            />

            <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-fg-tertiary">
              <span className="inline-flex items-center gap-1.5">
                <Clock size={12} strokeWidth={2} />
                耗时 {formatDuration(elapsedMs)}
              </span>
              {remainingMs !== null && running ? (
                <span>预估剩余 ~{formatDuration(remainingMs)}</span>
              ) : null}
              {failed.length > 0 ? (
                <span className="text-danger">
                  {failed.length} 张失败
                </span>
              ) : null}
              {canceled.length > 0 ? (
                <span className="text-fg-tertiary">
                  {canceled.length} 张跳过
                </span>
              ) : null}
            </div>

            {/* 等待 quota 倒计时 */}
            {running && waiting && nextTokenReadyAtMs ? (
              <div className="mt-3 flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--warn-bg)] border border-amber-200">
                <div className="flex items-center gap-2 text-[12px] text-warn">
                  <Clock
                    size={13}
                    strokeWidth={2.2}
                    className="animate-pulse"
                  />
                  正在等待 Google quota 刷新…
                </div>
                <span className="text-[12px] font-mono text-warn tabular-nums">
                  下个 token {formatCountdown(nextTokenReadyAtMs + clockSkew - Date.now())}
                </span>
              </div>
            ) : null}

            {/* 正在生成哪张的提示 */}
            {running && processing ? (
              <div className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--brand-50-bg)] border border-[rgba(59,130,246,0.3)]">
                <span className="inline-block w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
                <span className="text-[12px] text-brand-400">
                  正在生成：<b>{processing.label}</b>
                </span>
              </div>
            ) : null}
          </Card>

          {/* 结果工具栏 */}
          {completed.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 px-1">
              <span className="text-sm font-medium text-fg-secondary">
                已完成 <span className="text-fg-tertiary">({completed.length})</span>
              </span>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={selectedIds.size === completed.length ? clearSelection : selectAll}
              >
                {selectedIds.size === completed.length ? "取消全选" : "全选"}
              </Button>
              {selectedIds.size > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Copy size={14} strokeWidth={2} />}
                  onClick={clearSelection}
                >
                  已选 {selectedIds.size} 张
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Download size={14} strokeWidth={2} />}
                loading={zipping}
                onClick={() => {
                  if (selectedIds.size > 0) {
                    downloadChosen(completed.filter((it) => selectedIds.has(it.id)));
                  } else {
                    downloadChosen(completed);
                  }
                }}
              >
                {zipping && zipProgress
                  ? `打包 ${zipProgress.done}/${zipProgress.total}`
                  : selectedIds.size > 0
                    ? `下载选中 ZIP`
                    : `下载全部 ZIP`}
              </Button>
            </div>
          ) : null}

          {/* 结果缩略图网格 */}
          {items.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {items.map((it) => {
                const isComp = it.status === "completed" && it.result_image_url;
                const isFail = it.status === "failed";
                const isProc = it.status === "processing";
                const isWait = it.status === "waiting_quota";
                const isQueued = it.status === "queued";
                const isSel = selectedIds.has(it.id);

                // Canceled 不渲染（用户约定）
                if (it.status === "canceled") return null;

                if (isComp) {
                  return (
                    <Thumbnail
                      key={it.id}
                      src={it.result_image_url!}
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
                          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-[10px] transition-colors ${
                            isSel
                              ? "bg-brand-600 border-transparent text-white"
                              : "bg-bg-elevated/90 border-white"
                          }`}
                        >
                          {isSel ? "✓" : ""}
                        </button>
                      }
                      hoverOverlay={
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadSingleImage(
                              it.result_image_url!,
                              resolveFilename(it),
                            );
                          }}
                          className="btn btn-secondary btn-sm"
                        >
                          <Download size={12} strokeWidth={2} />
                          下载
                        </button>
                      }
                    />
                  );
                }

                return (
                  <PlaceholderCard
                    key={it.id}
                    label={it.label || `#${it.idx + 1}`}
                    state={
                      isFail
                        ? "fail"
                        : isProc
                          ? "proc"
                          : isWait
                            ? "wait"
                            : isQueued
                              ? "queued"
                              : "queued"
                    }
                    error={it.error_message}
                  />
                );
              })}
            </div>
          ) : (
            <div className="p-10 text-center text-sm text-fg-tertiary bg-bg-secondary rounded-xl border border-dashed border-border-subtle">
              暂无任务项
            </div>
          )}

          {/* 结束总结 */}
          {terminal ? (
            <Card padding="md" className="text-center">
              <div className="inline-flex items-center gap-2 text-sm text-fg-secondary">
                {job.status === "completed" ? (
                  <>
                    <CheckCircle2 size={16} className="text-green-500" />
                    任务完成
                  </>
                ) : job.status === "canceled" ? (
                  <>
                    <CircleOff size={16} className="text-fg-tertiary" />
                    任务已停止
                  </>
                ) : (
                  <>
                    <AlertOctagon size={16} className="text-red-500" />
                    任务失败
                  </>
                )}
                <span className="text-fg-tertiary">·</span>
                <span className="text-fg-tertiary">
                  完成 {job.completed_count} · 失败 {job.failed_count} ·
                  跳过 {job.canceled_count}
                </span>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ═════════════ 内部 ═════════════ */

function StatusChip({ status }: { status: PolledJob["status"] }) {
  const map: Record<
    PolledJob["status"],
    { tone: "brand" | "success" | "warn" | "danger" | "gray"; label: string; dot?: boolean }
  > = {
    running: { tone: "brand", label: "进行中", dot: true },
    canceling: { tone: "warn", label: "取消中…", dot: true },
    canceled: { tone: "gray", label: "已停止" },
    completed: { tone: "success", label: "已完成" },
    failed: { tone: "danger", label: "失败" },
  };
  const c = map[status] || map.running;
  return (
    <Chip
      tone={c.tone}
      icon={
        c.dot ? (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
        ) : null
      }
    >
      {c.label}
    </Chip>
  );
}

function PlaceholderCard({
  label,
  state,
  error,
}: {
  label: string;
  state: "queued" | "wait" | "proc" | "fail";
  error?: string | null;
}) {
  const cfg = {
    queued: {
      border: "border-border-subtle",
      bg: "bg-bg-tertiary",
      dotColor: "bg-fg-muted",
      text: "text-fg-tertiary",
      label: "排队中",
    },
    wait: {
      border: "border-amber-200",
      bg: "bg-[var(--warn-bg)]",
      dotColor: "bg-amber-400 animate-pulse",
      text: "text-warn",
      label: "等 quota",
    },
    proc: {
      border: "border-[rgba(59,130,246,0.4)]",
      bg: "bg-[var(--brand-50-bg)]",
      dotColor: "bg-brand-500 animate-pulse",
      text: "text-brand-400",
      label: "生成中",
    },
    fail: {
      border: "border-red-300",
      bg: "bg-[var(--danger-bg)]",
      dotColor: "bg-red-500",
      text: "text-danger",
      label: "失败",
    },
  }[state];
  return (
    <div
      className={`relative aspect-[3/4] rounded-lg border ${cfg.border} ${cfg.bg} flex flex-col items-center justify-center gap-1.5 p-2 overflow-hidden`}
      title={error || undefined}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${cfg.dotColor}`} />
      <span className={`text-[11px] font-medium ${cfg.text}`}>{cfg.label}</span>
      <span className="text-[10px] text-fg-tertiary text-center truncate max-w-full px-2">
        {label}
      </span>
      {error ? (
        <span className="text-[9px] text-red-500 text-center line-clamp-2 px-2 mt-0.5">
          {error}
        </span>
      ) : null}
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
  return `${s}s`;
}
