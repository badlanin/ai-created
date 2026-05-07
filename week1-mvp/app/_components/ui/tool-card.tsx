"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export type ToolCardGradient =
  | "blue"
  | "indigo"
  | "purple"
  | "pink"
  | "teal"
  | "amber";

export interface ToolCardProps {
  href: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  gradient?: ToolCardGradient;
  /** 角标徽章（如 NEW / 内测 / 数字） */
  badge?: string;
  /** 是否禁用（即将推出等） */
  disabled?: boolean;
}

/**
 * 度加风工具大卡片
 *
 * 用法（首页 6 卡）：
 *   <ToolCard
 *     href="/scene-tools"
 *     title="服饰场景图"
 *     subtitle="批量换景，一键生成"
 *     icon={<Sparkles size={28} />}
 *     gradient="indigo"
 *   />
 */
export function ToolCard({
  href,
  title,
  subtitle,
  icon,
  gradient = "indigo",
  badge,
  disabled = false,
}: ToolCardProps) {
  const className = `tool-card tool-card-${gradient} ${
    disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : ""
  }`;
  const inner = (
    <>
      {badge && (
        <span className="absolute top-3 right-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-white/25 text-white backdrop-blur-sm">
          {badge}
        </span>
      )}
      <div className="flex items-center justify-between mb-3">
        {icon && (
          <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center text-white backdrop-blur-sm">
            {icon}
          </div>
        )}
        <ArrowRight
          size={18}
          className="text-white/70 group-hover:text-white group-hover:translate-x-0.5 transition-all"
        />
      </div>
      <div className="mt-auto">
        <h3 className="text-xl font-semibold text-white tracking-tight">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-1 text-[13px] text-white/85 leading-snug">
            {subtitle}
          </p>
        )}
      </div>
    </>
  );

  if (disabled) {
    return <div className={`${className} group`}>{inner}</div>;
  }
  return (
    <Link href={href} className={`${className} group`}>
      {inner}
    </Link>
  );
}
