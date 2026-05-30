"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "./app-shell";
import { AnnouncementBar } from "./announcement-bar";

type NavUser = {
  id: number;
  username: string;
  display_name: string | null;
  role: "admin" | "user";
};

/**
 * 全局 Shell 包装：让"所有登录后的页面"自动拿到左栏。
 *
 * 路由策略：
 *   - /login、/register             → 不套 shell（原样透传 children）
 *   - /、/recolor、/batch-photo     → 页面自己已经渲染了 AppShell（带 rightPanel），透传
 *   - 其他所有页面（/history /billing /admin/* 等）→ 这里自动套 AppShell（2 栏布局）
 *
 * 这样 /history /billing /admin/* 等页面不用单独改就自动拥有左栏导航。
 */

const NO_SHELL_EXACT = new Set(["/login", "/register"]);
const PAGE_PROVIDES_SHELL_EXACT = new Set(["/", "/recolor", "/batch-photo"]);
const PAGE_PROVIDES_SHELL_PREFIX = ["/recolor/", "/batch-photo/"];

export function GlobalShell({
  user,
  children,
}: {
  user: NavUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "/";
  const [activeJobCount, setActiveJobCount] = useState(0);

  // 拉活跃任务数（左栏徽标）
  useEffect(() => {
    if (NO_SHELL_EXACT.has(pathname)) return;
    let alive = true;
    fetch("/api/jobs/active")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => {
        if (alive) setActiveJobCount(d.count || 0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname]);

  // 不套 shell（登录页）
  if (NO_SHELL_EXACT.has(pathname)) return <>{children}</>;

  // 页面自己已经渲染 AppShell —— 透传，但仍然渲染公告栏在最顶
  if (
    PAGE_PROVIDES_SHELL_EXACT.has(pathname) ||
    PAGE_PROVIDES_SHELL_PREFIX.some((p) => pathname.startsWith(p))
  ) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <AnnouncementBar />
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    );
  }

  // 其他页面自动套 AppShell（2 栏）+ 顶部公告
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <AnnouncementBar />
      <div className="flex-1 min-h-0">
        <AppShell leftNav={{ user, activeJobCount }}>{children}</AppShell>
      </div>
    </div>
  );
}
