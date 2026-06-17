import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

function parseDay(value: string | null, fallback: Date) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return fallback.toISOString().slice(0, 10);
}

function dayToUnixStart(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, date, -8) / 1000);
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const now = new Date();
    const defaultEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const defaultStart = new Date(defaultEnd);
    defaultStart.setUTCDate(defaultStart.getUTCDate() - 6);

    const startDay = parseDay(url.searchParams.get("start"), defaultStart);
    const endDay = parseDay(url.searchParams.get("end"), defaultEnd);
    const startUnix = dayToUnixStart(startDay);
    const endUnix = dayToUnixStart(endDay) + 24 * 60 * 60;

    const db = getDb();
    const users = db
      .prepare(
        `SELECT id, username, display_name, role
         FROM users
         WHERE role <> 'admin'
         ORDER BY id ASC`,
      )
      .all();

    const aiByDay = db
      .prepare(
        `SELECT date(j.created_at, 'unixepoch', '+8 hours') AS day,
                COUNT(*) AS ai_count
         FROM render_jobs j
         LEFT JOIN users u ON u.id = j.user_id
         WHERE j.created_at >= ? AND j.created_at < ?
           AND COALESCE(u.role, 'user') <> 'admin'
         GROUP BY day
         ORDER BY day ASC`,
      )
      .all(startUnix, endUnix);

    const urlByDay = db
      .prepare(
        `SELECT date(j.created_at, 'unixepoch', '+8 hours') AS day,
                COUNT(*) AS url_count
         FROM url_capture_jobs j
         LEFT JOIN users u ON u.id = j.user_id
         WHERE j.created_at >= ? AND j.created_at < ?
           AND COALESCE(u.role, 'user') <> 'admin'
         GROUP BY day
         ORDER BY day ASC`,
      )
      .all(startUnix, endUnix);

    const urlByUserDay = db
      .prepare(
        `SELECT date(j.created_at, 'unixepoch', '+8 hours') AS day,
                j.user_id,
                u.username,
                u.display_name,
                COUNT(*) AS url_count,
                MAX(j.created_at) AS latest_at
         FROM url_capture_jobs j
         LEFT JOIN users u ON u.id = j.user_id
         WHERE j.created_at >= ? AND j.created_at < ?
           AND COALESCE(u.role, 'user') <> 'admin'
         GROUP BY day, j.user_id
         ORDER BY day DESC, url_count DESC, j.user_id ASC`,
      )
      .all(startUnix, endUnix);

    const aiByUserDay = db
      .prepare(
        `SELECT date(j.created_at, 'unixepoch', '+8 hours') AS day,
                j.user_id,
                u.username,
                u.display_name,
                COUNT(*) AS ai_count,
                MAX(j.created_at) AS latest_at
         FROM render_jobs j
         LEFT JOIN users u ON u.id = j.user_id
         WHERE j.created_at >= ? AND j.created_at < ?
           AND COALESCE(u.role, 'user') <> 'admin'
         GROUP BY day, j.user_id
         ORDER BY day DESC, ai_count DESC, j.user_id ASC`,
      )
      .all(startUnix, endUnix);

    const aiRecords = db
      .prepare(
        `SELECT j.id,
                j.user_id,
                u.username,
                u.display_name,
                j.feature,
                j.model,
                j.status,
                j.total_count,
                j.completed_count,
                j.failed_count,
                j.total_cost_cny,
                j.params,
                j.created_at,
                j.started_at,
                j.finished_at,
                date(j.created_at, 'unixepoch', '+8 hours') AS day,
                (
                  SELECT i.result_image_url
                  FROM render_job_items i
                  WHERE i.job_id = j.id AND i.status = 'completed'
                  ORDER BY i.idx ASC
                  LIMIT 1
                ) AS cover_image_url
         FROM render_jobs j
         LEFT JOIN users u ON u.id = j.user_id
         WHERE j.created_at >= ? AND j.created_at < ?
           AND COALESCE(u.role, 'user') <> 'admin'
         ORDER BY j.created_at DESC`,
      )
      .all(startUnix, endUnix);

    const urlRecords = db
      .prepare(
        `SELECT j.id,
                j.user_id,
                u.username,
                u.display_name,
                j.source,
                j.source_label,
                j.source_url,
                j.source_host,
                j.status,
                j.selected_count,
                j.saved_count,
                j.created_at,
                date(j.created_at, 'unixepoch', '+8 hours') AS day,
                (
                  SELECT i.media_url
                  FROM url_capture_items i
                  WHERE i.job_id = j.id
                  ORDER BY i.idx ASC
                  LIMIT 1
                ) AS thumbnail_url
         FROM url_capture_jobs j
         LEFT JOIN users u ON u.id = j.user_id
         WHERE j.created_at >= ? AND j.created_at < ?
           AND COALESCE(u.role, 'user') <> 'admin'
         ORDER BY j.created_at DESC`,
      )
      .all(startUnix, endUnix) as Array<{ id: string }>;

    const urlItems = db
      .prepare(
        `SELECT job_id, image_url, media_url
         FROM url_capture_items
         WHERE job_id IN (
           SELECT id
           FROM url_capture_jobs
           WHERE created_at >= ? AND created_at < ?
         )
         ORDER BY job_id ASC, idx ASC`,
      )
      .all(startUnix, endUnix) as Array<{
        job_id: string;
        image_url: string;
        media_url: string;
      }>;
    const urlItemMap = new Map<string, Array<{ image_url: string; media_url: string }>>();
    for (const item of urlItems) {
      const list = urlItemMap.get(item.job_id) || [];
      list.push({ image_url: item.image_url, media_url: item.media_url });
      urlItemMap.set(item.job_id, list);
    }
    const urlRecordsWithItems = urlRecords.map((record) => ({
      ...record,
      items: urlItemMap.get(record.id) || [],
    }));

    return NextResponse.json({
      start: startDay,
      end: endDay,
      users,
      urlByDay,
      urlByUserDay,
      urlRecords: urlRecordsWithItems,
      aiByDay,
      aiByUserDay,
      aiRecords,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
