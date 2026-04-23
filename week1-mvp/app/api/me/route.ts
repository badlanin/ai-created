import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/me
 * 返回当前登录用户信息（供前端判断角色 / 展示）
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  return NextResponse.json({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
  });
}
