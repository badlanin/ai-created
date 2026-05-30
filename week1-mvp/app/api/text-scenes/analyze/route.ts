import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { requireAdmin } from "@/lib/auth";
import { buildGenaiClient } from "@/lib/genai-client";
import { recordUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/text-scenes/analyze
 *
 * admin 上传一张参考场景图 → Gemini Vision 解析提取场景信息 → 返回建议的：
 *   - name（短中文名，6-10 字）
 *   - group（调性分组，从已知 7 大类里挑或建议新建）
 *   - text（120-200 字完整描述，按"主体场景 + 关键物件 + 光线 + 调性"结构）
 *
 * 用户在 admin/scenes 的"新增文字场景" tab 上传参考图 → 调这里 → 编辑确认 → 保存到 text_scenes 表
 *
 * 模型：gemini-2.5-flash（视觉解析够用 + 便宜，1 张图约 ¥0.01）
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

export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const fd = await req.formData();
    const imageFile = fd.get("image");
    if (!(imageFile instanceof File)) {
      return NextResponse.json({ error: "image 必传" }, { status: 400 });
    }
    if (imageFile.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "图片太大（限 20MB）" },
        { status: 400 },
      );
    }

    const client: GoogleGenAI = buildGenaiClient();
    const buf = Buffer.from(await imageFile.arrayBuffer());

    const result = await client.models.generateContent({
      model: ANALYZE_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: ANALYSIS_PROMPT },
            {
              inlineData: {
                mimeType: imageFile.type || "image/jpeg",
                data: buf.toString("base64"),
              },
            },
          ],
        },
      ],
    });

    const rawText = result.text || "";

    // ─── 解析 JSON（可能带 ```json ... ``` 标记）───
    let extracted = rawText.trim();
    extracted = extracted.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    let parsed: {
      name?: string;
      group?: string;
      text?: string;
    } = {};
    try {
      parsed = JSON.parse(extracted);
    } catch (err) {
      console.warn(
        "[text-scenes/analyze] 解析 Gemini 返回 JSON 失败:",
        err,
        "原文：",
        rawText.slice(0, 500),
      );
      return NextResponse.json(
        {
          error: "Gemini 返回的不是合法 JSON，请重试或换张图",
          raw_text: rawText.slice(0, 800),
        },
        { status: 500 },
      );
    }

    if (!parsed.text || !parsed.text.trim()) {
      return NextResponse.json(
        {
          error: "Gemini 没返回 text 字段，请重试",
          raw_text: rawText.slice(0, 800),
        },
        { status: 500 },
      );
    }

    // ─── 记账 ───
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
      notes: {
        kind: "text-scene-analyze",
        suggested_name: parsed.name,
        suggested_group: parsed.group,
      },
    });

    return NextResponse.json({
      name: parsed.name?.trim() || "",
      group: parsed.group?.trim() || "",
      text: parsed.text.trim(),
      model: ANALYZE_MODEL,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/text-scenes/analyze] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
