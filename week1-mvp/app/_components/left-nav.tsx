"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Home, Palette, Camera, History as HistoryIcon, Wallet, Library,
  Settings, ChevronRight, PanelLeftClose, PanelLeftOpen, LogOut,
  Loader2, Layers
} from "lucide-react";

type NavUser = {
  id: number; username: string; display_name: string | null; role: "admin" | "user";
};

export interface RecentHistoryItem {
  id: string | number; title: string; timestamp: number; href: string;
}

export interface LeftNavProps {
  user: NavUser; collapsed?: boolean; recentHistory?: RecentHistoryItem[];
  onToggleCollapse?: () => void; activeJobCount?: number;
}

export function LeftNav({
  user, collapsed = false, recentHistory = [], onToggleCollapse, activeJobCount = 0,
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

  const libraryPaths = useMemo(() => [
    "/admin/colors", "/admin/materials", "/admin/realism", "/admin/models",
    "/admin/scenes", "/admin/poses", "/admin/photography", "/admin/prompts", "/admin/ai-models",
  ], []);
  const libraryExpanded = useMemo(() => libraryPaths.some((p) => isActive(p)), [pathname]);
  const [libraryOpen, setLibraryOpen] = useState(libraryExpanded);
  useEffect(() => { if (libraryExpanded) setLibraryOpen(true); }, [libraryExpanded]);

  const adminPaths = ["/admin/users", "/admin/billing", "/admin/model-prices", "/admin/announcements", "/admin/settings"];
  const adminExpanded = adminPaths.some((p) => isActive(p));
  const [adminOpen, setAdminOpen] = useState(adminExpanded);
  useEffect(() => { if (adminExpanded) setAdminOpen(true); }, [adminExpanded]);

  const displayName = user.display_name || user.username;

  /* ═════════════ 折叠态 ═════════════ */
  if (collapsed) {
    return (
      <aside className="h-full flex flex-col items-center py-3 flex-shrink-0"
        style={{ width: '56px', background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-subtle)' }}>
        <button onClick={onToggleCollapse}
          className="w-9 h-9 rounded-lg flex items-center justify-center mb-4 transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
          aria-label="展开侧边栏">
          <PanelLeftOpen size={16} strokeWidth={2} />
        </button>

        {activeJobCount > 0 ? (
          <Link href="/history?status=active"
            className="relative w-9 h-9 rounded-lg flex items-center justify-center mb-2"
            style={{ background: 'rgba(59, 130, 246, 0.15)', color: 'var(--primary)' }}>
            <Loader2 size={16} strokeWidth={2.2} className="animate-spin" />
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-semibold flex items-center justify-center"
              style={{ background: 'var(--primary)' }}>{activeJobCount}</span>
          </Link>
        ) : null}

        <CollapsedIcon href="/" label="首页" Icon={Home} active={isActive("/")} />
        <CollapsedIcon href="/recolor" label="换色" Icon={Palette} active={isActive("/recolor")} />
        <CollapsedIcon href="/batch-photo" label="批量摄影" Icon={Camera} active={isActive("/batch-photo")} />
        <CollapsedIcon href="/history" label="历史" Icon={HistoryIcon} active={isActive("/history")} />
        <CollapsedIcon href="/billing" label="账单" Icon={Wallet} active={isActive("/billing")} />
      </aside>
    );
  }

  /* ═════════════ 展开态 - 深色主题 ═════════════ */
  return (
    <aside className="h-full flex flex-col flex-shrink-0"
      style={{ width: '240px', background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-subtle)' }}>
      {/* 顶部：品牌 + 折叠 */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <Link href="/"
          className="font-semibold truncate text-[15px] tracking-tight"
          style={{ color: 'var(--text-primary)' }}>
          服装AI生图工具
        </Link>
        <div className="flex items-center gap-1">
          {activeJobCount > 0 ? (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-white"
              style={{ background: 'var(--primary)' }}>{activeJobCount}</span>
          ) : null}
          {onToggleCollapse ? (
            <button onClick={onToggleCollapse}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
              style={{ color: 'var(--text-tertiary)' }} aria-label="折叠">
              <PanelLeftClose size={14} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {/* 进行中任务 */}
        {activeJobCount > 0 ? (
          <div className="px-2 mb-2">
            <Link href="/history?status=active"
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors"
              style={{
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                color: 'var(--text-primary)',
              }}>
              <span className="relative inline-flex">
                <Loader2 size={16} strokeWidth={2.2} className="text-blue-400 animate-spin" />
              </span>
              <span className="flex-1 text-[13px] font-medium truncate">{activeJobCount} 个任务进行中</span>
              <ChevronRight size={14} strokeWidth={2} className="text-blue-400" />
            </Link>
          </div>
        ) : null}

        <div className="px-2 space-y-0.5">
          <NavItem href="/" Icon={Home} label="首页" active={isActive("/")} />
          <NavItem href="/recolor" Icon={Palette} label="HEX 换色" active={isActive("/recolor")} />
          <NavItem href="/batch-photo" Icon={Camera} label="批量摄影图" active={isActive("/batch-photo")} />
          <NavItem href="/history" Icon={HistoryIcon} label="历史记录" active={isActive("/history")} />
          <NavItem href="/billing" Icon={Wallet} label="我的账单" active={isActive("/billing")} />
        </div>

        {user.role === "admin" ? (
          <>
            <Divider label="素材" />
            <Collapsible label="素材管理" Icon={Library} open={libraryOpen}
              onToggle={() => setLibraryOpen((v) => !v)} hasActive={libraryExpanded}>
              <SubItem href="/admin/colors" label="颜色库" active={isActive("/admin/colors")} />
              <SubItem href="/admin/materials" label="材质库" active={isActive("/admin/materials")} />
              <SubItem href="/admin/realism" label="真实感" active={isActive("/admin/realism")} />
              <SubItem href="/admin/models" label="模特库" active={isActive("/admin/models")} />
              <SubItem href="/admin/scenes" label="场景库" active={isActive("/admin/scenes")} />
              <SubItem href="/admin/poses" label="姿势库" active={isActive("/admin/poses")} />
              <SubItem href="/admin/photography" label="摄影参数" active={isActive("/admin/photography")} />
              <SubItem href="/admin/prompts" label="Prompt 库" active={isActive("/admin/prompts")} />
              <SubItem href="/admin/ai-models" label="AI 模型" active={isActive("/admin/ai-models")} />
            </Collapsible>

            <Divider label="管理" />
            <Collapsible label="团队管理" Icon={Settings} open={adminOpen}
              onToggle={() => setAdminOpen((v) => !v)} hasActive={adminExpanded}>
              <SubItem href="/admin/users" label="用户管理" active={isActive("/admin/users")} />
              <SubItem href="/admin/billing" label="团队账单" active={isActive("/admin/billing")} />
              <SubItem href="/admin/model-prices" label="单价/汇率" active={isActive("/admin/model-prices")} />
              <SubItem href="/admin/announcements" label="公告栏" active={isActive("/admin/announcements")} />
              <SubItem href="/admin/settings" label="系统设置" active={isActive("/admin/settings")} />
            </Collapsible>
          </>
        ) : null}

        {recentHistory.length > 0 ? (
          <>
            <Divider label="最近记录" />
            <div className="px-2 space-y-0.5">
              {recentHistory.slice(0, 5).map((item) => (
                <Link key={item.id} href={item.href}
                  className="block px-2 py-1.5 rounded-md transition-colors group"
                  title={item.title}>
                  <div className="text-[12px] truncate group-hover:text-white" style={{ color: 'var(--text-secondary)' }}>{item.title}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{formatRelativeTime(item.timestamp)}</div>
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </nav>

      {/* 底部用户信息 */}
      <div className="px-3 py-2.5 flex items-center gap-2.5"
        style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-semibold flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--primary), var(--brand-400))' }}>
          {displayName.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] truncate font-medium leading-tight" style={{ color: 'var(--text-primary)' }}>{displayName}</div>
          {user.role === "admin" ? (
            <div className="text-[10px] leading-tight" style={{ color: 'var(--warn-500)' }}>管理员</div>
          ) : (
            <div className="text-[10px] leading-tight" style={{ color: 'var(--text-tertiary)' }}>成员</div>
          )}
        </div>
        <button onClick={handleLogout}
          className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
          style={{ color: 'var(--text-tertiary)' }} title="退出登录">
          <LogOut size={14} strokeWidth={2} />
        </button>
      </div>
    </aside>
  );
}

/* ═════════════ 内部小件 - 深色主题 ═════════════ */
interface NavIconProps {
  size?: number; strokeWidth?: number; className?: string;
}
type IconCmp = React.ComponentType<NavIconProps>;

function NavItem({ href, Icon, label, active, badge }: {
  href: string; Icon: IconCmp; label: string; active: boolean; badge?: string;
}) {
  return (
    <Link href={href}
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors"
      style={{
        background: active ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
        color: active ? 'var(--primary)' : 'var(--text-secondary)',
        fontWeight: active ? 500 : 400,
      }}>
      <Icon size={16} strokeWidth={active ? 2.2 : 1.8} style={{ color: active ? 'var(--primary)' : 'var(--text-tertiary)' }} />
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
          style={{ background: 'var(--primary)', color: '#fff' }}>{badge}</span>
      ) : null}
    </Link>
  );
}

function SubItem({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href}
      className="block pl-10 pr-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors"
      style={{
        background: active ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
        color: active ? 'var(--primary)' : 'var(--text-tertiary)',
        fontWeight: active ? 500 : 400,
      }}>
      {label}
    </Link>
  );
}

function Collapsible({ label, Icon, open, onToggle, hasActive, children }: {
  label: string; Icon: IconCmp; open: boolean; onToggle: () => void; hasActive: boolean; children: React.ReactNode;
}) {
  return (
    <div className="px-2">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors"
        style={{
          background: open ? 'rgba(255,255,255,0.03)' : 'transparent',
          color: hasActive ? 'var(--primary)' : 'var(--text-secondary)',
        }}>
        <Icon size={16} strokeWidth={hasActive ? 2.2 : 1.8} style={{ color: hasActive ? 'var(--primary)' : 'var(--text-tertiary)' }} />
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronRight size={14} strokeWidth={2}
          className="transition-transform duration-200"
          style={{ color: 'var(--text-tertiary)', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }} />
      </button>
      {open ? <div className="mt-0.5 space-y-0.5">{children}</div> : null}
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="mt-5 mb-1.5 px-4 text-[10px] uppercase tracking-wider font-medium"
      style={{ color: 'var(--text-tertiary)' }}>{label}</div>
  );
}

function CollapsedIcon({ href, label, Icon, active, badge }: {
  href: string; label: string; Icon: IconCmp; active: boolean; badge?: number;
}) {
  return (
    <Link href={href} title={label}
      className="relative w-9 h-9 rounded-lg flex items-center justify-center mb-1 transition-colors"
      style={{
        background: active ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
        color: active ? 'var(--primary)' : 'var(--text-tertiary)',
      }}>
      <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
      {badge ? (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-semibold flex items-center justify-center"
          style={{ background: 'var(--primary)' }}>{badge}</span>
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
