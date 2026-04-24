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
  Activity,
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
      "/admin/scenes",
      "/admin/poses",
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
  ];
  const adminExpanded = adminPaths.some((p) => isActive(p));
  const [adminOpen, setAdminOpen] = useState(adminExpanded);
  useEffect(() => {
    if (adminExpanded) setAdminOpen(true);
  }, [adminExpanded]);

  const displayName = user.display_name || user.username;

  // ===== 折叠态 =====
  if (collapsed) {
    return (
      <aside
        aria-label="侧边导航"
        className="h-full bg-white border-r border-gray-150 flex flex-col items-center py-3 w-14 flex-shrink-0"
      >
        <button
          onClick={onToggleCollapse}
          className="w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500 mb-4 transition-colors"
          aria-label="展开侧边栏"
          title="展开"
        >
          <PanelLeftOpen size={16} strokeWidth={2} />
        </button>

        {/* 进行中任务 */}
        {activeJobCount > 0 ? (
          <Link
            href="/history?status=active"
            title={`${activeJobCount} 个任务进行中 · 点击查看`}
            className="relative w-9 h-9 rounded-lg flex items-center justify-center mb-2 bg-blue-50 text-blue-600 hover:bg-blue-100"
          >
            <Loader2 size={16} strokeWidth={2.2} className="animate-spin" />
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white text-[10px] font-semibold flex items-center justify-center">
              {activeJobCount}
            </span>
          </Link>
        ) : null}

        <CollapsedIcon href="/" label="首页" Icon={Home} active={isActive("/")} />
        <CollapsedIcon
          href="/recolor"
          label="换色"
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
      className="h-full bg-white border-r border-gray-150 flex flex-col w-[240px] flex-shrink-0"
    >
      {/* 顶部：品牌 + 折叠 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <Link
          href="/"
          className="font-semibold text-gray-900 truncate text-[15px] tracking-tight"
        >
          伴娘服 AI
        </Link>
        <div className="flex items-center gap-1">
          {activeJobCount > 0 ? (
            <span
              className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-600 text-white"
              title={`${activeJobCount} 个任务进行中`}
            >
              {activeJobCount}
            </span>
          ) : null}
          {onToggleCollapse ? (
            <button
              onClick={onToggleCollapse}
              className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-400 transition-colors"
              aria-label="折叠"
              title="折叠"
            >
              <PanelLeftClose size={14} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {/* 进行中任务 —— 有任务时显示在顶部，脉冲提醒 */}
        {activeJobCount > 0 ? (
          <div className="px-2 mb-2">
            <Link
              href="/history?status=active"
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-blue-50 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-colors ${
                isActive("/history") ? "ring-1 ring-blue-400" : ""
              }`}
              title="查看所有进行中任务"
            >
              <span className="relative inline-flex">
                <Loader2
                  size={16}
                  strokeWidth={2.2}
                  className="text-blue-600 animate-spin"
                />
              </span>
              <span className="flex-1 text-[13px] font-medium text-blue-900 truncate">
                {activeJobCount} 个任务进行中
              </span>
              <ChevronRight
                size={14}
                strokeWidth={2}
                className="text-blue-500"
              />
            </Link>
          </div>
        ) : null}

        <div className="px-2 space-y-0.5">
          <NavItem href="/" Icon={Home} label="首页" active={isActive("/")} />
          <NavItem
            href="/recolor"
            Icon={Palette}
            label="换色"
            active={isActive("/recolor")}
          />
          <NavItem
            href="/batch-photo"
            Icon={Camera}
            label="批量摄影图"
            active={isActive("/batch-photo")}
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
            <Divider label="素材" />
            <Collapsible
              label="素材管理"
              Icon={Library}
              open={libraryOpen}
              onToggle={() => setLibraryOpen((v) => !v)}
              hasActive={libraryExpanded}
            >
              <SubItem
                href="/admin/colors"
                label="颜色"
                active={isActive("/admin/colors")}
              />
              <SubItem
                href="/admin/materials"
                label="材质"
                active={isActive("/admin/materials")}
              />
              <SubItem
                href="/admin/realism"
                label="真实感"
                active={isActive("/admin/realism")}
              />
              <SubItem
                href="/admin/models"
                label="模特"
                active={isActive("/admin/models")}
              />
              <SubItem
                href="/admin/scenes"
                label="场景"
                active={isActive("/admin/scenes")}
              />
              <SubItem
                href="/admin/poses"
                label="姿势"
                active={isActive("/admin/poses")}
              />
              <SubItem
                href="/admin/photography"
                label="摄影"
                active={isActive("/admin/photography")}
              />
              <SubItem
                href="/admin/prompts"
                label="Prompt"
                active={isActive("/admin/prompts")}
              />
              <SubItem
                href="/admin/ai-models"
                label="AI 模型"
                active={isActive("/admin/ai-models")}
              />
            </Collapsible>

            <Divider label="管理" />
            <Collapsible
              label="团队管理"
              Icon={Settings}
              open={adminOpen}
              onToggle={() => setAdminOpen((v) => !v)}
              hasActive={adminExpanded}
            >
              <SubItem
                href="/admin/users"
                label="用户"
                active={isActive("/admin/users")}
              />
              <SubItem
                href="/admin/billing"
                label="团队账单"
                active={isActive("/admin/billing")}
              />
              <SubItem
                href="/admin/model-prices"
                label="单价 / 汇率"
                active={isActive("/admin/model-prices")}
              />
              <SubItem
                href="/admin/announcements"
                label="公告栏"
                active={isActive("/admin/announcements")}
              />
            </Collapsible>
          </>
        ) : null}

        {recentHistory.length > 0 ? (
          <>
            <Divider label="最近记录" />
            <div className="px-2 space-y-0.5">
              {recentHistory.slice(0, 5).map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="block px-2 py-1.5 rounded-md hover:bg-gray-50 group"
                  title={item.title}
                >
                  <div className="text-[12px] text-gray-700 truncate group-hover:text-gray-900">
                    {item.title}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {formatRelativeTime(item.timestamp)}
                  </div>
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </nav>

      {/* 底部 */}
      <div className="border-t border-gray-100 px-3 py-2.5 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white text-[11px] font-semibold flex items-center justify-center flex-shrink-0">
          {displayName.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-gray-900 truncate font-medium leading-tight">
            {displayName}
          </div>
          {user.role === "admin" ? (
            <div className="text-[10px] text-amber-600 leading-tight">
              管理员
            </div>
          ) : (
            <div className="text-[10px] text-gray-400 leading-tight">
              成员
            </div>
          )}
        </div>
        <button
          onClick={handleLogout}
          className="w-7 h-7 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors"
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
      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
        active
          ? "bg-blue-50 text-blue-700 font-medium"
          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      }`}
    >
      <Icon
        size={16}
        strokeWidth={active ? 2.2 : 1.8}
        className={active ? "text-blue-600" : "text-gray-400"}
      />
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-600 text-white font-medium">
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
      className={`block pl-10 pr-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors ${
        active
          ? "bg-blue-50 text-blue-700 font-medium"
          : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
      }`}
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
    <div className="px-2">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
          hasActive
            ? "text-blue-700 font-medium"
            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
        }`}
      >
        <Icon
          size={16}
          strokeWidth={hasActive ? 2.2 : 1.8}
          className={hasActive ? "text-blue-600" : "text-gray-400"}
        />
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronRight
          size={14}
          strokeWidth={2}
          className={`text-gray-400 transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>
      {open ? <div className="mt-0.5 space-y-0.5">{children}</div> : null}
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="mt-5 mb-1.5 px-4 text-[10px] uppercase tracking-wider text-gray-400 font-medium">
      {label}
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
      className={`relative w-9 h-9 rounded-lg flex items-center justify-center mb-1 transition-colors ${
        active
          ? "bg-blue-50 text-blue-600"
          : "text-gray-400 hover:bg-gray-50 hover:text-gray-800"
      }`}
    >
      <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
      {badge ? (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white text-[10px] font-semibold flex items-center justify-center">
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
