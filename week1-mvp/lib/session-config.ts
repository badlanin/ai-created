import type { SessionOptions } from "iron-session";

/**
 * iron-session 配置
 *
 * 单独拆出来是为了在 Edge runtime (middleware) 里也能用，
 * 因为 lib/auth.ts 会 import bcryptjs / better-sqlite3（Node-only）。
 */

export interface SessionData {
  userId?: number;
  username?: string;
  role?: "admin" | "user";
  loggedInAt?: number;
}

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "dev-session-secret-please-change-in-production-minimum-32-chars";

export const sessionOptions: SessionOptions = {
  password: SESSION_SECRET,
  cookieName: "buqiqi_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 天
  },
};
