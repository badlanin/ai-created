import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

type FeatureFilter =
  | "all"
  | "recolor"
  | "batch_photo"
  | "identity_gen"
  | "scene_tools";

const ALLOWED_FEATURES: ReadonlyArray<Exclude<FeatureFilter, "all">> = [
  "recolor",
  "batch_photo",
  "identity_gen",
  "scene_tools",
];
type StatusFilter = "all" | "active" | "completed" | "failed" | "canceled";

/**
 * GET /api/jobs/list?status=active|completed|failed|canceled|all&feature=recolor|batch_photo|all&scope=me|all&page=1&limit=20
 *
 * 返回 render_jobs 表的 job 列表（可按状态 / 功能类型过滤）。
 * 同时附带每个 job 的成功 item 数 / 首张缩略图等汇总信息。
 *
 * 用于新版 /history 页的 Tab 式列表。
 */
export async function GET(req: NextRequest) {
  const user = await requireUser();
  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "all") as StatusFilter;
  const featureRaw = url.searchParams.get("feature") || "all";
  const feature: FeatureFilter =
    featureRaw === "all"
      ? "all"
      : ALLOWED_FEATURES.includes(featureRaw as Exclude<FeatureFilter, "all">)
        ? (featureRaw as FeatureFilter)
        : "all";
  const scope = url.searchParams.get("scope") || "me";
  const showAll = scope === "all" && user.role === "admin";
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") || "20")),
  );

  const db = getDb();

  const where: string[] = [];
  const vals: Array<string | number> = [];
  if (!showAll) {
    where.push("j.user_id = ?");
    vals.push(user.id);
  }
  if (status === "active") {
    where.push("j.status IN ('running','canceling')");
  } else if (status === "completed") {
    where.push("j.status = 'completed'");
  } else if (status === "failed") {
    where.push("j.status = 'failed'");
  } else if (status === "canceled") {
    where.push("j.status = 'canceled'");
  }
  if (feature !== "all") {
    where.push("j.feature = ?");
    vals.push(feature);
  }
  const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";

  const countRow = db
    .prepare(`SELECT COUNT(*) AS c FROM render_jobs j ${whereClause}`)
    .get(...vals) as { c: number };

  const rows = db
    .prepare(
      `SELECT j.*, u.username, u.display_name
       FROM render_jobs j
       LEFT JOIN users u ON u.id = j.user_id
       ${whereClause}
       ORDER BY j.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...vals, limit, (page - 1) * limit) as Array<{
    id: string;
    user_id: number;
    username: string | null;
    display_name: string | null;
    feature: string;
    model: string;
    status: string;
    total_count: number;
    completed_count: number;
    failed_count: number;
    canceled_count: number;
    total_cost_cny: number;
    params: string | null;
    error_message: string | null;
    created_at: number;
    started_at: number | null;
    finished_at: number | null;
  }>;

  // 每个 job 取首张成功 item 作为封面缩略图
  const coversStmt = db.prepare(
    `SELECT result_image_url FROM render_job_items
     WHERE job_id = ? AND status = 'completed'
     ORDER BY idx ASC LIMIT 1`,
  );
  const items = rows.map((r) => {
    const cover = coversStmt.get(r.id) as
      | { result_image_url: string | null }
      | undefined;
    return {
      ...r,
      cover_image_url: cover?.result_image_url || null,
    };
  });

  // 各状态计数（给 tab 角标）
  const statsWhere = [] as string[];
  const statsVals = [] as Array<string | number>;
  if (!showAll) {
    statsWhere.push("user_id = ?");
    statsVals.push(user.id);
  }
  if (feature !== "all") {
    statsWhere.push("feature = ?");
    statsVals.push(feature);
  }
  const statsWhereClause = statsWhere.length
    ? "WHERE " + statsWhere.join(" AND ")
    : "";
  const stats = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('running','canceling') THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END) AS canceled,
         COUNT(*) AS total
       FROM render_jobs ${statsWhereClause}`,
    )
    .get(...statsVals) as {
    active: number | null;
    completed: number | null;
    failed: number | null;
    canceled: number | null;
    total: number | null;
  };

  return NextResponse.json({
    items,
    page,
    limit,
    total: countRow.c,
    showing_all: showAll,
    stats: {
      active: stats.active ?? 0,
      completed: stats.completed ?? 0,
      failed: stats.failed ?? 0,
      canceled: stats.canceled ?? 0,
      total: stats.total ?? 0,
    },
  });
}
