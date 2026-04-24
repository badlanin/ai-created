"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

export type NotificationTone = "error" | "warn" | "info" | "success";

export interface NotificationItem {
  id: string;
  tone: NotificationTone;
  /** 标题，1 行 */
  title: string;
  /** 补充说明，可多行 */
  detail?: string;
  /** 自动消失时间（毫秒）。设 0 或 undefined = 不自动消失（用户手动关） */
  ttl?: number;
  /** 创建时间戳 */
  createdAt: number;
}

interface NotificationCtx {
  items: NotificationItem[];
  push: (item: Omit<NotificationItem, "id" | "createdAt">) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const Ctx = createContext<NotificationCtx | null>(null);

/**
 * 把 <NotificationProvider> 放在最外层（通常在 layout.tsx 里），
 * 所有子组件都能通过 useNotifications() 推送通知。
 */
export function NotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback<NotificationCtx["push"]>(
    (draft) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const item: NotificationItem = {
        ...draft,
        id,
        createdAt: Date.now(),
      };
      setItems((prev) => [item, ...prev].slice(0, 8)); // 最多保留 8 条
      if (draft.ttl && draft.ttl > 0) {
        const t = setTimeout(() => dismiss(id), draft.ttl);
        timers.current.set(id, t);
      }
      return id;
    },
    [dismiss],
  );

  const clear = useCallback(() => {
    setItems([]);
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
  }, []);

  // 组件卸载时清定时器
  useEffect(() => {
    const currentTimers = timers.current;
    return () => {
      for (const t of currentTimers.values()) clearTimeout(t);
    };
  }, []);

  const value = useMemo<NotificationCtx>(
    () => ({ items, push, dismiss, clear }),
    [items, push, dismiss, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications(): NotificationCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "useNotifications 必须在 <NotificationProvider> 内使用",
    );
  }
  return ctx;
}

/**
 * 渲染通知堆栈。通常放在右栏顶部。
 */
export function NotificationStack({ className = "" }: { className?: string }) {
  const { items, dismiss } = useNotifications();

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={`space-y-2 ${className}`}
      role="region"
      aria-label="通知"
    >
      {items.map((item) => (
        <NotificationCard key={item.id} item={item} onClose={() => dismiss(item.id)} />
      ))}
    </div>
  );
}

function NotificationCard({
  item,
  onClose,
}: {
  item: NotificationItem;
  onClose: () => void;
}) {
  const { tone, title, detail } = item;
  const toneStyles: Record<
    NotificationTone,
    {
      bg: string;
      border: string;
      iconColor: string;
      icon: React.ReactNode;
    }
  > = {
    error: {
      bg: "bg-white",
      border: "border-red-200",
      iconColor: "text-red-500",
      icon: <AlertOctagon size={16} strokeWidth={2.2} />,
    },
    warn: {
      bg: "bg-white",
      border: "border-amber-200",
      iconColor: "text-amber-500",
      icon: <AlertTriangle size={16} strokeWidth={2.2} />,
    },
    info: {
      bg: "bg-white",
      border: "border-blue-200",
      iconColor: "text-blue-500",
      icon: <Info size={16} strokeWidth={2.2} />,
    },
    success: {
      bg: "bg-white",
      border: "border-green-200",
      iconColor: "text-green-500",
      icon: <CheckCircle2 size={16} strokeWidth={2.2} />,
    },
  };
  const s = toneStyles[tone];

  return (
    <div
      className={`relative rounded-xl border ${s.bg} ${s.border} px-3 py-2.5 pr-8 text-sm shadow-sm animate-[slideInRight_200ms_cubic-bezier(0.25,1,0.5,1)]`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 shrink-0 ${s.iconColor}`}
          aria-hidden
        >
          {s.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-900 leading-tight text-[13px]">
            {title}
          </div>
          {detail ? (
            <div className="mt-1 text-[12px] text-gray-600 leading-relaxed whitespace-pre-wrap break-words">
              {detail}
            </div>
          ) : null}
        </div>
      </div>
      <button
        onClick={onClose}
        aria-label="关闭"
        className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
      >
        <X size={12} strokeWidth={2.2} />
      </button>
      <style jsx global>{`
        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(12px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}

/**
 * 给常用场景的快捷函数（非必需，但能减少重复代码）
 */
export const notifyHelpers = {
  error: (
    push: NotificationCtx["push"],
    title: string,
    detail?: string,
  ): string =>
    push({ tone: "error", title, detail, ttl: 0 /* 错误默认不自动消 */ }),
  warn: (
    push: NotificationCtx["push"],
    title: string,
    detail?: string,
  ): string => push({ tone: "warn", title, detail, ttl: 8000 }),
  info: (
    push: NotificationCtx["push"],
    title: string,
    detail?: string,
  ): string => push({ tone: "info", title, detail, ttl: 5000 }),
  success: (
    push: NotificationCtx["push"],
    title: string,
    detail?: string,
  ): string => push({ tone: "success", title, detail, ttl: 4000 }),
};
