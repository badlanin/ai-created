"use client";

import { ReactNode } from "react";

/**
 * 空状态
 *
 * 用法：
 *   <EmptyState
 *     icon={<Inbox size={28}/>}
 *     title="暂无任务"
 *     description="还没创建过任何批量任务"
 *     action={<Button variant="primary">新建任务</Button>}
 *   />
 */
export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}
    >
      {icon ? (
        <div className="w-14 h-14 rounded-md bg-bg-tertiary border border-border-subtle flex items-center justify-center text-fg-tertiary mb-4">
          {icon}
        </div>
      ) : null}
      <div className="text-[15px] font-semibold text-fg-primary mb-1.5">
        {title}
      </div>
      {description ? (
        <div className="text-[13px] text-fg-tertiary max-w-sm mb-4">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
