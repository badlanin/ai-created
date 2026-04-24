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
 * 三栏布局的页面（/recolor 和 /batch-photo）用 AppShell 的左栏导航，
 * 不需要顶部横向 NavBar。其他所有页面继续沿用旧的顶部 NavBar。
 */
const THREE_COLUMN_PREFIXES = ["/recolor", "/batch-photo"];

export function ConditionalNav({ user }: { user: NavUser }) {
  const pathname = usePathname() || "/";
  const isThreeColumn = THREE_COLUMN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (isThreeColumn) return null;
  return <NavBar user={user} />;
}
