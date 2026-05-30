"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * 任务状态留存
 *
 * ─────────────────────────────────────────────
 * 设计目标：
 *   - 用户切换页面（SPA 路由）时，已上传图片 / 解析结果 /
 *     正在进行的任务 / 已选预设都保留
 *   - 用户 F5 刷新时，整个 React 运行时重载，状态自动归零
 *   - 不用 localStorage（Blob URL 不能序列化，且刷新要清零）
 *   - 支持多 tab 模式：每个 tab 独立 slot（key 是动态字符串）
 *
 * 架构：
 *   - slot key 是动态 string（如 "recolor"、"batchPhoto:tab-xxx"）
 *   - 第一次写时按需创建 slot；reset(slot) 清掉
 *   - useTabs(feature) 提供"多 tab"管理（增删切）
 * ─────────────────────────────────────────────
 */

/** Slot key 是任意 string；典型形态 "recolor"、"batchPhoto:tab-1" */
export type FeatureSlot = string;

export interface SlotState {
  /** 业务数据，由调用方自由填写 */
  data: Record<string, unknown>;
  /** 当前活跃 job_id */
  activeJobId: string | null;
  /** 上次更新时间 */
  updatedAt: number;
}

function emptySlot(): SlotState {
  return {
    data: {},
    activeJobId: null,
    updatedAt: Date.now(),
  };
}

interface TaskStoreCtx {
  get: <T = unknown>(slot: FeatureSlot, key: string) => T | undefined;
  set: <T = unknown>(slot: FeatureSlot, key: string, value: T) => void;
  merge: (slot: FeatureSlot, partial: Record<string, unknown>) => void;
  snapshot: (slot: FeatureSlot) => SlotState;
  setActiveJob: (slot: FeatureSlot, jobId: string | null) => void;
  reset: (slot: FeatureSlot) => void;
  resetAll: () => void;
}

const Ctx = createContext<TaskStoreCtx | null>(null);

export function TaskStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [slots, setSlots] = useState<Record<string, SlotState>>({});

  const get = useCallback(
    <T,>(slot: FeatureSlot, key: string): T | undefined => {
      return slots[slot]?.data[key] as T | undefined;
    },
    [slots],
  );

  const set = useCallback(<T,>(slot: FeatureSlot, key: string, value: T) => {
    setSlots((prev) => {
      const cur = prev[slot] ?? emptySlot();
      return {
        ...prev,
        [slot]: {
          ...cur,
          data: { ...cur.data, [key]: value },
          updatedAt: Date.now(),
        },
      };
    });
  }, []);

  const merge = useCallback(
    (slot: FeatureSlot, partial: Record<string, unknown>) => {
      setSlots((prev) => {
        const cur = prev[slot] ?? emptySlot();
        return {
          ...prev,
          [slot]: {
            ...cur,
            data: { ...cur.data, ...partial },
            updatedAt: Date.now(),
          },
        };
      });
    },
    [],
  );

  const snapshot = useCallback(
    (slot: FeatureSlot) => slots[slot] ?? emptySlot(),
    [slots],
  );

  const setActiveJob = useCallback(
    (slot: FeatureSlot, jobId: string | null) => {
      setSlots((prev) => {
        const cur = prev[slot] ?? emptySlot();
        return {
          ...prev,
          [slot]: {
            ...cur,
            activeJobId: jobId,
            updatedAt: Date.now(),
          },
        };
      });
    },
    [],
  );

  const reset = useCallback((slot: FeatureSlot) => {
    setSlots((prev) => {
      if (!(slot in prev)) return prev;
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    setSlots({});
  }, []);

  const value = useMemo<TaskStoreCtx>(
    () => ({ get, set, merge, snapshot, setActiveJob, reset, resetAll }),
    [get, set, merge, snapshot, setActiveJob, reset, resetAll],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTaskStore(): TaskStoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useTaskStore 必须在 <TaskStoreProvider> 内使用");
  }
  return ctx;
}

/**
 * 单 slot 视图钩子。一个组件只关心自己的 slot。
 */
export function useSlotStore(slot: FeatureSlot) {
  const store = useTaskStore();
  return useMemo(
    () => ({
      get: <T,>(key: string) => store.get<T>(slot, key),
      set: <T,>(key: string, value: T) => store.set(slot, key, value),
      merge: (partial: Record<string, unknown>) => store.merge(slot, partial),
      snapshot: () => store.snapshot(slot),
      setActiveJob: (jobId: string | null) =>
        store.setActiveJob(slot, jobId),
      reset: () => store.reset(slot),
    }),
    [slot, store],
  );
}

/* ═════════════ 多 tab 管理 ═════════════ */

/**
 * 多 tab feature 的元数据 slot key 命名约定：
 *   "{feature}:_meta"
 * 存的内容：{ tabIds: string[], activeTabId: string | null }
 *
 * 各 tab 数据存在：
 *   "{feature}:{tabId}"
 */

export interface TabsApi {
  /** tab id 列表，按打开顺序 */
  tabIds: string[];
  /** 当前激活的 tab id */
  activeTabId: string | null;
  /** 上限（多少个 tab 之内允许新建）*/
  maxTabs: number;
  /** 是否到达上限 */
  atLimit: boolean;
  /** 新建 tab，自动激活；返回新 tab id；超限时 null */
  addTab: () => string | null;
  /** 关闭某 tab，自动清掉它的数据 slot；当激活 tab 被关时切到下一个 */
  closeTab: (tabId: string) => void;
  /** 切换激活 tab */
  setActiveTabId: (tabId: string) => void;
}

/**
 * 多 tab feature 状态钩子
 *
 * @example
 *   const tabs = useTabs("batchPhoto");
 *   tabs.addTab();        // 新建 tab
 *   tabs.closeTab(id);    // 关闭
 *   tabs.setActiveTabId(id); // 切换
 *
 * Tab 内部组件用 useSlotStore(`batchPhoto:${tabId}`) 访问该 tab 的数据。
 */
export function useTabs(feature: string, maxTabs = 5): TabsApi {
  const store = useTaskStore();
  const metaSlot = `${feature}:_meta`;

  // 触发一次重渲染的 hook：snapshot 引用变化时 re-render
  // 我们直接读 store 的 meta data；snapshot() 返回引用稳定的 slot state，
  // 当 store 的 useState 触发更新时这个 hook 会随 context 重渲染。
  const snapshot = store.snapshot(metaSlot);
  const tabIds: string[] = (snapshot.data.tabIds as string[]) ?? [];
  const activeTabId = (snapshot.data.activeTabId as string) ?? null;

  const addTab = useCallback((): string | null => {
    if (tabIds.length >= maxTabs) return null;
    const newId = `tab-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const next = [...tabIds, newId];
    store.merge(metaSlot, {
      tabIds: next,
      activeTabId: newId,
    });
    return newId;
  }, [tabIds, maxTabs, store, metaSlot]);

  const closeTab = useCallback(
    (tabId: string) => {
      // 清这个 tab 自己的数据 slot
      store.reset(`${feature}:${tabId}`);
      const next = tabIds.filter((t) => t !== tabId);
      const newActive =
        activeTabId === tabId ? (next[0] ?? null) : activeTabId;
      store.merge(metaSlot, {
        tabIds: next,
        activeTabId: newActive,
      });
    },
    [tabIds, activeTabId, store, feature, metaSlot],
  );

  const setActiveTabId = useCallback(
    (tabId: string) => {
      store.set(metaSlot, "activeTabId", tabId);
    },
    [store, metaSlot],
  );

  return {
    tabIds,
    activeTabId,
    maxTabs,
    atLimit: tabIds.length >= maxTabs,
    addTab,
    closeTab,
    setActiveTabId,
  };
}

/**
 * 自动确保第一次访问时有至少一个 tab。
 * 在用 useTabs 的页面顶层调用一次。
 */
export function useEnsureFirstTab(feature: string): string | null {
  const tabs = useTabs(feature);
  useEffect(() => {
    if (tabs.tabIds.length === 0) {
      tabs.addTab();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.tabIds.length === 0]);
  return tabs.activeTabId;
}
