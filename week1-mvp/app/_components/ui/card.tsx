"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

/**
 * 通用卡片容器
 *
 *   <Card>
 *     <CardHeader>标题</CardHeader>
 *     <CardBody>内容</CardBody>
 *   </Card>
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { elevated = false, padding = "md", className = "", children, ...rest },
  ref,
) {
  const p =
    padding === "none"
      ? ""
      : padding === "sm"
        ? "p-3"
        : padding === "lg"
          ? "p-6"
          : "p-4";
  return (
    <div
      ref={ref}
      className={`${elevated ? "card-elevated" : "card"} ${p} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
});

export function CardHeader({
  title,
  subtitle,
  action,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 mb-3 ${className}`}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-gray-900 truncate">
          {title}
        </h3>
        {subtitle ? (
          <div className="mt-0.5 text-xs text-gray-500">{subtitle}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** 分区标题 —— 用于小节的 UPPERCASE 标题 */
export function SectionLabel({
  children,
  action,
  className = "",
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 mb-2 ${className}`}
    >
      <span className="section-label">{children}</span>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
