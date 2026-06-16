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
