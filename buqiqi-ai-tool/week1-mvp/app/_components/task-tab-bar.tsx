"use client";

import { Plus, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useTaskStore, type TabsApi } from "@/lib/stores/task-store";

/**
 * 多任务 tab 栏 —— 顶部一排标签，每个标签代表一个独立的工作区
 *
 * 设计：
 *   - 标签显示"任务 N · 状态"，状态从对应 slot 的 activeJobId 推断
 *   - 当前 tab 高亮（蓝色 underline）
 *   - X 关闭（最后一个 tab 不能关）
 *   - + 新任务（达到上限时禁用）
 *
 * 用法：
 *   <TaskTabBar feature="batchPhoto" tabs={tabs} statusOf={(tabId) => "running"} />
 */

export interface TaskTabBarProps {
  /** 父级用来命名 slot 的 feature key（如 "batchPhoto"），用于读各 tab 的状态 */
  feature: string;
  tabs: TabsApi;
  /**
   * 自定义 tab 显示的状态文字 / icon。
   * 可选 —— 不传时仅显示"任务 N"。
   */
  statusOf?: (tabId: string) => "running" | "completed" | "failed" | "idle";
}

const STATUS_META: Record<
  "running" | "completed" | "failed" | "idle",
  { icon: typeof Loader2; color: string; tooltip: string }
> = {
  running: {
    icon: Loader2,
    color: "text-brand-400",
    tooltip: "任务进行中",
  },
  completed: {
    icon: CheckCircle2,
    color: "text-success",
    tooltip: "任务已完成",
  },
  failed: {
    icon: AlertCircle,
    color: "text-danger",
    tooltip: "任务失败",
  },
  idle: { icon: CheckCircle2, color: "text-fg-tertiary", tooltip: "" },
};

export function TaskTabBar({ feature, tabs, statusOf }: TaskTabBarProps) {
  const onlyOne = tabs.tabIds.length <= 1;

  return (
    <div className="flex items-center gap-1.5 px-1 py-2 border-b border-border-subtle bg-bg-secondary/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto">
        {tabs.tabIds.map((tabId, idx) => {
          const isActive = tabId === tabs.activeTabId;
          const status = statusOf?.(tabId) ?? "idle";
          const meta = STATUS_META[status];
          const StatusIcon = meta.icon;
          return (
            <div
              key={tabId}
              className={`group relative flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-md text-[12px] cursor-pointer select-none transition-colors min-w-[88px] ${
                isActive
                  ? "bg-bg-elevated border border-[rgba(59,130,246,0.4)] text-fg-primary"
                  : "border border-transparent text-fg-secondary hover:bg-bg-hover hover:text-fg-primary"
              }`}
              onClick={() => tabs.setActiveTabId(tabId)}
            >
              {status !== "idle" ? (
                <StatusIcon
                  size={11}
                  strokeWidth={2.2}
                  className={`${meta.color} ${
                    status === "running" ? "animate-spin" : ""
                  }`}
                />
              ) : (
                <span className="text-fg-tertiary text-[10px]">#</span>
              )}
              <span className="font-medium whitespace-nowrap">
                任务 {idx + 1}
              </span>
              {!onlyOne ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      confirm(
                        `关闭"任务 ${idx + 1}"？已上传的图、参数和未保存的状态会被清除。\n\n（已提交的任务在服务端继续运行，不受影响）`,
                      )
                    ) {
                      tabs.closeTab(tabId);
                    }
                  }}
                  className="ml-0.5 w-5 h-5 rounded hover:bg-[var(--danger-bg)] hover:text-danger text-fg-tertiary opacity-50 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                  title="关闭这个任务"
                  aria-label="关闭"
                >
                  <X size={10} strokeWidth={2.2} />
                </button>
              ) : null}
            </div>
          );
        })}

        {/* + 新任务 */}
        <button
          type="button"
          onClick={() => tabs.addTab()}
          disabled={tabs.atLimit}
          title={tabs.atLimit ? `最多 ${tabs.maxTabs} 个并行任务` : "添加新任务"}
          className="ml-1 px-2.5 py-1 rounded-md text-[12px] flex items-center gap-1 transition-colors text-fg-tertiary hover:text-brand-400 hover:bg-[var(--brand-50-bg)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-fg-tertiary"
        >
          <Plus size={12} strokeWidth={2.2} />
          新任务
          <span className="text-[10px] text-fg-muted ml-0.5">
            ({tabs.tabIds.length}/{tabs.maxTabs})
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * 给 tab 状态推断用：根据 slot 的 activeJobId 推 running/completed/idle。
 * 调用方负责传入合适的 polling 数据。
 */
export function inferTabStatus(args: {
  activeJobId: string | null;
  jobStatus?:
    | "queued"
    | "running"
    | "canceling"
    | "completed"
    | "failed"
    | "canceled"
    | null;
}): "running" | "completed" | "failed" | "idle" {
  if (!args.activeJobId) return "idle";
  if (
    args.jobStatus === "running" ||
    args.jobStatus === "queued" ||
    args.jobStatus === "canceling"
  )
    return "running";
  if (args.jobStatus === "completed") return "completed";
  if (args.jobStatus === "failed" || args.jobStatus === "canceled")
    return "failed";
  return "idle";
}

/**
 * 给 TaskTabBar 用的轻量版"该 tab 当前状态"读取器：
 * 直接从 task store 拿 activeJobId 是否存在，不要求 polling 数据
 */
export function useTabStatusFromStore(
  feature: string,
  tabId: string,
): "running" | "idle" {
  const store = useTaskStore();
  const slot = store.snapshot(`${feature}:${tabId}`);
  return slot.activeJobId ? "running" : "idle";
}
