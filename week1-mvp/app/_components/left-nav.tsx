"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type NavUser = {
  id: number;
  username: string;
  display_name: string | null;
  role: "admin" | "user";
};

/** 左栏最近历史记录条目（通常由父组件从 /api/history 拉取后传入） */
export interface RecentHistoryItem {
  id: string | number;
  title: string;
  timestamp: number;
  href: string;
}

export interface LeftNavProps {
  user: NavUser;
  /** 折叠状态下是否仅显示图标 */
  collapsed?: boolean;
  /** 最近历史（最多 5 条，组件自行截断） */
  recentHistory?: RecentHistoryItem[];
  /** 折叠切换回调（传了就显示折叠按钮） */
  onToggleCollapse?: () => void;
  /** 当前活跃任务数量（>0 时在顶部显示徽标） */
  activeJobCount?: number;
}

/**
 * 左栏导航
 *
 * 区域：
 *   1. 顶部：品牌 + 活跃任务徽标 + 折叠按钮
 *   2. 主导航：换色 / 批量摄影图 / 历史 / 账单
 *   3. 素材库（可展开二级菜单）：颜色 / 材质 / 真实感 / 模特 / 场景 / 姿势 / 摄影 / Prompt / AI 模型
 *   4. 管理（admin 可见）：用户 / 单价汇率 / 团队账单
 *   5. 最近 5 条历史
 *   6. 底部：用户信息 + 退出
 */
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

  // 素材库二级菜单：路径命中时自动展开
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

  // 管理二级菜单
  const adminPaths = ["/admin/users", "/admin/billing", "/admin/model-prices"];
  const adminExpanded = adminPaths.some((p) => isActive(p));
  const [adminOpen, setAdminOpen] = useState(adminExpanded);
  useEffect(() => {
    if (adminExpanded) setAdminOpen(true);
  }, [adminExpanded]);

  const displayName = user.display_name || user.username;

  // 折叠态：只显示图标，宽度 56px
  if (collapsed) {
    return (
      <aside
        aria-label="侧边导航"
        className="h-full bg-white border-r border-gray-200 flex flex-col items-center py-3 w-14 flex-shrink-0"
      >
        <button
          onClick={onToggleCollapse}
          className="w-9 h-9 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-500 mb-3"
          aria-label="展开侧边栏"
          title="展开"
        >
          ☰
        </button>
        <CollapsedNavIcon href="/" label="首页" glyph="⌂" active={isActive("/")} />
        <CollapsedNavIcon
          href="/recolor"
          label="换色"
          glyph="🎨"
          active={isActive("/recolor")}
        />
        <CollapsedNavIcon
          href="/batch-photo"
          label="批量摄影"
          glyph="📷"
          active={isActive("/batch-photo")}
        />
        <CollapsedNavIcon
          href="/history"
          label="历史"
          glyph="🕘"
          active={isActive("/history")}
          badge={activeJobCount > 0 ? activeJobCount : undefined}
        />
        <CollapsedNavIcon
          href="/billing"
          label="账单"
          glyph="¥"
          active={isActive("/billing")}
        />
      </aside>
    );
  }

  return (
    <aside
      aria-label="侧边导航"
      className="h-full bg-white border-r border-gray-200 flex flex-col w-[260px] flex-shrink-0"
    >
      {/* 顶部：品牌 + 折叠按钮 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <Link href="/" className="font-semibold text-gray-900 truncate">
          伴娘服 AI
        </Link>
        <div className="flex items-center gap-1">
          {activeJobCount > 0 ? (
            <span
              className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-600 text-white"
              title={`${activeJobCount} 个任务进行中`}
            >
              {activeJobCount}
            </span>
          ) : null}
          {onToggleCollapse ? (
            <button
              onClick={onToggleCollapse}
              className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-400"
              aria-label="折叠侧边栏"
              title="折叠"
            >
              ‹
            </button>
          ) : null}
        </div>
      </div>

      {/* 主导航 */}
      <nav className="flex-1 overflow-y-auto py-2">
        <NavGroup>
          <NavItem href="/" label="首页" active={isActive("/")} glyph="⌂" />
          <NavItem
            href="/recolor"
            label="换色"
            active={isActive("/recolor")}
            glyph="🎨"
          />
          <NavItem
            href="/batch-photo"
            label="批量摄影图"
            active={isActive("/batch-photo")}
            glyph="📷"
          />
          <NavItem
            href="/history"
            label="历史记录"
            active={isActive("/history")}
            glyph="🕘"
            badge={activeJobCount > 0 ? `${activeJobCount} 进行中` : undefined}
          />
          <NavItem
            href="/billing"
            label="我的账单"
            active={isActive("/billing")}
            glyph="¥"
          />
        </NavGroup>

        {/* 素材库（admin 可见）*/}
        {user.role === "admin" ? (
          <>
            <NavDivider label="素材库" />
            <NavCollapse
              label="素材管理"
              glyph="▦"
              open={libraryOpen}
              onToggle={() => setLibraryOpen((v) => !v)}
              hasActive={libraryExpanded}
            >
              <SubNavItem
                href="/admin/colors"
                label="颜色"
                active={isActive("/admin/colors")}
              />
              <SubNavItem
                href="/admin/materials"
                label="材质"
                active={isActive("/admin/materials")}
              />
              <SubNavItem
                href="/admin/realism"
                label="真实感"
                active={isActive("/admin/realism")}
              />
              <SubNavItem
                href="/admin/models"
                label="模特"
                active={isActive("/admin/models")}
              />
              <SubNavItem
                href="/admin/scenes"
                label="场景"
                active={isActive("/admin/scenes")}
              />
              <SubNavItem
                href="/admin/poses"
                label="姿势"
                active={isActive("/admin/poses")}
              />
              <SubNavItem
                href="/admin/photography"
                label="摄影"
                active={isActive("/admin/photography")}
              />
              <SubNavItem
                href="/admin/prompts"
                label="Prompt"
                active={isActive("/admin/prompts")}
              />
              <SubNavItem
                href="/admin/ai-models"
                label="AI 模型"
                active={isActive("/admin/ai-models")}
              />
            </NavCollapse>

            <NavDivider label="管理" />
            <NavCollapse
              label="团队管理"
              glyph="⚙"
              open={adminOpen}
              onToggle={() => setAdminOpen((v) => !v)}
              hasActive={adminExpanded}
            >
              <SubNavItem
                href="/admin/users"
                label="用户"
                active={isActive("/admin/users")}
              />
              <SubNavItem
                href="/admin/billing"
                label="团队账单"
                active={isActive("/admin/billing")}
              />
              <SubNavItem
                href="/admin/model-prices"
                label="单价/汇率"
                active={isActive("/admin/model-prices")}
              />
            </NavCollapse>
          </>
        ) : null}

        {/* 最近历史 */}
        {recentHistory.length > 0 ? (
          <>
            <NavDivider label="最近记录" />
            <div className="px-2 space-y-0.5">
              {recentHistory.slice(0, 5).map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="block px-2 py-1.5 rounded-md hover:bg-gray-100 group"
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

      {/* 底部：用户 + 退出 */}
      <div className="border-t border-gray-100 px-3 py-2.5 flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white text-xs font-medium flex items-center justify-center flex-shrink-0">
          {displayName.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-900 truncate">{displayName}</div>
          {user.role === "admin" ? (
            <div className="text-[10px] text-amber-700">管理员</div>
          ) : null}
        </div>
        <button
          onClick={handleLogout}
          className="text-gray-400 hover:text-red-600 text-xs px-2 py-1"
          title="退出登录"
        >
          退出
        </button>
      </div>
    </aside>
  );
}

/* ─────────── 内部小组件 ─────────── */

function NavGroup({ children }: { children: React.ReactNode }) {
  return <div className="px-2 space-y-0.5">{children}</div>;
}

function NavItem({
  href,
  label,
  active,
  glyph,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  glyph?: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-sm ${
        active
          ? "bg-blue-50 text-blue-800 font-medium"
          : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      {glyph ? (
        <span className="w-4 text-center text-gray-500" aria-hidden>
          {glyph}
        </span>
      ) : null}
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600 text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function SubNavItem({
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
      className={`block pl-9 pr-2.5 py-1.5 rounded-md text-[13px] ${
        active
          ? "bg-blue-50 text-blue-800 font-medium"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      }`}
    >
      {label}
    </Link>
  );
}

function NavCollapse({
  label,
  glyph,
  open,
  onToggle,
  hasActive,
  children,
}: {
  label: string;
  glyph?: string;
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
        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm ${
          hasActive
            ? "text-blue-800 font-medium"
            : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        {glyph ? (
          <span className="w-4 text-center text-gray-500" aria-hidden>
            {glyph}
          </span>
        ) : null}
        <span className="flex-1 text-left truncate">{label}</span>
        <span
          className={`text-gray-400 transition-transform ${
            open ? "rotate-90" : ""
          }`}
          aria-hidden
        >
          ›
        </span>
      </button>
      {open ? <div className="mt-0.5 space-y-0.5">{children}</div> : null}
    </div>
  );
}

function NavDivider({ label }: { label: string }) {
  return (
    <div className="mt-4 mb-1 px-4 text-[10px] uppercase tracking-wide text-gray-400">
      {label}
    </div>
  );
}

function CollapsedNavIcon({
  href,
  label,
  glyph,
  active,
  badge,
}: {
  href: string;
  label: string;
  glyph: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      title={label}
      className={`relative w-9 h-9 rounded-md flex items-center justify-center mb-1 text-lg ${
        active
          ? "bg-blue-50 text-blue-700"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      }`}
    >
      <span aria-hidden>{glyph}</span>
      {badge ? (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white text-[10px] font-medium flex items-center justify-center">
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
