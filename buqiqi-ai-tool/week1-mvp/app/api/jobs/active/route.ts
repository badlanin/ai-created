import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listActiveJobsForUser } from "@/lib/jobs-db";

export const runtime = "nodejs";

/**
 * GET /api/jobs/active
 *
 * 列出当前用户所有"正在进行中"的任务。左栏顶部徽标 +
 * 右栏进度看板会用。
 */
export async function GET() {
  const user = await requireUser();
  const jobs = listActiveJobsForUser(user.id);
  return NextResponse.json({
    count: jobs.length,
    jobs,
  });
}
