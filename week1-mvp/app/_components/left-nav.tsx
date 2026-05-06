"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Home,
  Palette,
  Camera,
  History as HistoryIcon,
  Wallet,
  Library,
  Settings,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Loader2,
  Sparkles,
} from "lucide-react";

type NavUser = {
  id: number;
  username: string;
  display_name: string | null;
  role: "admin" | "user";
};

export interface RecentHistoryItem {
  id: string | number;
  title: string;
  timestamp: number;
  href: string;
}

export interface LeftNavProps {
  user: NavUser;
  collapsed?: boolean;
  recentHistory?: RecentHistoryItem[];
  onToggleCollapse?: () => void;
  activeJobCount?: number;
}

const BRAND_NAME = "服装AI生图工具";
const BRAND_SHORT = "服装AI";

export function LeftNav({
  user,
  collapsed = false,
  recentHistory = [],
  onToggleCollapse,
  activeJobCount = 0,
}: LeftNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname?.startsWith(href + "/");
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const libraryPaths = useMemo(
    () => [
      "/admin/colors",
      "/admin/materials",
      "/admin/realism",
      "/admin/models",
      "/admin/identity-generator",
      "/admin/scenes",
      "/admin/poses",
      "/admin/expressions",
      "/admin/photography",
      "/admin/prompts",
      "/admin/ai-models",
    ],
    [],
  );
  const libraryExpanded = useMemo(
    () => libraryPaths.some((p) => isActive(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname],
  );
  const [libraryOpen, setLibraryOpen] = useState(libraryExpanded);
  useEffect(() => {
    if (libraryExpanded) setLibraryOpen(true);
  }, [libraryExpanded]);

  const adminPaths = [
    "/admin/users",
    "/admin/billing",
    "/admin/model-prices",
    "/admin/announcements",
    "/admin/settings",
  ];
  const adminExpanded = adminPaths.some((p) => isActive(p));
  const [adminOpen, setAdminOpen] = useState(adminExpanded);
  useEffect(() => {
    if (adminExpanded) setAdminOpen(true);
  }, [adminExpanded]);

  // 场景工具组（admin 专属，新功能区块）
  const sceneToolsPaths = useMemo(
    () => [
      "/admin/scene-tools/background-swap",
      "/admin/scene-tools/poster",
      "/admin/scene-tools/social-snap",
      "/admin/scene-tools/replicate",
    ],
    [],
  );
  const sceneToolsExpanded = useMemo(
    () => sceneToolsPaths.some((p) => isActive(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname],
  );
  const [sceneToolsOpen, setSceneToolsOpen] = useState(sceneToolsExpanded);
  useEffect(() => {
    if (sceneToolsExpanded) setSceneToolsOpen(true);
  }, [sceneToolsExpanded]);

  const displayName = user.display_name || user.username;

  // ===== 折叠态 =====
  if (collapsed) {
    return (
      <aside
        aria-label="侧边导航"
        className="h-full bg-bg-secondary border-r border-border-subtle flex flex-col items-center py-3 w-14 flex-shrink-0"
      >
        <button
          onClick={onToggleCollapse}
          className="w-9 h-9 rounded-md hover:bg-bg-hover flex items-center justify-center text-fg-tertiary hover:text-fg-primary mb-3 transition-colors"
          aria-label="展开侧边栏"
          title="展开"
        >
          <PanelLeftOpen size={16} strokeWidth={2} />
        </button>

        {/* logo 小图标 */}
        <div
          className="w-9 h-9 rounded-md mb-4 flex items-center justify-center text-white"
          style={{
            background: "var(--brand-gradient)",
            boxShadow: "0 0 16px var(--brand-glow)",
          }}
          title={BRAND_NAME}
        >
          <Sparkles size={16} strokeWidth={2.2} />
        </div>

        {/* 进行中任务 */}
        {activeJobCount > 0 ? (
          <Link
            href="/history?status=active"
            title={`${activeJobCount} 个任务进行中 · 点击查看`}
            className="relative w-9 h-9 rounded-md flex items-center justify-center mb-2 bg-[var(--brand-50-bg)] text-brand-400 hover:bg-[var(--brand-100-bg)]"
          >
            <Loader2 size={16} strokeWidth={2.2} className="animate-spin" />
            <span
              className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-semibold flex items-center justify-center"
              style={{ background: "var(--brand-600)" }}
            >
              {activeJobCount}
            </span>
          </Link>
        ) : null}

        <CollapsedIcon href="/" label="首页" Icon={Home} active={isActive("/")} />
        <CollapsedIcon
          href="/recolor"
          label="HEX 换色"
          Icon={Palette}
          active={isActive("/recolor")}
        />
        <CollapsedIcon
          href="/batch-photo"
          label="批量摄影"
          Icon={Camera}
          active={isActive("/batch-photo")}
        />
        <CollapsedIcon
          href="/history"
          label="历史"
          Icon={HistoryIcon}
          active={isActive("/history")}
        />
        <CollapsedIcon
          href="/billing"
          label="账单"
          Icon={Wallet}
          active={isActive("/billing")}
        />
      </aside>
    );
  }

  // ===== 展开态 =====
  return (
    <aside
      aria-label="侧边导航"
      className="h-full bg-bg-secondary border-r border-border-subtle flex flex-col w-[240px] flex-shrink-0"
    >
      {/* 顶部：品牌 + 折叠按钮 */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-border-subtle">
        <Link href="/" className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-9 h-9 rounded-md flex items-center justify-center text-white flex-shrink-0"
            style={{
              background: "var(--brand-gradient)",
              boxShadow: "0 0 16px var(--brand-glow)",
            }}
          >
            <Sparkles size={16} strokeWidth={2.2} />
          </span>
          <span className="font-bold text-fg-primary text-[15px] tracking-tight truncate">
            {BRAND_SHORT}
          </span>
        </Link>
        {onToggleCollapse ? (
          <button
            onClick={onToggleCollapse}
            className="w-7 h-7 rounded-md hover:bg-bg-hover flex items-center justify-center text-fg-tertiary hover:text-fg-primary transition-colors"
            aria-label="折叠"
            title="折叠"
          >
            <PanelLeftClose size={14} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {/* 进行中任务 —— 有任务时顶部脉冲 */}
        {activeJobCount > 0 ? (
          <div className="px-3 mb-3">
            <Link
              href="/history?status=active"
              className="flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors hover:brightness-110"
              style={{
                background: "var(--brand-50-bg)",
                border: "1px solid rgba(59, 130, 246, 0.3)",
              }}
              title="查看所有进行中任务"
            >
              <Loader2 size={16} strokeWidth={2.2} className="text-brand-400 animate-spin" />
              <span className="flex-1 text-[12.5px] font-medium text-brand-400 truncate">
                {activeJobCount} 个任务进行中
              </span>
              <ChevronRight size={14} strokeWidth={2} className="text-brand-400" />
            </Link>
          </div>
        ) : null}

        {/* 工作台 */}
        <SectionHeader>工作台</SectionHeader>
        <div className="px-3 space-y-0.5">
          <NavItem href="/" Icon={Home} label="首页概览" active={isActive("/")} />
          <NavItem
            href="/recolor"
            Icon={Palette}
            label="HEX 换色"
            active={isActive("/recolor")}
          />
          <NavItem
            href="/batch-photo"
            Icon={Camera}
            label="批量摄影"
            active={isActive("/batch-photo")}
            badge={activeJobCount > 0 ? String(activeJobCount) : undefined}
          />
          <NavItem
            href="/history"
            Icon={HistoryIcon}
            label="历史记录"
            active={isActive("/history")}
          />
          <NavItem
            href="/billing"
            Icon={Wallet}
            label="我的账单"
            active={isActive("/billing")}
          />
        </div>

        {user.role === "admin" ? (
          <>
            <SectionHeader className="mt-5">素材库</SectionHeader>
            <Collapsible
              label="素材管理"
              Icon={Library}
              open={libraryOpen}
              onToggle={() => setLibraryOpen((v) => !v)}
              hasActive={libraryExpanded}
            >
              <SubItem href="/admin/colors" label="颜色" active={isActive("/admin/colors")} />
              <SubItem href="/admin/materials" label="材质" active={isActive("/admin/materials")} />
              <SubItem href="/admin/realism" label="真实感" active={isActive("/admin/realism")} />
              <SubItem href="/admin/models" label="模特" active={isActive("/admin/models")} />
              <SubItem href="/admin/identity-generator" label="形象生成器" active={isActive("/admin/identity-generator")} />
              <SubItem href="/admin/scenes" label="场景" active={isActive("/admin/scenes")} />
              <SubItem href="/admin/poses" label="姿势" active={isActive("/admin/poses")} />
              <SubItem href="/admin/expressions" label="表情" active={isActive("/admin/expressions")} />
              <SubItem href="/admin/photography" label="摄影" active={isActive("/admin/photography")} />
              <SubItem href="/admin/prompts" label="Prompt" active={isActive("/admin/prompts")} />
              <SubItem href="/admin/ai-models" label="AI 模型" active={isActive("/admin/ai-models")} />
            </Collapsible>

            <SectionHeader className="mt-5">场景工具</SectionHeader>
            <Collapsible
              label="生成场景图"
              Icon={Sparkles}
              open={sceneToolsOpen}
              onToggle={() => setSceneToolsOpen((v) => !v)}
              hasActive={sceneToolsExpanded}
            >
              <SubItem
                href="/admin/scene-tools/background-swap"
                label="背景换图"
                active={isActive("/admin/scene-tools/background-swap")}
              />
              <SubItem
                href="/admin/scene-tools/poster"
                label="氛围海报"
                active={isActive("/admin/scene-tools/poster")}
              />
              <SubItem
                href="/admin/scene-tools/social-snap"
                label="社媒图"
                active={isActive("/admin/scene-tools/social-snap")}
              />
              <SubItem
                href="/admin/scene-tools/replicate"
                label="仿图"
                active={isActive("/admin/scene-tools/replicate")}
              />
            </Collapsible>

            <SectionHeader className="mt-5">系统</SectionHeader>
            <Collapsible
              label="团队管理"
              Icon={Settings}
              open={adminOpen}
              onToggle={() => setAdminOpen((v) => !v)}
              hasActive={adminExpanded}
            >
              <SubItem href="/admin/users" label="用户" active={isActive("/admin/users")} />
              <SubItem href="/admin/billing" label="团队账单" active={isActive("/admin/billing")} />
              <SubItem href="/admin/model-prices" label="单价 / 汇率" active={isActive("/admin/model-prices")} />
              <SubItem href="/admin/announcements" label="公告栏" active={isActive("/admin/announcements")} />
              <SubItem href="/admin/settings" label="系统设置" active={isActive("/admin/settings")} />
            </Collapsible>
          </>
        ) : null}

        {recentHistory.length > 0 ? (
          <>
            <SectionHeader className="mt-5">最近记录</SectionHeader>
            <div className="px-3 space-y-0.5">
              {recentHistory.slice(0, 5).map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="block px-2.5 py-1.5 rounded-md hover:bg-bg-hover group"
                  title={item.title}
                >
                  <div className="text-[12px] text-fg-secondary truncate group-hover:text-fg-primary">
                    {item.title}
                  </div>
                  <div className="text-[10px] text-fg-tertiary mt-0.5">
                    {formatRelativeTime(item.timestamp)}
                  </div>
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </nav>

      {/* 底部 */}
      <div className="border-t border-border-subtle px-3 py-2.5 flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-md text-white text-[12px] font-semibold flex items-center justify-center flex-shrink-0"
          style={{ background: "var(--brand-gradient)" }}
        >
          {displayName.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-fg-primary truncate font-medium leading-tight">
            {displayName}
          </div>
          {user.role === "admin" ? (
            <div className="text-[10px] text-warn leading-tight mt-0.5">
              管理员
            </div>
          ) : (
            <div className="text-[10px] text-fg-tertiary leading-tight mt-0.5">
              成员
            </div>
          )}
        </div>
        <button
          onClick={handleLogout}
          className="w-7 h-7 rounded-md text-fg-tertiary hover:text-danger hover:bg-[var(--danger-bg)] flex items-center justify-center transition-colors"
          title="退出登录"
        >
          <LogOut size={14} strokeWidth={2} />
        </button>
      </div>
    </aside>
  );
}

/* ═════════════ 内部小件 ═════════════ */

interface NavIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}
type IconCmp = React.ComponentType<NavIconProps>;

function SectionHeader({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`px-5 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary ${className}`}
    >
      {children}
    </div>
  );
}

function NavItem({
  href,
  Icon,
  label,
  active,
  badge,
}: {
  href: string;
  Icon: IconCmp;
  label: string;
  active: boolean;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors ${
        active
          ? "text-brand-400 font-medium"
          : "text-fg-secondary hover:bg-bg-hover hover:text-fg-primary"
      }`}
      style={
        active
          ? { background: "var(--brand-50-bg)" }
          : undefined
      }
    >
      <Icon
        size={16}
        strokeWidth={active ? 2.2 : 1.8}
        className={active ? "text-brand-400" : "text-fg-tertiary"}
      />
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-semibold"
          style={{ background: "var(--brand-600)" }}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function SubItem({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block pl-10 pr-3 py-1.5 rounded-md text-[12.5px] transition-colors ${
        active
          ? "text-brand-400 font-medium"
          : "text-fg-secondary hover:bg-bg-hover hover:text-fg-primary"
      }`}
      style={
        active
          ? { background: "var(--brand-50-bg)" }
          : undefined
      }
    >
      {label}
    </Link>
  );
}

function Collapsible({
  label,
  Icon,
  open,
  onToggle,
  hasActive,
  children,
}: {
  label: string;
  Icon: IconCmp;
  open: boolean;
  onToggle: () => void;
  hasActive: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors ${
          hasActive
            ? "text-brand-400 font-medium"
            : "text-fg-secondary hover:bg-bg-hover hover:text-fg-primary"
        }`}
      >
        <Icon
          size={16}
          strokeWidth={hasActive ? 2.2 : 1.8}
          className={hasActive ? "text-brand-400" : "text-fg-tertiary"}
        />
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronRight
          size={14}
          strokeWidth={2}
          className={`text-fg-tertiary transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>
      {open ? <div className="mt-0.5 space-y-0.5">{children}</div> : null}
    </div>
  );
}

function CollapsedIcon({
  href,
  label,
  Icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  Icon: IconCmp;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      title={label}
      className={`relative w-9 h-9 rounded-md flex items-center justify-center mb-1 transition-colors ${
        active
          ? "text-brand-400"
          : "text-fg-tertiary hover:bg-bg-hover hover:text-fg-primary"
      }`}
      style={
        active
          ? { background: "var(--brand-50-bg)" }
          : undefined
      }
    >
      <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
      {badge ? (
        <span
          className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-semibold flex items-center justify-center"
          style={{ background: "var(--brand-600)" }}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 86400_000 * 7) return `${Math.floor(diff / 86400_000)} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}
