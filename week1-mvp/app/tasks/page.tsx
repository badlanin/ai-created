"use client";

/**
 * 任务管理页 — 实时看所有正在跑 / 最近结束的任务进度
 *
 * 替代 left-nav 上"X 个任务进行中"原跳转的 /history?status=active 列表页。
 * 这里展示每个任务的实时进度条 + 缩略图流（不是 history 那种列表）。
 *
 * v1 简单版：
 *   - 拉 /api/jobs/active 列出全部进行中任务
 *   - 顶部 tab 按 feature 过滤（全部 / 批量摄影 / 服饰场景图 / 颜色批改 / 形象生成）
 *   - 每条任务一个进度卡片：feature + 模型 + 进度条 + 完成 / 总数 + 缩略图列 + 跳详情
 *
 * v2（未来 Task 7 后续迭代）：
 *   - 强停按钮（已有 cancelJob API）
 *   - 重试按钮
 *   - 修改参数（点击跳回功能页带预填 ?from=task&job_id=xxx）
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Camera, Layers, Palette, User, RefreshCw, Loader2 } from "lucide-react";
import { useJobPolling, cancelJob } from "@/lib/hooks/use-job-polling";

// /api/jobs/active 返回的实际嵌套结构（每条是 {job, completed, failed, ...}）
interface ActiveJobItem {
  job: {
    id: string;
    feature: string;
    model: string;
    status: string;
    total_count: number;
    completed_count: number;
    failed_count: number;
    created_at: number;
    started_at: number | null;
  };
  completed: number;
  failed: number;
  canceled: number;
  processing: number;
  queued: number;
}

type FeatureFilter = "all" | "batch_photo" | "scene_tools" | "recolor" | "other";

const FEATURE_META: Record<
  string,
  { label: string; icon: typeof Camera; href: string; tone: string }
> = {
  batch_photo: { label: "批量摄影", icon: Camera, href: "/batch-photo", tone: "text-brand-500" },
  scene_tools: { label: "服饰场景图", icon: Layers, href: "/scene-tools", tone: "text-purple-500" },
  recolor: { label: "颜色批改", icon: Palette, href: "/recolor", tone: "text-pink-500" },
  other: { label: "其他", icon: User, href: "/", tone: "text-fg-tertiary" },
};

export default function TasksPage() {
  const [items, setItems] = useState<ActiveJobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FeatureFilter>("all");
  const [refreshTick, setRefreshTick] = useState(0);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/jobs/active");
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const data = (await res.json()) as {
        count: number;
        jobs: ActiveJobItem[];
      };
      setItems(data.jobs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // 列表本身每 5 秒刷新一次，确保新提交的任务能出现
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load, refreshTick]);

  const filteredItems =
    filter === "all"
      ? items
      : items.filter((j) => j.job.feature === filter);

  const featureCounts = items.reduce(
    (acc, j) => {
      acc[j.job.feature] = (acc[j.job.feature] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const TABS: Array<{ value: FeatureFilter; label: string }> = [
    { value: "all", label: `全部（${items.length}）` },
    {
      value: "batch_photo",
      label: `批量摄影${featureCounts.batch_photo ? `（${featureCounts.batch_photo}）` : ""}`,
    },
    {
      value: "scene_tools",
      label: `服饰场景图${featureCounts.scene_tools ? `（${featureCounts.scene_tools}）` : ""}`,
    },
    {
      value: "recolor",
      label: `颜色批改${featureCounts.recolor ? `（${featureCounts.recolor}）` : ""}`,
    },
    {
      value: "other",
      label: `其他${featureCounts.other ? `（${featureCounts.other}）` : ""}`,
    },
  ];

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-fg-primary">任务管理</h1>
          <p className="text-[12px] text-fg-tertiary mt-0.5">
            实时查看正在进行的所有生图任务（按工具分类）。任务完成后会自动从这里移除。
          </p>
        </div>
        <button
          onClick={() => setRefreshTick((n) => n + 1)}
          className="btn btn-secondary btn-sm"
        >
          <RefreshCw size={12} />
          刷新
        </button>
      </header>

      {/* 顶部 feature tab */}
      <div className="mb-4 flex gap-1 p-1 bg-bg-tertiary border border-border-subtle rounded-md w-fit">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setFilter(t.value)}
            className={
              filter === t.value
                ? "px-3 py-1.5 text-xs rounded bg-brand-500 text-white font-medium"
                : "px-3 py-1.5 text-xs rounded text-fg-secondary hover:text-fg-primary"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="p-12 text-center text-fg-tertiary text-sm">
          <Loader2 size={20} className="inline-block animate-spin mb-2" />
          <br />
          加载中…
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border-default rounded">
          <div className="text-sm text-fg-tertiary mb-2">暂无{filter === "all" ? "" : "该类"}进行中的任务</div>
          <div className="text-[11px] text-fg-muted">
            可以去{" "}
            <Link href="/batch-photo" className="text-brand-400 hover:underline">
              批量摄影
            </Link>{" "}
            /{" "}
            <Link href="/scene-tools" className="text-brand-400 hover:underline">
              服饰场景图
            </Link>{" "}
            /{" "}
            <Link href="/recolor" className="text-brand-400 hover:underline">
              颜色批改
            </Link>{" "}
            提交新任务
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((it) => (
            <TaskCard key={it.job.id} item={it} onRefresh={load} />
          ))}
        </div>
      )}
    </main>
  );
}

/* ─────────── 单条任务卡片（轮询自己的进度） ─────────── */

function TaskCard({
  item,
  onRefresh,
}: {
  item: ActiveJobItem;
  onRefresh: () => void;
}) {
  const job = item.job;
  const polled = useJobPolling(job.id);
  const live = polled.data?.job ?? job;
  const items = polled.data?.items ?? [];
  const meta = FEATURE_META[job.feature] || FEATURE_META.other;
  const Icon = meta.icon;
  const [cancelling, setCancelling] = useState(false);

  const total = live.total_count || 1;
  const done = live.completed_count || 0;
  const failed = live.failed_count || 0;
  const percent = Math.min(100, Math.round(((done + failed) / total) * 100));

  const isActive = live.status === "running" || live.status === "queued";
  const isFinished = !isActive;

  const handleCancel = async () => {
    if (!confirm("确认取消这个任务？已生成的图片会保留，未生成的会标记为 canceled。")) {
      return;
    }
    setCancelling(true);
    try {
      await cancelJob(job.id);
      onRefresh();
    } catch (e) {
      alert("取消失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCancelling(false);
    }
  };

  // 完成的 item 缩略图（最多展示 6 张）
  const thumbs = items
    .filter((it) => it.result_image_url)
    .slice(0, 6);

  return (
    <div className="p-3 bg-bg-secondary border border-border-subtle rounded-lg">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <Icon size={16} className={meta.tone} />
          <div>
            <div className="text-sm font-medium text-fg-primary">{meta.label}</div>
            <div className="text-[11px] text-fg-tertiary">
              模型 {live.model} · {new Date(live.created_at * 1000).toLocaleString("zh-CN", { hour12: false })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/history?jobId=${job.id}`}
            className="text-[11px] text-brand-400 hover:underline"
          >
            查看详情 →
          </Link>
          {/* 再编辑：跳功能页 + 预填该 job 的参数，用户改完再跑（兼"重试"和"修改参数"两种用例） */}
          {meta.href && meta.href !== "/" && (
            <Link
              href={`${meta.href}?prefill_job=${job.id}`}
              className="text-[11px] text-brand-400 hover:underline"
              title="跳回功能页，把这个任务的参数预填回表单，可以改一改再跑"
            >
              再编辑
            </Link>
          )}
          {isActive && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="text-[11px] text-danger hover:underline"
              title="强制停止该任务"
            >
              {cancelling ? "取消中…" : "强制停止"}
            </button>
          )}
        </div>
      </div>

      {/* 进度条 */}
      <div className="relative h-2 bg-bg-tertiary rounded-full overflow-hidden mb-1.5">
        <div
          className="absolute inset-y-0 left-0 bg-brand-500 transition-all"
          style={{ width: `${percent}%` }}
        />
        {failed > 0 && (
          <div
            className="absolute inset-y-0 bg-danger"
            style={{
              left: `${Math.round((done / total) * 100)}%`,
              width: `${Math.round((failed / total) * 100)}%`,
            }}
          />
        )}
      </div>
      <div className="flex items-center justify-between text-[11px] text-fg-tertiary">
        <span>
          {done}/{total} 完成{failed > 0 ? ` · ${failed} 失败` : ""}
        </span>
        <span>{percent}%</span>
      </div>

      {/* 缩略图流（最多 6 张） */}
      {thumbs.length > 0 && (
        <div className="mt-2.5 flex gap-1.5 flex-wrap">
          {thumbs.map((it) => (
            <a
              key={it.id}
              href={it.result_image_url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-12 h-16 rounded overflow-hidden border border-border-subtle bg-bg-tertiary"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={it.result_image_url || ""}
                alt={it.label || ""}
                className="w-full h-full object-cover"
              />
            </a>
          ))}
          {items.filter((it) => it.result_image_url).length > 6 && (
            <div className="w-12 h-16 rounded border border-border-subtle bg-bg-tertiary flex items-center justify-center text-[10px] text-fg-tertiary">
              +{items.filter((it) => it.result_image_url).length - 6}
            </div>
          )}
        </div>
      )}

      {isFinished && (
        <div className="mt-2 text-[10px] text-fg-muted">
          状态：{live.status}（即将自动从该列表移除）
        </div>
      )}
    </div>
  );
}
