import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { getDb, DATA_DIR_PATH } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * /api/text-scenes/[id]
 *
 * PATCH  — admin 改 name / group / text / thumb / sort_order / notes
 * DELETE — admin 删除（同时清掉缩略图文件）
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const sceneId = Number(id);
    if (!Number.isFinite(sceneId)) {
      return NextResponse.json({ error: "id 非法" }, { status: 400 });
    }
    const db = getDb();
    const existing = db
      .prepare(`SELECT id, thumb_path FROM text_scenes WHERE id = ?`)
      .get(sceneId) as { id: number; thumb_path: string | null } | undefined;
    if (!existing) {
      return NextResponse.json({ error: "场景不存在" }, { status: 404 });
    }

    const fd = await req.formData();
    const sets: string[] = [];
    const args: Record<string, unknown> = { id: sceneId };

    const name = fd.get("name");
    if (typeof name === "string" && name.trim()) {
      sets.push("name = @name");
      args.name = name.trim();
    }
    const groupName = fd.get("group");
    if (typeof groupName === "string") {
      sets.push("group_name = @group_name");
      args.group_name = groupName.trim() || null;
    }
    const text = fd.get("text");
    if (typeof text === "string" && text.trim()) {
      if (text.length > 1000) {
        return NextResponse.json({ error: "text 太长" }, { status: 400 });
      }
      sets.push("text_prompt = @text_prompt");
      args.text_prompt = text.trim();
    }
    const notes = fd.get("notes");
    if (typeof notes === "string") {
      sets.push("notes = @notes");
      args.notes = notes.trim() || null;
    }
    const sortRaw = fd.get("sort_order");
    if (typeof sortRaw === "string" && Number.isFinite(Number(sortRaw))) {
      sets.push("sort_order = @sort_order");
      args.sort_order = Number(sortRaw);
    }

    // 可选新缩略图（替换旧的）
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
      const newRel = `uploads/text-scenes/${filename}`;
      sets.push("thumb_path = @thumb_path");
      args.thumb_path = newRel;
      // 删旧文件（如果在 text-scenes 目录里，避免误删 scenes 表共享的图）
      if (
        existing.thumb_path &&
        existing.thumb_path.startsWith("uploads/text-scenes/")
      ) {
        try {
          await fs.unlink(path.join(DATA_DIR_PATH, existing.thumb_path));
        } catch {}
      }
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });
    }

    db.prepare(
      `UPDATE text_scenes SET ${sets.join(", ")} WHERE id = @id`,
    ).run(args);

    const row = db
      .prepare(
        `SELECT id, name, group_name, text_prompt, thumb_path, notes, sort_order
         FROM text_scenes WHERE id = ?`,
      )
      .get(sceneId) as {
      id: number;
      name: string;
      group_name: string | null;
      text_prompt: string;
      thumb_path: string | null;
      notes: string | null;
      sort_order: number;
    };
    return NextResponse.json({
      id: row.id,
      name: row.name,
      group: row.group_name,
      text: row.text_prompt,
      thumb: row.thumb_path ? `/assets/${row.thumb_path}` : null,
      notes: row.notes,
      sort_order: row.sort_order,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/text-scenes PATCH] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const sceneId = Number(id);
    if (!Number.isFinite(sceneId)) {
      return NextResponse.json({ error: "id 非法" }, { status: 400 });
    }
    const db = getDb();
    const row = db
      .prepare(`SELECT id, thumb_path FROM text_scenes WHERE id = ?`)
      .get(sceneId) as { id: number; thumb_path: string | null } | undefined;
    if (!row) {
      return NextResponse.json({ error: "场景不存在" }, { status: 404 });
    }
    db.prepare(`DELETE FROM text_scenes WHERE id = ?`).run(sceneId);
    // 清缩略图文件（仅限自定义上传的，不删 scenes 共享的）
    if (row.thumb_path && row.thumb_path.startsWith("uploads/text-scenes/")) {
      try {
        await fs.unlink(path.join(DATA_DIR_PATH, row.thumb_path));
      } catch {}
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status });
  }
}
