import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getAllModels, type AiModelCategory } from "@/lib/ai-models";

export const runtime = "nodejs";

/**
 * GET /api/admin/ai-models
 * 列出所有模型（含 disabled）。管理员用。
 */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(getAllModels());
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * POST /api/admin/ai-models
 * body: {
 *   model_id, label, description?, category: 'vision'|'image_gen',
 *   enabled?, is_default?, badge?, sort_order?
 * }
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as {
      model_id?: string;
      label?: string;
      description?: string;
      category?: AiModelCategory;
      enabled?: number | boolean;
      is_default?: number | boolean;
      badge?: string;
      sort_order?: number;
    };

    const model_id = (body.model_id || "").trim();
    const label = (body.label || "").trim();
    const category = body.category;
    if (!model_id) {
      return NextResponse.json({ error: "model_id 必填" }, { status: 400 });
    }
    if (!label) {
      return NextResponse.json({ error: "label 必填" }, { status: 400 });
    }
    if (category !== "vision" && category !== "image_gen") {
      return NextResponse.json(
        { error: "category 必须是 vision 或 image_gen" },
        { status: 400 },
      );
    }

    const db = getDb();
    const enabled = body.enabled ? 1 : 0;
    const is_default = body.is_default ? 1 : 0;

    // 如果设为默认，先把同 category 里其他的 default 清掉
    const tx = db.transaction(() => {
      if (is_default) {
        db.prepare(
          `UPDATE ai_models SET is_default = 0 WHERE category = ?`,
        ).run(category);
      }
      const result = db
        .prepare(
          `INSERT INTO ai_models
             (model_id, label, description, category, enabled, is_default, badge, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          model_id,
          label,
          body.description?.trim() || null,
          category,
          enabled,
          is_default,
          body.badge?.trim() || null,
          body.sort_order ?? 0,
        );
      return result.lastInsertRowid as number;
    });

    let newId: number;
    try {
      newId = tx();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) {
        return NextResponse.json(
          { error: `这个 category 下已经有 model_id = ${model_id} 了` },
          { status: 409 },
        );
      }
      throw e;
    }

    const row = db
      .prepare(`SELECT * FROM ai_models WHERE id = ?`)
      .get(newId);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
