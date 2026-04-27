"use client";

import { ChevronDown } from "lucide-react";
import { ReactNode, useState } from "react";

/**
 * 可折叠分组（受控 / 非受控两用）
 *
 * 用途：
 *   - 颜色预设、模特预设、场景预设按分类折叠
 *   - 任何"信息密度太高"的 section 加折叠
 *
 * 用法（非受控）：
 *   <CollapsibleSection title="婚礼场景" badge={12} defaultOpen>
 *     <div className="grid grid-cols-4 gap-3">...</div>
 *   </CollapsibleSection>
 *
 * 用法（受控）：
 *   const [open, setOpen] = useState(true);
 *   <CollapsibleSection title="..." open={open} onOpenChange={setOpen}>...</CollapsibleSection>
 */

export interface CollapsibleSectionProps {
  title: ReactNode;
  /** 标题旁的小数字徽章（如条数）*/
  badge?: number | string;
  /** 副标题/描述（在标题下方一行）*/
  description?: ReactNode;
  /** 头部右侧自定义内容（搜索框、过滤、操作按钮等） */
  headerExtra?: ReactNode;
  /** 默认是否展开（非受控）*/
  defaultOpen?: boolean;
  /** 受控：当前是否展开 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 头部样式：default 圆角卡片头 / minimal 仅一行文字 */
  variant?: "default" | "minimal";
  /** 隐藏 chevron（用于始终展开但需要分组语义的场景）*/
  hideChevron?: boolean;
  children: ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  badge,
  description,
  headerExtra,
  defaultOpen = true,
  open,
  onOpenChange,
  variant = "default",
  hideChevron = false,
  children,
  className = "",
}: CollapsibleSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  function toggle() {
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  if (variant === "minimal") {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={toggle}
          className="w-full flex items-center gap-2 py-2 text-left group"
          aria-expanded={isOpen}
        >
          {!hideChevron ? (
            <ChevronDown
              size={14}
              strokeWidth={2.2}
              className={`text-fg-tertiary transition-transform duration-base ${isOpen ? "" : "-rotate-90"}`}
            />
          ) : null}
          <span className="text-[13px] font-medium text-fg-primary group-hover:text-white">
            {title}
          </span>
          {badge !== undefined ? (
            <span className="ml-1 chip chip-gray">{badge}</span>
          ) : null}
          {headerExtra ? (
            <span
              className="ml-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {headerExtra}
            </span>
          ) : null}
        </button>
        {isOpen ? <div className="pt-1 pb-3">{children}</div> : null}
      </div>
    );
  }

  return (
    <section
      className={`rounded-lg border border-border-subtle bg-bg-card overflow-hidden ${className}`}
    >
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-bg-hover transition-colors"
        aria-expanded={isOpen}
      >
        {!hideChevron ? (
          <ChevronDown
            size={16}
            strokeWidth={2}
            className={`text-fg-tertiary transition-transform duration-base ${isOpen ? "" : "-rotate-90"}`}
          />
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-fg-primary">
              {title}
            </span>
            {badge !== undefined ? (
              <span className="chip chip-gray">{badge}</span>
            ) : null}
          </div>
          {description ? (
            <div className="text-[12px] text-fg-tertiary mt-0.5">
              {description}
            </div>
          ) : null}
        </div>
        {headerExtra ? (
          <div onClick={(e) => e.stopPropagation()}>{headerExtra}</div>
        ) : null}
      </button>
      {isOpen ? (
        <div className="px-5 pb-5 pt-1 border-t border-border-subtle animate-fade-in">
          {children}
        </div>
      ) : null}
    </section>
  );
}
