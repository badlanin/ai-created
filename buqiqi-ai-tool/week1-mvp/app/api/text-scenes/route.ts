import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { getDb, DATA_DIR_PATH } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * /api/text-scenes
 *
 * GET  — 列出所有文字场景预设（公开给所有登录用户，scene-tools/batch-photo 用）
 * POST — admin 新增（multipart formData，可选缩略图）
 */

interface TextSceneRow {
  id: number;
  name: string;
  group_name: string | null;
  text_prompt: string;
  thumb_path: string | null;
  notes: string | null;
  sort_order: number;
  created_at: number;
  created_by: number | null;
}

function rowToApi(row: TextSceneRow) {
  return {
    id: row.id,
    name: row.name,
    group: row.group_name,
    text: row.text_prompt,
    thumb: row.thumb_path ? `/assets/${row.thumb_path}` : null,
    notes: row.notes,
    sort_order: row.sort_order,
  };
}

export async function GET() {
  await requireUser();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, group_name, text_prompt, thumb_path, notes, sort_order, created_at, created_by
       FROM text_scenes ORDER BY sort_order ASC, id ASC`,
    )
    .all() as TextSceneRow[];
  return NextResponse.json(rows.map(rowToApi));
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const db = getDb();
    const fd = await req.formData();

    const name = String(fd.get("name") || "").trim();
    const groupName = String(fd.get("group") || "").trim();
    const text = String(fd.get("text") || "").trim();
    const notes = String(fd.get("notes") || "").trim();
    const sortRaw = fd.get("sort_order");
    const sortOrder =
      typeof sortRaw === "string" && Number.isFinite(Number(sortRaw))
        ? Number(sortRaw)
        : 9999;

    if (!name) {
      return NextResponse.json({ error: "name 必填" }, { status: 400 });
    }
    if (!text || text.length < 20) {
      return NextResponse.json(
        { error: "text 太短（场景描述至少 20 字符）" },
        { status: 400 },
      );
    }
    if (text.length > 1000) {
      return NextResponse.json(
        { error: "text 太长（限 1000 字符）" },
        { status: 400 },
      );
    }

    // 重名检查
    const dup = db
      .prepare(`SELECT id FROM text_scenes WHERE name = ?`)
      .get(name) as { id: number } | undefined;
    if (dup) {
      return NextResponse.json(
        { error: `已存在同名文字场景"${name}"` },
        { status: 409 },
      );
    }

    // ─── 可选缩略图 ───
    let thumbRel: string | null = null;
    const thumbFile = fd.get("thumb");
    if (thumbFile instanceof File && thumbFile.size > 0) {
      if (thumbFile.size > 10 * 1024 * 1024) {
        return NextResponse.json(
          { error: "缩略图太大（限 10MB）" },
          { status: 400 },
        );
      }
      const ext =
        thumbFile.type === "image/png"
          ? "png"
          : thumbFile.type === "image/webp"
            ? "webp"
            : "jpg";
      const filename = `text_scene_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.${ext}`;
      const destDir = path.join(DATA_DIR_PATH, "uploads", "text-scenes");
      await fs.mkdir(destDir, { recursive: true });
      const destAbs = path.join(destDir, filename);
      await fs.writeFile(destAbs, Buffer.from(await thumbFile.arrayBuffer()));
      thumbRel = `uploads/text-scenes/${filename}`;
    }

    const result = db
      .prepare(
        `INSERT INTO text_scenes
           (name, group_name, text_prompt, thumb_path, notes, sort_order, created_by)
         VALUES (@name, @group_name, @text_prompt, @thumb_path, @notes, @sort_order, @created_by)`,
      )
      .run({
        name,
        group_name: groupName || null,
        text_prompt: text,
        thumb_path: thumbRel,
        notes: notes || null,
        sort_order: sortOrder,
        created_by: user.id,
      });

    const inserted = db
      .prepare(
        `SELECT id, name, group_name, text_prompt, thumb_path, notes, sort_order, created_at, created_by
         FROM text_scenes WHERE id = ?`,
      )
      .get(result.lastInsertRowid) as TextSceneRow;

    return NextResponse.json(rowToApi(inserted));
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/text-scenes POST] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
