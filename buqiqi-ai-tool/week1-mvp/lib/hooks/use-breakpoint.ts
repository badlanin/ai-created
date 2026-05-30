"use client";

import { useEffect, useState } from "react";

/**
 * SSR 安全的媒体查询钩子
 *
 * @param query 标准 CSS media query，比如 "(max-width: 1280px)"
 * @returns 是否匹配。SSR 期间固定返回 false，避免 hydration mismatch。
 *
 * @example
 *   const isNarrow = useMediaQuery("(max-width: 1280px)");
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // 初始化
    // 兼容老浏览器（Safari < 14 用 addListener）
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    } else {
      // 老 Safari 走 deprecated 接口
      (mql as MediaQueryList & {
        addListener: (cb: () => void) => void;
        removeListener: (cb: () => void) => void;
      }).addListener(onChange);
      return () => {
        (mql as MediaQueryList & {
          addListener: (cb: () => void) => void;
          removeListener: (cb: () => void) => void;
        }).removeListener(onChange);
      };
    }
  }, [query]);

  return matches;
}

/** 屏幕宽度 < 1280px（左栏自动折叠断点） */
export function useIsNarrowScreen(): boolean {
  return useMediaQuery("(max-width: 1279px)");
}
