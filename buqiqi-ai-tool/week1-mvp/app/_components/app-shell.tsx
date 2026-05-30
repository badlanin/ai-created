"use client";

import { useEffect, useState } from "react";
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
  /** 右栏宽度。默认 380px */
  rightWidth?: number;
  /** 中栏最大宽度。默认不限 */
  centerMaxWidth?: string;
  /** 中栏额外 className */
  centerClassName?: string;
}

/**
 * 应用三栏骨架（深色主题版）
 *
 * 布局：
 *   [左栏 240px] [中栏 flex-1] [右栏 380px / 可选]
 *
 * 响应式：
 *   - 屏幕 < 1280px：左栏自动折叠到 56px（仅图标）
 *   - 用户可手动点折叠/展开按钮
 */
export function AppShell({
  leftNav,
  children,
  rightPanel,
  rightWidth = 380,
  centerMaxWidth,
  centerClassName = "",
}: AppShellProps) {
  const narrow = useIsNarrowScreen();
  const [manuallyCollapsed, setManuallyCollapsed] = useState<boolean | null>(
    null,
  );

  // 手动状态 > 窄屏自动折叠
  const collapsed =
    manuallyCollapsed !== null ? manuallyCollapsed : narrow;

  // 屏幕从窄变宽时，如果用户没手动设置过，自动展开
  useEffect(() => {
    if (manuallyCollapsed === null) {
      // 跟随 narrow，不做额外操作
    }
  }, [narrow, manuallyCollapsed]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg-primary">
      {/* 左栏 */}
      <LeftNav
        {...leftNav}
        collapsed={collapsed}
        onToggleCollapse={() => setManuallyCollapsed((v) => !(v ?? collapsed))}
      />

      {/* 中栏 */}
      <main
        className={`flex-1 min-w-0 overflow-y-auto ${centerClassName}`}
        style={centerMaxWidth ? { maxWidth: centerMaxWidth } : undefined}
      >
        {children}
      </main>

      {/* 右栏（可选）*/}
      {rightPanel ? (
        <aside
          className="border-l border-border-subtle bg-bg-secondary overflow-y-auto flex-shrink-0"
          style={{ width: rightWidth }}
        >
          {rightPanel}
        </aside>
      ) : null}
    </div>
  );
}
