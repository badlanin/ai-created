"use client";

import { ChevronRight } from "lucide-react";

export interface PageHeaderProps {
  /** 主标题 */
  title: string;
  /** 副标题 / 描述 */
  description?: string;
  /** 面包屑（可选） */
  breadcrumb?: Array<{ label: string; href?: string }>;
  /** 标题前的图标（可选） */
  icon?: React.ReactNode;
  /** 右上角操作按钮区 */
  actions?: React.ReactNode;
  /** 子内容（如 tabs / 筛选条），紧贴 header 下方 */
  children?: React.ReactNode;
}

/**
 * 统一页面头部
 *
 * 用法：
 *   <PageHeader
 *     title="服饰场景图"
 *     description="N 张产品 × M 个场景 = 笛卡尔积输出"
 *     icon={<Sparkles size={24} />}
 *     actions={<Button variant="primary">新建</Button>}
 *   />
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  icon,
  actions,
  children,
}: PageHeaderProps) {
  return (
    <header className="mb-6">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="flex items-center gap-1 mb-2 text-xs text-fg-tertiary">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {b.href ? (
                <a href={b.href} className="hover:text-brand-400 transition-colors">
                  {b.label}
                </a>
              ) : (
                <span>{b.label}</span>
              )}
              {i < breadcrumb.length - 1 && (
                <ChevronRight size={12} className="text-fg-muted" />
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {icon && (
            <div className="shrink-0 w-11 h-11 rounded-xl bg-grad-brand text-white flex items-center justify-center shadow-md">
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-semibold text-fg-primary tracking-tight">
              {title}
            </h1>
            {description && (
              <p className="mt-1 text-sm text-fg-tertiary leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </header>
  );
}
