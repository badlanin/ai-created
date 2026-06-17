import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

type CaptureImage = {
  imageUrl?: string;
  mediaUrl?: string;
};

function sourceHost(sourceUrl: string) {
  try {
    return new URL(sourceUrl).host;
  } catch {
    return null;
  }
}

type UrlCaptureJobRow = {
  id: string;
  user_id: number;
  username: string | null;
  display_name: string | null;
  source: string;
  source_label: string | null;
  source_url: string;
  source_host: string | null;
  status: string;
  selected_count: number;
  saved_count: number;
  created_at: number;
};

/**
 * GET /api/url-captures?scope=me|all&page=1&limit=20
 *
 * 返回 url_capture_jobs 表的 URL 抓取记录（含每条记录的图片）。
 * scope=all 仅管理员可用，返回全团队记录；否则仅返回当前用户自己的记录。
 * 用于 /history 页的「URL抓取」Tab。
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") || "me";
    const requestedUserId = Number(url.searchParams.get("userId"));
    const filterUserId =
      user.role === "admin" &&
      Number.isInteger(requestedUserId) &&
      requestedUserId > 0
        ? requestedUserId
        : null;
    const showAll = scope === "all" && user.role === "admin" && !filterUserId;
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit") || "20")),
    );

    const db = getDb();

    const where: string[] = [];
    const vals: Array<string | number> = [];
    if (filterUserId) {
      where.push("j.user_id = ?");
      vals.push(filterUserId);
    } else if (!showAll) {
      where.push("j.user_id = ?");
      vals.push(user.id);
    }
    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";

    const countRow = db
      .prepare(`SELECT COUNT(*) AS c FROM url_capture_jobs j ${whereClause}`)
      .get(...vals) as { c: number };

    const rows = db
      .prepare(
        `SELECT j.id, j.user_id, u.username, u.display_name,
                j.source, j.source_label, j.source_url, j.source_host,
                j.status, j.selected_count, j.saved_count, j.created_at
         FROM url_capture_jobs j
         LEFT JOIN users u ON u.id = j.user_id
         ${whereClause}
         ORDER BY j.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...vals, limit, (page - 1) * limit) as UrlCaptureJobRow[];

    const itemsStmt = db.prepare(
      `SELECT media_url, image_url FROM url_capture_items
       WHERE job_id = ?
       ORDER BY idx ASC`,
    );

    const items = rows.map((row) => {
      const captureItems = itemsStmt.all(row.id) as Array<{
        media_url: string;
        image_url: string;
      }>;
      const imageUrls = captureItems
        .map((item) => item.media_url || item.image_url)
        .filter(Boolean);
      return {
        id: row.id,
        userId: row.user_id,
        username: row.username || undefined,
        displayName: row.display_name,
        source: row.source,
        sourceLabel: row.source_label || "URL抓取",
        sourceUrl: row.source_url,
        selectedCount: row.selected_count,
        addedCount: row.saved_count,
        imageUrls,
        thumbnailUrl: imageUrls[0] || null,
        createdAt: row.created_at * 1000,
      };
    });

    return NextResponse.json({
      items,
      page,
      limit,
      total: countRow.c,
      showing_all: showAll,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      source?: string;
      sourceLabel?: string;
      sourceUrl?: string;
      selectedCount?: number;
      savedCount?: number;
      images?: CaptureImage[];
    };

    const sourceUrl = String(body.sourceUrl || "").trim();
    const images = Array.isArray(body.images) ? body.images : [];
    const savedImages = images
      .map((item) => ({
        imageUrl: String(item.imageUrl || item.mediaUrl || "").trim(),
        mediaUrl: String(item.mediaUrl || item.imageUrl || "").trim(),
      }))
      .filter((item) => item.imageUrl && item.mediaUrl);

    if (!sourceUrl) {
      return NextResponse.json({ error: "sourceUrl is required" }, { status: 400 });
    }
    if (savedImages.length === 0) {
      return NextResponse.json({ error: "images is required" }, { status: 400 });
    }

    const id = randomUUID();
    const selectedCount = Math.max(0, Number(body.selectedCount) || savedImages.length);
    const savedCount = Math.max(0, Number(body.savedCount) || savedImages.length);
    const now = Math.floor(Date.now() / 1000);
    const db = getDb();

    const insertJob = db.prepare(
      `INSERT INTO url_capture_jobs
        (id, user_id, source, source_label, source_url, source_host, status,
         selected_count, saved_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'saved', ?, ?, ?)`,
    );
    const insertItem = db.prepare(
      `INSERT INTO url_capture_items
        (job_id, idx, image_url, media_url, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );

    const write = db.transaction(() => {
      insertJob.run(
        id,
        user.id,
        String(body.source || "url_capture"),
        body.sourceLabel ? String(body.sourceLabel) : null,
        sourceUrl,
        sourceHost(sourceUrl),
        selectedCount,
        savedCount,
        now,
      );
      savedImages.forEach((item, index) => {
        insertItem.run(id, index, item.imageUrl, item.mediaUrl, now);
      });
    });
    write();

    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * DELETE /api/url-captures
 * body: { ids: string[] }
 *
 * 删除 URL 抓取记录（items 随外键 CASCADE 自动删）。
 * 非管理员只能删自己的记录。
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => String(id)).filter(Boolean)
      : [];
    if (!ids.length) {
      return NextResponse.json({ error: "ids is required" }, { status: 400 });
    }

    const db = getDb();
    const placeholders = ids.map(() => "?").join(",");
    const ownerClause =
      user.role === "admin" ? "" : " AND user_id = ?";
    const vals: Array<string | number> = [...ids];
    if (user.role !== "admin") vals.push(user.id);

    const result = db
      .prepare(
        `DELETE FROM url_capture_jobs WHERE id IN (${placeholders})${ownerClause}`,
      )
      .run(...vals);

    return NextResponse.json({ deleted: result.changes });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
