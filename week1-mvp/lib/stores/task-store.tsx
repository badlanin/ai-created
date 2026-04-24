"use client";

import {
  createContext,
  useCallback,
  useContext,
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
 *
 * 架构：
 *   - 两个独立 slot：recolor 和 batchPhoto，互不干扰
 *   - 每个 slot 的 state 完全由调用方 typed，这里只提供通用存取
 *   - 支持 reset(slot) 清某个 slot
 * ─────────────────────────────────────────────
 */

export type FeatureSlot = "recolor" | "batchPhoto";

/**
 * 每个 slot 的状态类型。后续 recolor/batch-photo 页会扩展这些字段。
 * 用 unknown 包裹，调用方自己 cast —— 避免这里和业务耦合。
 */
export interface SlotState {
  /** 业务数据，由调用方自由填写 */
  data: Record<string, unknown>;
  /** 当前活跃 job_id（批次 B 会写入，用于轮询） */
  activeJobId: string | null;
  /** 上次更新时间（用于调试） */
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
  /** 读某个字段 */
  get: <T = unknown>(slot: FeatureSlot, key: string) => T | undefined;
  /** 写某个字段（合并进 data） */
  set: <T = unknown>(slot: FeatureSlot, key: string, value: T) => void;
  /** 批量合并（浅合并） */
  merge: (slot: FeatureSlot, partial: Record<string, unknown>) => void;
  /** 读取整个 slot 的 data 对象（注意引用稳定：同一 slot 未变时返回同一引用） */
  snapshot: (slot: FeatureSlot) => SlotState;
  /** 设置当前活跃 job_id */
  setActiveJob: (slot: FeatureSlot, jobId: string | null) => void;
  /** 清空某个 slot */
  reset: (slot: FeatureSlot) => void;
  /** 清空全部 */
  resetAll: () => void;
}

const Ctx = createContext<TaskStoreCtx | null>(null);

export function TaskStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [slots, setSlots] = useState<Record<FeatureSlot, SlotState>>({
    recolor: emptySlot(),
    batchPhoto: emptySlot(),
  });

  const get = useCallback(
    <T,>(slot: FeatureSlot, key: string): T | undefined => {
      return slots[slot].data[key] as T | undefined;
    },
    [slots],
  );

  const set = useCallback(
    <T,>(slot: FeatureSlot, key: string, value: T) => {
      setSlots((prev) => ({
        ...prev,
        [slot]: {
          ...prev[slot],
          data: { ...prev[slot].data, [key]: value },
          updatedAt: Date.now(),
        },
      }));
    },
    [],
  );

  const merge = useCallback(
    (slot: FeatureSlot, partial: Record<string, unknown>) => {
      setSlots((prev) => ({
        ...prev,
        [slot]: {
          ...prev[slot],
          data: { ...prev[slot].data, ...partial },
          updatedAt: Date.now(),
        },
      }));
    },
    [],
  );

  const snapshot = useCallback(
    (slot: FeatureSlot) => slots[slot],
    [slots],
  );

  const setActiveJob = useCallback((slot: FeatureSlot, jobId: string | null) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: {
        ...prev[slot],
        activeJobId: jobId,
        updatedAt: Date.now(),
      },
    }));
  }, []);

  const reset = useCallback((slot: FeatureSlot) => {
    setSlots((prev) => ({ ...prev, [slot]: emptySlot() }));
  }, []);

  const resetAll = useCallback(() => {
    setSlots({ recolor: emptySlot(), batchPhoto: emptySlot() });
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
 * 单 slot 视图钩子。一个页面只关心自己的 slot。
 *
 * @example
 *   const store = useSlotStore("recolor");
 *   const files = store.get<File[]>("files");
 *   store.set("files", newFiles);
 *   store.reset();
 */
export function useSlotStore(slot: FeatureSlot) {
  const store = useTaskStore();
  return useMemo(
    () => ({
      get: <T,>(key: string) => store.get<T>(slot, key),
      set: <T,>(key: string, value: T) => store.set(slot, key, value),
      merge: (partial: Record<string, unknown>) => store.merge(slot, partial),
      snapshot: () => store.snapshot(slot),
      setActiveJob: (jobId: string | null) => store.setActiveJob(slot, jobId),
      reset: () => store.reset(slot),
    }),
    [slot, store],
  );
}
