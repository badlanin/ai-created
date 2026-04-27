"use client";

import { forwardRef, useState } from "react";
import { getThumbUrl } from "@/lib/thumb-url";

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
  /**
   * 是否使用服务端 webp 缩略图（默认 true）
   *
   * - true（默认）：自动转成 /api/thumb?path=...&w=400 走压缩缩略图，
   *   省 25 倍带宽。仅对 /assets/* URL 生效，blob/data URL 自动跳过。
   * - false：原图加载（用于需要全画质的场景，如点开看大图）
   */
  useThumb?: boolean;
  /**
   * 缩略图请求宽度（仅 useThumb=true 时生效）。默认 400 像素。
   * 视显示区域大小调整：缩略图网格 = 400，列表行 = 200，icon = 100
   */
  thumbWidth?: number;
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
      useThumb = true,
      thumbWidth = 400,
    },
    ref,
  ) {
    // 三态加载：缩略图 → 原图（缩略图失败时回退）→ fallback（原图也失败时）
    const [thumbErrored, setThumbErrored] = useState(false);
    const [errored, setErrored] = useState(false);

    // 决定本次实际加载的 URL
    const displaySrc = (() => {
      if (errored && fallback) return fallback;
      if (errored) return src; // 即使 errored，也保留尝试，让浏览器显示破图标
      if (useThumb && !thumbErrored) {
        const thumbUrl = getThumbUrl(src, thumbWidth);
        // 如果转换后跟原 URL 一样（说明本身不是 /assets/* 路径），直接用原 URL
        return thumbUrl !== src ? thumbUrl : src;
      }
      return src;
    })();

    function handleError() {
      // 缩略图失败 → 退回原图
      if (useThumb && !thumbErrored && displaySrc !== src) {
        setThumbErrored(true);
      } else if (!errored) {
        setErrored(true);
      }
    }

    return (
      <div
        ref={ref}
        onClick={onClick}
        className={[
          "relative overflow-hidden rounded-md bg-bg-tertiary border border-border-subtle group transition-colors",
          onClick ? "cursor-pointer hover:border-border-default" : "",
          selected
            ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-bg-primary border-transparent"
            : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ aspectRatio: ratio.replace("/", " / ") }}
      >
        {/* 图片本体 —— 启用浏览器 lazy load + 异步解码，进一步降低首屏压力 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displaySrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={handleError}
          className={`w-full h-full ${
            fit === "cover" ? "object-cover" : "object-contain"
          }`}
          draggable={false}
        />

        {/* 错误占位 */}
        {errored && !fallback ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-fg-tertiary bg-bg-tertiary">
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
  // 深色主题：保持高对比，所有 tone 都用同色填充 + 白字
  const toneClass = {
    blue: "text-white",
    green: "text-white",
    amber: "text-white",
    gray: "text-white",
    red: "text-white",
  }[tone];
  const bgStyle: React.CSSProperties = {
    background: {
      blue: "var(--brand-600)",
      green: "var(--success)",
      amber: "var(--warn)",
      gray: "rgba(0, 0, 0, 0.7)",
      red: "var(--danger)",
    }[tone],
  };
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${toneClass}`}
      style={bgStyle}
    >
      {children}
    </span>
  );
}
