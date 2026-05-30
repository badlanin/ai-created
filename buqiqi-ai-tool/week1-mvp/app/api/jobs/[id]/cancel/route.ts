import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getJob, markJobCanceling } from "@/lib/jobs-db";

export const runtime = "nodejs";

/**
 * POST /api/jobs/:id/cancel
 *
 * 把 job 标记为 canceling。worker 下次取 item 前会检测到并终止，
 * 剩余 item 标为 canceled。
 *
 * 正在 Google 那边生成的那 1-2 张无法中断，会正常完成并计费。
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const { id } = await params;

  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  if (job.user_id !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "无权取消该任务" }, { status: 403 });
  }

  if (job.status !== "running") {
    return NextResponse.json(
      { error: `任务已是 ${job.status} 状态，无需取消` },
      { status: 400 },
    );
  }

  const ok = markJobCanceling(id);
  return NextResponse.json({
    ok,
    job_id: id,
    message: ok
      ? "已发出取消指令。正在飞的请求会自然完成，队列中的任务将被跳过。"
      : "标记失败，可能任务已终结",
  });
}
