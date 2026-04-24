"use client";

import { forwardRef, useState } from "react";

export interface ThumbnailProps {
  src: string;
  alt?: string;
  /**
   * 容器宽高比。默认 3:4（我们的标配）。
   * 传字符串格式，会变成 Tailwind 的 aspect-ratio 类：
   *   "3/4"   → aspect-[3/4]
   *   "1/1"   → aspect-[1/1]
   *   "16/9"  → aspect-[16/9]
   */
  ratio?: string;
  /**
   * 图片填充方式。默认 contain（letterbox，不裁不拉）。
   */
  fit?: "contain" | "cover";
  /** 额外的根 className */
  className?: string;
  /** 右上角角标（比如 "已裁" / "已选"） */
  badge?: React.ReactNode;
  /** 左上角复选框 */
  checkbox?: React.ReactNode;
  /** 悬浮层（hover 时出现，比如删除/裁剪按钮） */
  hoverOverlay?: React.ReactNode;
  /** 点击事件 */
  onClick?: () => void;
  /** 是否被选中（会加蓝色边框） */
  selected?: boolean;
  /**
   * 错误占位图 URL。图片加载失败时展示。
   * 默认显示一个灰色占位。
   */
  fallback?: string;
}

/**
 * 通用缩略图组件
 *
 * - 固定 3:4 纵向容器 + object-contain（letterbox）
 * - 浅灰底色，图片比例不足时留白而非拉伸
 * - 支持角标、复选框、悬浮操作层
 *
 * 全站统一用这个组件，保证所有缩略图尺寸风格一致。
 */
export const Thumbnail = forwardRef<HTMLDivElement, ThumbnailProps>(
  function Thumbnail(
    {
      src,
      alt = "",
      ratio = "3/4",
      fit = "contain",
      className = "",
      badge,
      checkbox,
      hoverOverlay,
      onClick,
      selected = false,
      fallback,
    },
    ref,
  ) {
    const [errored, setErrored] = useState(false);
    const displaySrc = errored && fallback ? fallback : src;

    return (
      <div
        ref={ref}
        onClick={onClick}
        className={[
          "relative overflow-hidden rounded-md bg-gray-100 group",
          onClick ? "cursor-pointer" : "",
          selected ? "ring-2 ring-blue-500 ring-offset-1" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ aspectRatio: ratio.replace("/", " / ") }}
      >
        {/* 图片本体 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displaySrc}
          alt={alt}
          onError={() => setErrored(true)}
          className={`w-full h-full ${
            fit === "cover" ? "object-cover" : "object-contain"
          }`}
          draggable={false}
        />

        {/* 错误占位 */}
        {errored && !fallback ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 bg-gray-100">
            加载失败
          </div>
        ) : null}

        {/* 左上角复选框 */}
        {checkbox ? (
          <div className="absolute top-1 left-1 z-10">{checkbox}</div>
        ) : null}

        {/* 右上角角标 */}
        {badge ? (
          <div className="absolute top-1 right-1 z-10">{badge}</div>
        ) : null}

        {/* hover 悬浮层 */}
        {hoverOverlay ? (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            {hoverOverlay}
          </div>
        ) : null}
      </div>
    );
  },
);

/**
 * 轻量角标，用于 Thumbnail 的 badge 位
 */
export function ThumbnailBadge({
  children,
  tone = "blue",
}: {
  children: React.ReactNode;
  tone?: "blue" | "green" | "amber" | "gray" | "red";
}) {
  const toneClass = {
    blue: "bg-blue-600 text-white",
    green: "bg-green-600 text-white",
    amber: "bg-amber-500 text-white",
    gray: "bg-gray-700 text-white",
    red: "bg-red-600 text-white",
  }[tone];
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${toneClass}`}
    >
      {children}
    </span>
  );
}
