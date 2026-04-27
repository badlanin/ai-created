"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { LeftNav, type LeftNavProps } from "./left-nav";
import { useIsNarrowScreen } from "@/lib/hooks/use-breakpoint";

export interface AppShellProps {
  /** 左栏 LeftNav 的 props（user 必填，其他可选） */
  leftNav: LeftNavProps;
  /** 中栏内容（主操作区） */
  children: React.ReactNode;
  /**
   * 右栏内容。传 undefined 则只有两栏（比如 /history、/billing 这种列表页）。
   * 右栏内部建议自己套 sticky 定位。
   */
  rightPanel?: React.ReactNode;
  /** 右栏宽度。默认 360px */
  rightWidth?: number;
  /** 中栏最大宽度。默认 'auto' 即动态填充 */
  centerMaxWidth?: string;
  /** 中栏最小宽度 */
  centerMinWidth?: string;
  /** 中栏额外 className */
  centerClassName?: string;
  /** 是否启用全宽模式（忽略右栏宽度限制） */
  fullWidth?: boolean;
}

/**
 * 应用三栏骨架 - 动态布局版本
 *
 * 布局：
 *   [左栏 240px] [中栏 flex-1(min:600px, max:动态)] [右栏 360px]
 *
 * 动态宽度策略：
 *   - 左栏固定 240px
 *   - 右栏默认 360px（可配置）
 *   - 中栏自动填充剩余空间，最小 600px
 *   - 窗口过小时自动折叠左栏
 *
 * 响应式：
 *   - 屏幕 < 1280px：左栏默认折叠到 56px（仅图标）
 *   - 用户可手动点折叠/展开按钮
 *   - 右栏始终显示（要自己 sticky）
 *
 * 使用：
 *   pages 只需要写中栏 + 右栏内容，布局外壳由 shell 负责。
 */
export function AppShell({
  leftNav,
  children,
  rightPanel,
  rightWidth = 360,
  centerMaxWidth,
  centerMinWidth = "600px",
  centerClassName = "",
  fullWidth = false,
}: AppShellProps) {
  const narrow = useIsNarrowScreen();
  const [manuallyCollapsed, setManuallyCollapsed] = useState<boolean | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // 手动状态 > 窄屏自动折叠
  const collapsed =
    manuallyCollapsed !== null ? manuallyCollapsed : narrow;

  // 监听容器宽度变化
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [collapsed]);

  // 计算中栏动态宽度
  const leftNavWidth = collapsed ? 56 : 240;
  const rightPanelWidth = rightPanel ? rightWidth : 0;
  const calculatedMaxWidth = fullWidth 
    ? "100%" 
    : centerMaxWidth || `calc(100vw - ${leftNavWidth}px - ${rightPanelWidth}px)`;

  return (
    <div 
      ref={containerRef}
      className="flex h-full w-full overflow-hidden bg-[#0a0a0f]"
    >
      {/* 左栏 */}
      <LeftNav
        {...leftNav}
        collapsed={collapsed}
        onToggleCollapse={() => setManuallyCollapsed((v) => !(v ?? collapsed))}
      />

      {/* 中栏 - 动态宽度 */}
      <main
        className={`flex-1 overflow-y-auto ${centerClassName}`}
        style={{
          minWidth: centerMinWidth,
          maxWidth: calculatedMaxWidth,
        }}
      >
        {children}
      </main>

      {/* 右栏（可选）*/}
      {rightPanel ? (
        <aside
          className="border-l border-[#1e1e28] bg-[#0f0f14] overflow-y-auto flex-shrink-0"
          style={{ width: rightWidth }}
        >
          {rightPanel}
        </aside>
      ) : null}
    </div>
  );
}
