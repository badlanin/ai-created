"use client";

import { usePathname } from "next/navigation";
import { NavBar } from "./nav-bar";

type NavUser = {
  id: number;
  username: string;
  display_name: string | null;
  role: "admin" | "user";
};

/**
 * 条件渲染顶部横向导航栏
 *
 * 用 AppShell 左栏导航的页面不显示顶部 NavBar；其他页面（老界面）继续用。
 *
 * 规则：
 *   - / （首页）         → AppShell（通过 HomeShell 客户端包装）
 *   - /recolor          → AppShell
 *   - /batch-photo      → AppShell
 *   - 其他（/history /billing /admin/*）→ 保持旧顶部 NavBar
 */
const APP_SHELL_EXACT = new Set(["/", "/recolor", "/batch-photo"]);
const APP_SHELL_PREFIXES = ["/recolor/", "/batch-photo/"];

export function ConditionalNav({ user }: { user: NavUser }) {
  const pathname = usePathname() || "/";
  const isAppShell =
    APP_SHELL_EXACT.has(pathname) ||
    APP_SHELL_PREFIXES.some((p) => pathname.startsWith(p));
  if (isAppShell) return null;
  return <NavBar user={user} />;
}
