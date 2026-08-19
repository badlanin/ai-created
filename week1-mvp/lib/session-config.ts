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
  shopifyOAuth?: {
    state: string;
    shopDomain: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    userId: number;
    deviceId: string;
    createdAt: number;
  };
  newProductListingShopifyOAuth?: {
    state: string;
    shopDomain: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    userId: number;
    deviceId: string;
    createdAt: number;
  };
}

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "dev-session-secret-please-change-in-production-minimum-32-chars";

const allowInsecureCookies =
  process.env.ALLOW_INSECURE_COOKIES === "1" ||
  process.env.ALLOW_INSECURE_COOKIES === "true";

export const sessionOptions: SessionOptions = {
  password: SESSION_SECRET,
  cookieName: "buqiqi_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production" && !allowInsecureCookies,
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 天
  },
};
