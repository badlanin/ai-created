import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/session-config";

/**
 * 全站路由保护：
 * - 未登录 → 跳 /login
 * - /api/auth/* 公开
 * - 静态资源、登录页、favicon 公开
 *
 * 注意：middleware 运行在 Edge Runtime，不能 import Node-only 模块（如 better-sqlite3、bcryptjs）。
 * 所以只从 lib/session-config 读 session，不访问数据库。
 */

const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health",
  "/favicon.ico",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);

  if (!session.userId) {
    // API 请求返回 401；页面请求跳 /login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  // 匹配除静态资源外所有路径
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
