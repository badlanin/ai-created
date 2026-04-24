import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { requireUser } from "@/lib/auth";
import { getJobWithItems, getJob, getJobItems } from "@/lib/jobs-db";
import { peekNextTokenAtMs } from "@/lib/rate-limiter";
import { getDb, DATA_DIR_PATH } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/jobs/:id
 *
 * 返回当前 job 的所有 item 状态，供前端轮询（默认 1.5s）。
 *
 * 响应：
 *   {
 *     job: { id, status, total_count, completed_count, failed_count, ... },
 *     items: [{ idx, status, label, result_image_url, cost_cny, ... }, ...],
 *     next_token_eta_ms: 1234,   // 下个 token 剩余等待毫秒（仅当有 waiting_quota 时有意义）
 *     server_time_ms: Date.now() // 让前端校对时钟
 *   }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const { id } = await params;

  const data = getJobWithItems(id);
  if (!data) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  // 不是自己的任务也不是 admin 则拒绝
  if (data.job.user_id !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }

  // 对于 waiting_quota 状态的 item，算出下个 token 什么时候可用
  const nextTokenReadyAtMs = peekNextTokenAtMs(data.job.model);
  const nextTokenEtaMs = Math.max(0, nextTokenReadyAtMs - Date.now());

  return NextResponse.json({
    job: data.job,
    items: data.items,
    next_token_eta_ms: nextTokenEtaMs,
    next_token_ready_at_ms: nextTokenReadyAtMs,
    server_time_ms: Date.now(),
  });
}

/**
 * DELETE /api/jobs/:id
 *
 * 删除任务 + 对应 items + 对应 generations（如果已写入）+ 磁盘文件
 * 非 admin 只能删自己的
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const job = getJob(id);
    if (!job) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }
    if (job.user_id !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "无权删除该任务" }, { status: 403 });
    }

    // 收集要删除的图片路径（用来后台删盘）
    const items = getJobItems(id);
    const toDelete: string[] = [];
    for (const it of items) {
      if (it.result_image_url && it.result_image_url.startsWith("/assets/")) {
        toDelete.push(it.result_image_url);
      }
    }

    // 删 DB（items 随 foreign key CASCADE 自动删）
    const db = getDb();
    db.prepare(`DELETE FROM render_jobs WHERE id = ?`).run(id);

    // 顺便删 generations 里这个 job 写的那条（如果有）
    // params 是 JSON 字符串包含 job_id。用 JSON 搜索 api 匹配
    db.prepare(
      `DELETE FROM generations WHERE json_extract(params, '$.job_id') = ?`,
    ).run(id);

    // 异步删文件（不阻塞响应）
    void (async () => {
      for (const url of toDelete) {
        const rel = url.slice("/assets/".length);
        try {
          await fs.unlink(path.join(DATA_DIR_PATH, rel));
        } catch {}
      }
    })();

    return NextResponse.json({
      deleted: 1,
      removed_files: toDelete.length,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
