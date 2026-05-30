import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getAllModelPrices } from "@/lib/pricing";

export const runtime = "nodejs";

/**
 * GET /api/admin/model-prices
 * 列出所有模型单价
 */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(getAllModelPrices());
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * POST /api/admin/model-prices
 * body: { model_id, input_per_1m_usd, output_per_1m_usd, tier?, notes? }
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as {
      model_id?: string;
      input_per_1m_usd?: number;
      output_per_1m_usd?: number;
      tier?: string;
      notes?: string;
    };

    const modelId = (body.model_id || "").trim();
    const input = Number(body.input_per_1m_usd);
    const output = Number(body.output_per_1m_usd);
    if (!modelId) {
      return NextResponse.json({ error: "model_id 必填" }, { status: 400 });
    }
    if (!Number.isFinite(input) || !Number.isFinite(output)) {
      return NextResponse.json(
        { error: "input_per_1m_usd / output_per_1m_usd 必须是数字" },
        { status: 400 },
      );
    }

    const db = getDb();
    db.prepare(
      `INSERT INTO model_prices (model_id, input_per_1m_usd, output_per_1m_usd, tier, notes)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(model_id) DO UPDATE SET
         input_per_1m_usd = excluded.input_per_1m_usd,
         output_per_1m_usd = excluded.output_per_1m_usd,
         tier = excluded.tier,
         notes = excluded.notes,
         updated_at = unixepoch()`,
    ).run(
      modelId,
      input,
      output,
      body.tier || "standard",
      body.notes?.trim() || null,
    );

    const row = db
      .prepare(`SELECT * FROM model_prices WHERE model_id = ?`)
      .get(modelId);
    return NextResponse.json(row);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * DELETE /api/admin/model-prices?model_id=xxx
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const modelId = url.searchParams.get("model_id");
    if (!modelId) {
      return NextResponse.json({ error: "model_id 必填" }, { status: 400 });
    }
    const db = getDb();
    const info = db
      .prepare(`DELETE FROM model_prices WHERE model_id = ?`)
      .run(modelId);
    if (info.changes === 0) {
      return NextResponse.json({ error: "单价不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
