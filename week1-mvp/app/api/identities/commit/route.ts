import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { DATA_DIR_PATH, getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

const TEMP_DIR_REL = "temp/identity-gen";
const PERMANENT_DIR_REL = "uploads/identities";

// 跟 /api/identities POST 保持一致的分类白名单
const VALID_CATEGORIES = new Set([
  "universal",
  "plus_size",
  "maternity",
  "teen",
]);

const IDENTITY_CATEGORY_LABELS: Record<string, string> = {
  universal: "通用",
  plus_size: "大码",
  maternity: "孕妇",
  teen: "青少年",
};

/**
 * POST /api/identities/commit
 *
 * body: {
 *   gen_id: string,         // 来自 /generate 的返回
 *   ext: 'png' | 'jpg',     // 文件扩展名（来自 /generate 的 image_url）
 *   name: string,
 *   category?: string,      // universal / plus_size / maternity / teen
 *   tags?: string,
 *   sort_order?: number,
 * }
 *
 * 流程：
 *   1. 从 temp/identity-gen/<gen_id>.<ext> 读图（必须存在）
 *   2. 移动到 uploads/identities/identity_<timestamp>.<ext>
 *   3. INSERT 一行 models（kind='identity'）
 *   4. 删除 temp 文件
 *   5. 返回新建的 identity row
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const body = (await req.json()) as {
      gen_id?: string;
      ext?: string;
      name?: string;
      category?: string;
      tags?: string;
      sort_order?: number;
    };

    const genId = (body.gen_id || "").trim();
    if (!genId || !/^[a-zA-Z0-9_-]+$/.test(genId)) {
      return NextResponse.json({ error: "gen_id 非法" }, { status: 400 });
    }

    const ext = (body.ext || "png").trim().toLowerCase();
    if (!["png", "jpg", "jpeg", "webp"].includes(ext)) {
      return NextResponse.json({ error: "ext 非法" }, { status: 400 });
    }

    const name = (body.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "名称必填" }, { status: 400 });
    }

    // 分类（可选）
    const rawCategory = (body.category || "").trim();
    const category =
      rawCategory && VALID_CATEGORIES.has(rawCategory) ? rawCategory : null;

    // ─── 1. 校验 temp 文件存在 ───
    const tempAbs = path.join(DATA_DIR_PATH, TEMP_DIR_REL, `${genId}.${ext}`);
    try {
      await fs.access(tempAbs);
    } catch {
      return NextResponse.json(
        { error: `暂存文件不存在或已过期：${genId}.${ext}` },
        { status: 404 },
      );
    }

    // ─── 2. 移动到 permanent ───
    const permanentDir = path.join(DATA_DIR_PATH, PERMANENT_DIR_REL);
    await fs.mkdir(permanentDir, { recursive: true });

    const newFilename = `identity_${Date.now()}_${genId}.${ext}`;
    const newAbs = path.join(permanentDir, newFilename);
    await fs.copyFile(tempAbs, newAbs);
    const newRelPath = path.posix.join(PERMANENT_DIR_REL, newFilename);

    // ─── 3. INSERT models ───
    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO models (kind, name, image_path, tags, notes, category, sort_order, created_by)
         VALUES ('identity', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        newRelPath,
        body.tags?.trim() || null,
        null,
        category,
        body.sort_order ?? 0,
        user.id,
      );

    // ─── 4. 删除 temp 文件（不阻塞错误）───
    fs.unlink(tempAbs).catch(() => {});

    // ─── 5. 返回 row ───
    const row = db
      .prepare(
        `SELECT id, name, image_path, tags, notes, category, sort_order, created_at
         FROM models WHERE id = ?`,
      )
      .get(result.lastInsertRowid) as
      | {
          id: number;
          name: string;
          image_path: string;
          tags: string | null;
          notes: string | null;
          category: string | null;
          sort_order: number;
          created_at: number;
        }
      | undefined;

    if (!row) {
      return NextResponse.json(
        { error: "创建后查询失败" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        ...row,
        image_url: `/assets/${row.image_path}`,
        category_label: row.category
          ? IDENTITY_CATEGORY_LABELS[row.category] || row.category
          : null,
      },
      { status: 201 },
    );
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/identities/commit] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
