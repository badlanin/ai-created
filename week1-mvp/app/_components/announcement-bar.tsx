"use client";

import { useEffect, useState } from "react";
import { Info, AlertTriangle, AlertOctagon, CheckCircle2, X } from "lucide-react";

interface Announcement {
  id: number;
  content: string;
  tone: "info" | "success" | "warn" | "danger";
  dismissible: number; // 0/1
}

/**
 * 顶部公告栏 —— 固定贴 body 顶部，AppShell 在其下方
 *
 * 规则：
 *   - 拉 /api/announcements 拿当前活跃公告（可能多条，取第一条显示）
 *   - 用户可关闭（如果 dismissible=1），关闭后本会话 sessionStorage 里记录 id 不再显示
 *   - 多条公告：切换显示（用户关第 1 条后显示第 2 条）
 */
export function AnnouncementBar() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());

  // 读 sessionStorage 已关闭的
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("dismissed_announcements");
      if (raw) setDismissedIds(new Set(JSON.parse(raw)));
    } catch {}
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/announcements")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (alive && Array.isArray(d.items)) setItems(d.items);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const visible = items.find((it) => !dismissedIds.has(it.id));
  if (!visible) return null;

  // 深色主题：用语义色 + 半透明背景 + 同色描边
  const toneStyle = {
    info: {
      bg: "border-b border-[rgba(59,130,246,0.3)]",
      bgStyle: { background: "var(--brand-50-bg)" } as React.CSSProperties,
      text: "text-brand-400",
      icon: <Info size={14} className="text-brand-400" strokeWidth={2.2} />,
    },
    success: {
      bg: "border-b border-[rgba(16,185,129,0.3)]",
      bgStyle: { background: "var(--success-bg)" } as React.CSSProperties,
      text: "text-success",
      icon: <CheckCircle2 size={14} className="text-success" strokeWidth={2.2} />,
    },
    warn: {
      bg: "border-b border-[rgba(245,158,11,0.3)]",
      bgStyle: { background: "var(--warn-bg)" } as React.CSSProperties,
      text: "text-warn",
      icon: <AlertTriangle size={14} className="text-warn" strokeWidth={2.2} />,
    },
    danger: {
      bg: "border-b border-[rgba(239,68,68,0.3)]",
      bgStyle: { background: "var(--danger-bg)" } as React.CSSProperties,
      text: "text-danger",
      icon: <AlertOctagon size={14} className="text-danger" strokeWidth={2.2} />,
    },
  }[visible.tone] || {
    bg: "border-b border-[rgba(59,130,246,0.3)]",
    bgStyle: { background: "var(--brand-50-bg)" } as React.CSSProperties,
    text: "text-brand-400",
    icon: <Info size={14} className="text-brand-400" strokeWidth={2.2} />,
  };

  function dismiss() {
    const next = new Set(dismissedIds);
    next.add(visible!.id);
    setDismissedIds(next);
    try {
      sessionStorage.setItem(
        "dismissed_announcements",
        JSON.stringify([...next]),
      );
    } catch {}
  }

  return (
    <div
      role="status"
      className={`relative w-full ${toneStyle.bg} ${toneStyle.text}`}
      style={{ zIndex: 40, ...toneStyle.bgStyle }}
    >
      <div className="px-4 py-2 pr-10 flex items-start gap-2 text-[13px] leading-relaxed">
        <span className="mt-0.5 shrink-0">{toneStyle.icon}</span>
        <span className="whitespace-pre-wrap break-words flex-1">
          {visible.content}
        </span>
      </div>
      {visible.dismissible === 1 ? (
        <button
          type="button"
          onClick={dismiss}
          aria-label="关闭公告"
          className="absolute right-2 top-1.5 w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 text-current opacity-70 hover:opacity-100"
        >
          <X size={14} strokeWidth={2.2} />
        </button>
      ) : null}
    </div>
  );
}
