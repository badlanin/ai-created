"use client";

import { useEffect, useState } from "react";

export interface CurrentUser {
  id: number;
  username: string;
  display_name: string | null;
  role: "admin" | "user";
}

/**
 * 客户端获取当前登录用户
 *
 * 第一次渲染 null，然后拉 /api/auth/me 回来填充。
 * 未登录时抛错（实际上 middleware 已经拦截，组件不会渲染到）。
 */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        if (data && typeof data === "object" && "id" in data) {
          setUser(data as CurrentUser);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return user;
}
