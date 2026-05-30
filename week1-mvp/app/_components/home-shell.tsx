"use client";

import { useEffect, useState } from "react";
import { AppShell } from "./app-shell";

type NavUser = {
  id: number;
  username: string;
  display_name: string | null;
  role: "admin" | "user";
};

/**
 * 首页专用的 AppShell 壳子（客户端组件）
 *
 * 首页是服务端组件，不能直接用 AppShell。用这个 wrapper 来套。
 * 右栏留空（首页没有任务进度 / 参数配置）。
 *
 * 顺便拉一下当前活跃任务数，显示在左栏徽标。
 */
export function HomeShell({
  user,
  children,
}: {
  user: NavUser;
  children: React.ReactNode;
}) {
  const [activeJobCount, setActiveJobCount] = useState(0);

  useEffect(() => {
    fetch("/api/jobs/active")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => setActiveJobCount(d.count || 0))
      .catch(() => {});
  }, []);

  return (
    <AppShell leftNav={{ user, activeJobCount }}>{children}</AppShell>
  );
}
