"use client";

/**
 * 状态指示点
 *
 * 用于任务状态、连接状态、健康检查等"小信号"场景。
 *
 * 用法：
 *   <StatusDot tone="success" pulse />
 *   <StatusDot tone="warn" label="处理中" />
 */

export type StatusTone = "success" | "warn" | "danger" | "idle";

export interface StatusDotProps {
  tone?: StatusTone;
  /** 是否脉冲 */
  pulse?: boolean;
  /** 旁边显示的文字（可选）*/
  label?: string;
  className?: string;
}

const TONE_CLASS: Record<StatusTone, string> = {
  success: "status-dot-success",
  warn: "status-dot-warn",
  danger: "status-dot-danger",
  idle: "status-dot-idle",
};

export function StatusDot({
  tone = "idle",
  pulse = false,
  label,
  className = "",
}: StatusDotProps) {
  const dot = (
    <span
      className={`status-dot ${TONE_CLASS[tone]} ${pulse ? "status-dot-pulse" : ""}`}
    />
  );
  if (!label) return dot;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {dot}
      <span className="text-[12px] text-fg-secondary">{label}</span>
    </span>
  );
}
