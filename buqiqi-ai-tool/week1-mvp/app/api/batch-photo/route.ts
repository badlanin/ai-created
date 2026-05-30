import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * ⚠️ 已废弃：请使用 POST /api/jobs/batch-photo
 *
 * 新的异步版会立即返回 job_id，然后通过 GET /api/jobs/:id 轮询状态。
 * 参数格式完全兼容（formData + product_image0/identity_id/pose_ids 等）。
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "/api/batch-photo 已废弃，请使用 POST /api/jobs/batch-photo。响应为 { job_id } 后通过 GET /api/jobs/:id 轮询进度。",
      migrated_to: "/api/jobs/batch-photo",
    },
    { status: 410 },
  );
}

export async function GET() {
  return NextResponse.json(
    {
      error:
        "/api/batch-photo 已废弃，请使用 POST /api/jobs/batch-photo + GET /api/jobs/:id",
      migrated_to: "/api/jobs/batch-photo",
    },
    { status: 410 },
  );
}
