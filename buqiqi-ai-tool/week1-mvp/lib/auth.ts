import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import bcrypt from "bcryptjs";
import { getDb } from "./db";
import { sessionOptions, SessionData } from "./session-config";

export { sessionOptions };
export type { SessionData };

export type User = {
  id: number;
  username: string;
  display_name: string | null;
  role: "admin" | "user";
  created_at: number;
};

if (
  process.env.NODE_ENV === "production" &&
  (!process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.startsWith("dev-session-secret"))
) {
  console.warn(
    "[auth] 警告：生产环境未配置 SESSION_SECRET！请在 .env 里设置一个 32+ 字符的随机串",
  );
}

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/**
 * 获取当前登录用户。未登录返回 null。
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session.userId) return null;

  const db = getDb();
  const user = db
    .prepare(
      "SELECT id, username, display_name, role, created_at FROM users WHERE id = ?",
    )
    .get(session.userId) as User | undefined;

  return user ?? null;
}

/**
 * 要求管理员身份；不是则抛 401/403
 */
export async function requireAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    const err = new Error("未登录");
    (err as { status?: number }).status = 401;
    throw err;
  }
  if (user.role !== "admin") {
    const err = new Error("需要管理员权限");
    (err as { status?: number }).status = 403;
    throw err;
  }
  return user;
}

/**
 * 要求任意已登录用户
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    const err = new Error("未登录");
    (err as { status?: number }).status = 401;
    throw err;
  }
  return user;
}

/**
 * 密码哈希工具
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, 10);
}

export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * 首次启动时，如果数据库里一个用户都没有，
 * 就根据 .env 里的 INITIAL_ADMIN_USERNAME/PASSWORD 创建一个管理员账号。
 *
 * 这个函数应该在任何需要鉴权的 API 路由之前（以及登录页渲染之前）被调用一次。
 */
let _initialAdminEnsured = false;
export async function ensureInitialAdmin() {
  if (_initialAdminEnsured) return;
  const db = getDb();

  const row = db.prepare("SELECT COUNT(*) as n FROM users").get() as {
    n: number;
  };
  if (row.n > 0) {
    _initialAdminEnsured = true;
    return;
  }

  const username = process.env.INITIAL_ADMIN_USERNAME;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn(
      "[auth] 数据库里还没有任何用户，且 .env 未配置 INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD，无法登录。请补齐后重启。",
    );
    return;
  }

  const hash = await hashPassword(password);
  db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'admin')",
  ).run(username, hash, username);

  console.log(`[auth] 已创建初始管理员账号: ${username}`);
  _initialAdminEnsured = true;
}
