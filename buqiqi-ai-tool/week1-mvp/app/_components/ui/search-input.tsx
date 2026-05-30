"use client";

import { Search, X } from "lucide-react";
import { InputHTMLAttributes, forwardRef } from "react";

/**
 * 带搜索图标的输入框
 *
 * 用法：
 *   <SearchInput placeholder="搜索颜色..." value={q} onChange={(e) => setQ(e.target.value)} />
 *   <SearchInput onClear={() => setQ("")} value={q} ... />
 */

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** 显示清除按钮，点击时调用 */
  onClear?: () => void;
  size?: "sm" | "md";
  rounded?: boolean;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      onClear,
      size = "md",
      rounded = false,
      className = "",
      value,
      ...rest
    },
    ref,
  ) {
    const heightClass = size === "sm" ? "h-8 text-[12px]" : "h-9 text-[13px]";
    const radiusClass = rounded ? "rounded-full" : "rounded-md";
    const showClear = onClear && typeof value === "string" && value.length > 0;

    return (
      <div className={`relative inline-flex w-full ${className}`}>
        <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-fg-tertiary">
          <Search size={14} strokeWidth={2} />
        </span>
        <input
          ref={ref}
          type="text"
          value={value}
          {...rest}
          className={`input ${heightClass} ${radiusClass} pl-9 ${
            showClear ? "pr-8" : "pr-3"
          }`}
        />
        {showClear ? (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-bg-elevated text-fg-tertiary hover:text-fg-primary hover:bg-bg-hover flex items-center justify-center"
            aria-label="清除"
          >
            <X size={12} strokeWidth={2.2} />
          </button>
        ) : null}
      </div>
    );
  },
);
