import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

type GenRow = {
  id: number;
  user_id: number;
  username?: string;
  kind: string;
  input_images: string | null;
  output_images: string | null;
  params: string | null;
  duration_ms: number | null;
  success: number;
  error: string | null;
  created_at: number;
};

/**
 * GET /api/generations?page=1&limit=20&kind=recolor|on_model|analyze&scope=me|all
 *
 * - 普通用户：只能看自己的（即使传 scope=all 也强制 me）
 * - 管理员：scope=all 时看所有人（带 username 字段）
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const db = getDb();
    const url = new URL(req.url);

    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit") || "20")),
    );
    const kind = url.searchParams.get("kind");
    const scope = url.searchParams.get("scope") || "me";
    const showAll = scope === "all" && user.role === "admin";

    const conditions: string[] = [];
    const values: unknown[] = [];
    if (!showAll) {
      conditions.push("g.user_id = ?");
      values.push(user.id);
    }
    if (kind && ["recolor", "on_model"].includes(kind)) {
      conditions.push("g.kind = ?");
      values.push(kind);
    }
    const whereClause = conditions.length
      ? "WHERE " + conditions.join(" AND ")
      : "";

    const countRow = db
      .prepare(`SELECT COUNT(*) AS c FROM generations g ${whereClause}`)
      .get(...values) as { c: number };

    const rows = db
      .prepare(
        `SELECT g.id, g.user_id, g.kind, g.input_images, g.output_images,
                g.params, g.duration_ms, g.success, g.error, g.created_at,
                u.username
         FROM generations g
         LEFT JOIN users u ON u.id = g.user_id
         ${whereClause}
         ORDER BY g.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, (page - 1) * limit) as GenRow[];

    return NextResponse.json({
      total: countRow.c,
      page,
      limit,
      showing_all: showAll,
      items: rows,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * DELETE /api/generations
 * Body: { ids: number[] }  或  { user_id: number }（仅管理员，清空子账号）
 *
 * 权限：
 *   - 用户：只能删自己的记录
 *   - 管理员：可以删任何人的，也可以按 user_id 批量清空
 *
 * 同时删除磁盘上的 output 图片（最佳 effort）
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const db = getDb();
    const body = (await req.json().catch(() => ({}))) as {
      ids?: number[];
      user_id?: number;
    };

    const ids = Array.isArray(body.ids)
      ? body.ids.filter((v): v is number => Number.isFinite(v))
      : [];
    const targetUserId = Number.isFinite(body.user_id)
      ? Number(body.user_id)
      : null;

    // 权限：非 admin 不能用 user_id 清空，也不能删别人的 id
    if (user.role !== "admin" && targetUserId !== null) {
      return NextResponse.json(
        { error: "仅管理员可以清空指定用户的历史" },
        { status: 403 },
      );
    }

    let sql = "";
    let params: unknown[] = [];

    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      sql = `DELETE FROM generations WHERE id IN (${placeholders})`;
      params = [...ids];
      if (user.role !== "admin") {
        // 非 admin 加 user_id 校验
        sql += " AND user_id = ?";
        params.push(user.id);
      }
    } else if (targetUserId !== null) {
      sql = `DELETE FROM generations WHERE user_id = ?`;
      params = [targetUserId];
    } else {
      return NextResponse.json(
        { error: "请提供 ids[] 或 user_id（仅 admin）" },
        { status: 400 },
      );
    }

    // 先把要删的输出图路径捞出来，用于删盘
    let pathsToDelete: string[] = [];
    try {
      const whereClause = ids.length > 0
        ? `id IN (${ids.map(() => "?").join(",")})`
        : `user_id = ?`;
      const whereParams =
        ids.length > 0 ? ids : [targetUserId];
      const rows = db
        .prepare(
          `SELECT output_images FROM generations WHERE ${whereClause}`,
        )
        .all(...whereParams) as Array<{ output_images: string | null }>;
      for (const r of rows) {
        if (!r.output_images) continue;
        try {
          const urls = JSON.parse(r.output_images);
          if (Array.isArray(urls)) {
            for (const u of urls) {
              if (typeof u === "string") pathsToDelete.push(u);
            }
          }
        } catch {}
      }
    } catch (e) {
      console.warn("[generations DELETE] 捞 output_images 失败:", e);
    }

    const result = db.prepare(sql).run(...params);

    // 异步删盘（不阻塞响应）
    void (async () => {
      const { promises: fs } = await import("fs");
      const path = await import("path");
      const { DATA_DIR_PATH } = await import("@/lib/db");
      for (const url of pathsToDelete) {
        // url 形如 "/assets/outputs/xxx.png"，去掉 /assets/ 前缀
        if (!url.startsWith("/assets/")) continue;
        const rel = url.slice("/assets/".length);
        const abs = path.join(DATA_DIR_PATH, rel);
        try {
          await fs.unlink(abs);
        } catch {
          // 文件不存在就 ignore
        }
      }
    })();

    return NextResponse.json({
      deleted: result.changes,
      removed_files: pathsToDelete.length,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
