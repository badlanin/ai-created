import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { GoogleGenAI } from "@google/genai";
import { getDb, DATA_DIR_PATH } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { buildGenaiClient } from "@/lib/genai-client";
import { recordUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * POST /api/text-scenes/rebuild-defaults
 *
 * 批量用 AI 重新解析全部默认预设（sort_order 在 10..280 之间的 28 条）：
 * 对每条读 thumb 调 Gemini → 用结果覆盖 text_prompt（name 和 group 也覆盖）。
 *
 * 并发 4 个 Gemini 调用，~30-60 秒可以全部跑完。
 *
 * 返回每条的 ok/error 状态，前端可以渲染进度。
 */

const ANALYZE_MODEL = "gemini-2.5-flash";
const CONCURRENCY = 4;

const ANALYSIS_PROMPT = `你是一个时装电商场景图分析专家。

请仔细分析这张场景图，提取关键信息并按下面的 JSON 格式返回（**只返回 JSON，不要任何额外文字**）：

\`\`\`json
{
  "name": "短中文名（6-10 字，描述场景核心特征）",
  "group": "调性分组（从下面选一个：法式门厅 / 古典宫廷 / 复古沙龙 / 庄园楼梯 / 地中海阳台 / 户外花园 / 极简棚拍。如果都不匹配可以建议新分组名）",
  "text": "120-200 字的完整场景描述，按这个结构写：'主体场景：[场景类型]，[关键物件1] + [关键物件2] + ...；[光线描述]；[色调描述]。[镜头/构图建议]。'"
}
\`\`\`

要求：
- name 简洁、区分调性
- group 从给定 7 类选最匹配的
- text 只描述场景本身（家具/门/楼梯/栏杆/桌面/道具 + 光线 + 色调 + 镜头建议）
- 不要提到模特、姿势、人物互动

只返回 JSON，无 markdown 标记，无解释。`;

interface RowResult {
  id: number;
  ok: boolean;
  name?: string;
  group?: string;
  text_len?: number;
  error?: string;
}

async function analyzeOne(
  client: GoogleGenAI,
  row: { id: number; thumb_path: string },
): Promise<RowResult> {
  try {
    const thumbAbs = path.join(DATA_DIR_PATH, row.thumb_path);
    const buf = await fs.readFile(thumbAbs);
    const mime = thumbAbs.toLowerCase().endsWith(".png")
      ? "image/png"
      : thumbAbs.toLowerCase().endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";

    const result = await client.models.generateContent({
      model: ANALYZE_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: ANALYSIS_PROMPT },
            { inlineData: { mimeType: mime, data: buf.toString("base64") } },
          ],
        },
      ],
    });
    let cleaned = (result.text || "").trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(cleaned) as {
      name?: string;
      group?: string;
      text?: string;
    };
    if (!parsed.text?.trim()) {
      return { id: row.id, ok: false, error: "no text field" };
    }

    // PATCH DB
    const db = getDb();
    db.prepare(
      `UPDATE text_scenes
         SET name = COALESCE(NULLIF(@name, ''), name),
             group_name = COALESCE(NULLIF(@group_name, ''), group_name),
             text_prompt = @text_prompt
       WHERE id = @id`,
    ).run({
      id: row.id,
      name: (parsed.name || "").trim(),
      group_name: (parsed.group || "").trim(),
      text_prompt: parsed.text.trim(),
    });

    return {
      id: row.id,
      ok: true,
      name: parsed.name?.trim(),
      group: parsed.group?.trim(),
      text_len: parsed.text.trim().length,
    };
  } catch (e) {
    return {
      id: row.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function withConcurrency<T, R>(
  items: T[],
  worker: (it: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function pump() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => pump()),
  );
  return results;
}

export async function POST(_req: NextRequest) {
  try {
    const user = await requireAdmin();
    const db = getDb();

    // 默认预设：sort_order 在 10..280 之间 + 有缩略图
    const rows = db
      .prepare(
        `SELECT id, thumb_path FROM text_scenes
         WHERE sort_order BETWEEN 10 AND 280
           AND thumb_path IS NOT NULL
           AND thumb_path != ''
         ORDER BY sort_order ASC`,
      )
      .all() as Array<{ id: number; thumb_path: string }>;

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "没有可重建的默认预设（sort_order 10..280 + 有 thumb）" },
        { status: 404 },
      );
    }

    const client = buildGenaiClient();
    const startMs = Date.now();
    const results = await withConcurrency(
      rows,
      (row) => analyzeOne(client, row),
      CONCURRENCY,
    );
    const elapsedMs = Date.now() - startMs;
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;

    // 记账（汇总成一条；详细可以看 results）
    recordUsage({
      userId: user.id,
      model: ANALYZE_MODEL,
      feature: "analyze",
      usageMetadata: {
        // Gemini Flash 默认每张图约 1300 tokens
        promptTokenCount: 1300 * rows.length,
        candidatesTokenCount: 400 * rows.length,
        totalTokenCount: 1700 * rows.length,
      },
      success: failCount === 0,
      notes: {
        kind: "text-scene-rebuild-defaults",
        total: rows.length,
        ok: okCount,
        failed: failCount,
        elapsed_ms: elapsedMs,
      },
    });

    return NextResponse.json({
      total: rows.length,
      ok: okCount,
      failed: failCount,
      elapsed_ms: elapsedMs,
      results,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
