import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * ⚠️ 已废弃：请使用 POST /api/jobs/recolor
 *
 * 新的异步版会立即返回 job_id，然后通过 GET /api/jobs/:id 轮询状态。
 * 参数格式完全兼容（formData + image0/color_ids/model 等）。
 *
 * 2026-04 起 P3-1 批次 D 完成后，前端已经全面切换到异步版。
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "/api/recolor 已废弃，请使用 POST /api/jobs/recolor。响应为 { job_id } 后通过 GET /api/jobs/:id 轮询进度。",
      migrated_to: "/api/jobs/recolor",
    },
    { status: 410 }, // Gone
  );
}

export async function GET() {
  return NextResponse.json(
    {
      error:
        "/api/recolor 已废弃，请使用 POST /api/jobs/recolor + GET /api/jobs/:id",
      migrated_to: "/api/jobs/recolor",
    },
    { status: 410 },
  );
}
