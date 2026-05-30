import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { GoogleGenAI } from "@google/genai";
import { getDb, DATA_DIR_PATH } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { buildGenaiClient } from "@/lib/genai-client";
import { recordUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/text-scenes/[id]/reanalyze
 *
 * 用该文字场景**已绑定的缩略图**调 Gemini Vision 重新解析，
 * 把新生成的 text / name / group 字段 PATCH 回 text_scenes 表。
 *
 * 用途：默认 28 个预设是按 sort_order 硬映射缩略图的，内容跟图对不上。
 * 让 AI 用真实缩略图重新生成描述，能"以图为准"修正错乱。
 *
 * 注意：name 和 group 默认**不覆盖**（避免破坏用户已编辑的名字），
 * 只覆盖 text_prompt。要全覆盖传 ?full=1。
 */

const ANALYZE_MODEL = "gemini-2.5-flash";

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
- name 要简洁、能区分调性（例：粉色法式门厅 / 宫廷油画楼梯 / 红墙阳台·海景棕榈）
- group 从给定 7 类选最匹配的
- text 要让 AI 模型能仅凭文字理解整个场景：包括家具/门/楼梯/栏杆/桌面/道具等可交互物件，光线方向 + 色温，色调（暖/冷/中性）+ 主色，镜头建议（85mm 长焦 / 50mm 自然 / 35mm 广角）和景深
- text 不要提到模特、姿势、人物互动（这些由系统 prompt 控制），只描述场景本身
- 不要写"模特倚靠在 XX"之类的人物动作

只返回 JSON，无 markdown 标记，无解释。`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const sceneId = Number(id);
    if (!Number.isFinite(sceneId)) {
      return NextResponse.json({ error: "id 非法" }, { status: 400 });
    }
    const full = req.nextUrl.searchParams.get("full") === "1";

    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, name, thumb_path FROM text_scenes WHERE id = ?`,
      )
      .get(sceneId) as
      | { id: number; name: string; thumb_path: string | null }
      | undefined;
    if (!row) {
      return NextResponse.json({ error: "场景不存在" }, { status: 404 });
    }
    if (!row.thumb_path) {
      return NextResponse.json(
        { error: "该场景没有缩略图，无法重新解析" },
        { status: 400 },
      );
    }

    // 读缩略图二进制
    const thumbAbs = path.join(DATA_DIR_PATH, row.thumb_path);
    let buf: Buffer;
    try {
      buf = await fs.readFile(thumbAbs);
    } catch {
      return NextResponse.json(
        { error: `缩略图文件不存在：${row.thumb_path}` },
        { status: 404 },
      );
    }
    const ext = thumbAbs.toLowerCase().endsWith(".png")
      ? "image/png"
      : thumbAbs.toLowerCase().endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";

    // 调 Gemini Vision
    const client: GoogleGenAI = buildGenaiClient();
    const result = await client.models.generateContent({
      model: ANALYZE_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: ANALYSIS_PROMPT },
            {
              inlineData: {
                mimeType: ext,
                data: buf.toString("base64"),
              },
            },
          ],
        },
      ],
    });

    const rawText = result.text || "";
    let cleaned = rawText.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    let parsed: { name?: string; group?: string; text?: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "Gemini 返回的不是合法 JSON", raw_text: rawText.slice(0, 500) },
        { status: 500 },
      );
    }
    if (!parsed.text?.trim()) {
      return NextResponse.json(
        { error: "Gemini 没返回 text 字段", raw_text: rawText.slice(0, 500) },
        { status: 500 },
      );
    }

    // 更新 DB
    const sets: string[] = ["text_prompt = @text_prompt"];
    const args: Record<string, unknown> = {
      id: sceneId,
      text_prompt: parsed.text.trim(),
    };
    if (full && parsed.name?.trim()) {
      sets.push("name = @name");
      args.name = parsed.name.trim();
    }
    if (full && parsed.group?.trim()) {
      sets.push("group_name = @group_name");
      args.group_name = parsed.group.trim();
    }
    db.prepare(
      `UPDATE text_scenes SET ${sets.join(", ")} WHERE id = @id`,
    ).run(args);

    // 记账
    recordUsage({
      userId: user.id,
      model: ANALYZE_MODEL,
      feature: "analyze",
      usageMetadata: {
        promptTokenCount: result.usageMetadata?.promptTokenCount ?? 0,
        candidatesTokenCount:
          result.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokenCount: result.usageMetadata?.totalTokenCount ?? 0,
      },
      success: true,
      notes: { kind: "text-scene-reanalyze", scene_id: sceneId, full },
    });

    const updated = db
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
      id: updated.id,
      name: updated.name,
      group: updated.group_name,
      text: updated.text_prompt,
      thumb: updated.thumb_path ? `/assets/${updated.thumb_path}` : null,
      notes: updated.notes,
      sort_order: updated.sort_order,
      suggested: {
        name: parsed.name?.trim() || "",
        group: parsed.group?.trim() || "",
      },
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
