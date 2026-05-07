import { getCurrentUser } from "@/lib/auth";
import { HomeShell } from "./_components/home-shell";
import { ToolCard } from "./_components/ui";
import {
  Palette,
  Camera,
  History as HistoryIcon,
  Wallet,
  Sparkles,
  Users2,
} from "lucide-react";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  // 6 张工具大卡片（度加风渐变）
  const toolCards: Array<{
    href: string;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    gradient: "blue" | "indigo" | "purple" | "pink" | "teal" | "amber";
    badge?: string;
    adminOnly?: boolean;
  }> = [
    {
      href: "/batch-photo",
      title: "批量摄影图",
      subtitle: "产品图 + 模特 + N 姿势 + 纯色 / 场景 → 一键批量出图",
      icon: <Camera size={24} strokeWidth={2} />,
      gradient: "indigo",
      badge: "主力",
    },
    {
      href: "/scene-tools",
      title: "服饰场景图",
      subtitle: "N 张产品 × M 个场景（文字 / 图片混搭）= N×M 张换景成片",
      icon: <Sparkles size={24} strokeWidth={2} />,
      gradient: "purple",
      badge: "新",
    },
    {
      href: "/recolor",
      title: "HEX 精准换色",
      subtitle: "一张产品图 + 多个 HEX 颜色 → 同款不同色批量产出",
      icon: <Palette size={24} strokeWidth={2} />,
      gradient: "blue",
    },
    {
      href: "/admin/identity-generator",
      title: "形象生成",
      subtitle: "文字描述 → AI 生成模特身份图，commit 进 identity 库",
      icon: <Users2 size={24} strokeWidth={2} />,
      gradient: "pink",
      adminOnly: true,
    },
    {
      href: "/history",
      title: "我的历史",
      subtitle: "历次任务、结果图、token 用量、成本明细",
      icon: <HistoryIcon size={24} strokeWidth={2} />,
      gradient: "teal",
    },
    {
      href: "/billing",
      title: "我的账单",
      subtitle: "本月用量、余额、按工具 / 模型分类的明细",
      icon: <Wallet size={24} strokeWidth={2} />,
      gradient: "amber",
    },
  ];

  // 普通用户隐藏 admin-only 工具
  const visibleCards = toolCards.filter(
    (t) => !t.adminOnly || user.role === "admin",
  );

  return (
    <HomeShell user={user}>
      <div className="mx-auto w-full max-w-7xl px-5 md:px-8 lg:px-10 py-8 md:py-12">
        {/* Hero 欢迎区 */}
        <section className="mb-10">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-[13px] font-medium text-brand-400 tracking-wide uppercase">
              Hi
            </span>
            <span className="text-[15px] font-medium text-fg-secondary">
              {user.display_name || user.username}
            </span>
          </div>
          <h1 className="text-[32px] md:text-[38px] font-bold text-fg-primary tracking-tight leading-tight">
            AI 极简操作，
            <br className="md:hidden" />
            一键开启全新创作体验
          </h1>
          <p className="mt-3 text-[14px] md:text-[15px] text-fg-tertiary">
            从下面选一个工具开始，左侧导航可随时切换。
          </p>
        </section>

        {/* 6 张工具大卡片 */}
        <section className="mb-12">
          <h2 className="text-sm font-semibold text-fg-secondary mb-4 flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-grad-brand" />
            工作台
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleCards.map((t) => (
              <ToolCard
                key={t.href}
                href={t.href}
                title={t.title}
                subtitle={t.subtitle}
                icon={t.icon}
                gradient={t.gradient}
                badge={t.badge}
              />
            ))}
          </div>
        </section>

        {/* admin 二级链接（小卡片） */}
        {user.role === "admin" && (
          <section className="mb-12">
            <h2 className="text-sm font-semibold text-fg-secondary mb-4 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-fg-muted" />
              管理员素材库
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                { href: "/admin/scenes", label: "场景库" },
                { href: "/admin/models", label: "模特库" },
                { href: "/admin/poses", label: "姿势库" },
                { href: "/admin/expressions", label: "表情库" },
                { href: "/admin/colors", label: "颜色库" },
                { href: "/admin/materials", label: "材质库" },
                { href: "/admin/realism", label: "真实感预设" },
                { href: "/admin/photography", label: "摄影参数" },
                { href: "/admin/prompts", label: "Prompt 模板" },
                { href: "/admin/ai-models", label: "AI 模型" },
                { href: "/admin/users", label: "用户" },
                { href: "/admin/billing", label: "团队账单" },
                { href: "/admin/model-prices", label: "单价 / 汇率" },
                { href: "/admin/announcements", label: "公告栏" },
                { href: "/admin/settings", label: "系统设置" },
              ].map((a) => (
                <a
                  key={a.href}
                  href={a.href}
                  className="card px-4 py-3 text-sm text-fg-secondary hover:text-brand-400 transition-colors"
                >
                  {a.label}
                </a>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-16 text-center text-xs text-fg-muted">
          BUQIQI · v0.4 · Powered by Gemini
        </footer>
      </div>
    </HomeShell>
  );
}
