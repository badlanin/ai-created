import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { buildGenaiClient } from "@/lib/genai-client";
import { resolveModelId } from "@/lib/ai-models";
import { recordUsage } from "@/lib/usage";
import { REPLICATE_ANALYZE_PROMPT } from "@/lib/scene-tools-prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/scene-tools/replicate/analyze
 *
 * 解析参考图里的模特数量 + 每个人的位置/姿势/视角。
 * 用 Gemini 2.5 Flash vision 做视觉解析 + JSON 结构化输出。
 *
 * formData:
 *   - reference_image: File （参考图，含 1-5 位模特的成片）
 *
 * 返回：
 *   {
 *     count: 1-5,
 *     models: [
 *       {
 *         label: "A" | "B" | "C" | "D" | "E",
 *         position: string,  // 'leftmost' | 'center' | ...
 *         role: string,      // 'bridesmaid' | 'guest' | ...
 *         pose: string,      // 中文短句
 *         view: string,      // 'frontal' | 'three-quarter' | ...
 *         framing: string    // 'full-body' | 'three-quarter' | ...
 *       }
 *     ],
 *     model: string,         // 实际用的 Gemini 模型 ID
 *     tokens: { prompt, completion }
 *   }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();

    const formData = await req.formData();
    const refImage = formData.get("reference_image");
    if (!(refImage instanceof File)) {
      return NextResponse.json(
        { error: "请上传参考图（reference_image）" },
        { status: 400 },
      );
    }
    if (refImage.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "参考图太大（限 20MB）" },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await refImage.arrayBuffer());
    const mimeType = refImage.type || "image/jpeg";

    const MODEL = resolveModelId("vision");
    const ai = buildGenaiClient();

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: REPLICATE_ANALYZE_PROMPT },
            { inlineData: { mimeType, data: buf.toString("base64") } },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });

    const text = response.text;
    if (!text) {
      return NextResponse.json(
        { error: "Vertex AI 未返回内容" },
        { status: 500 },
      );
    }

    let parsed: {
      count: number;
      models: Array<{
        label: string;
        position: string;
        role: string;
        pose: string;
        view: string;
        framing: string;
      }>;
    };
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error(
        "[replicate/analyze] JSON parse failed:",
        text.slice(0, 200),
      );
      return NextResponse.json(
        { error: "模型返回的不是合法 JSON，请重试" },
        { status: 502 },
      );
    }

    if (!Array.isArray(parsed?.models) || parsed.models.length === 0) {
      return NextResponse.json(
        { error: "参考图里没识别到模特，换一张试试" },
        { status: 400 },
      );
    }

    // 兜底 cap 到 5 张
    const count = Math.max(1, Math.min(5, parsed.models.length));
    const models = parsed.models.slice(0, count).map((m, i) => ({
      label: ["A", "B", "C", "D", "E"][i],
      position: typeof m.position === "string" ? m.position : "",
      role: typeof m.role === "string" ? m.role : "",
      pose: typeof m.pose === "string" ? m.pose : "",
      view: typeof m.view === "string" ? m.view : "",
      framing: typeof m.framing === "string" ? m.framing : "",
    }));

    recordUsage({
      userId: user.id,
      model: MODEL,
      feature: "other",
      usageMetadata: response.usageMetadata,
      success: true,
      notes: { kind: "scene-tools-replicate-analyze", count },
    });

    return NextResponse.json({
      count,
      models,
      model: MODEL,
      tokens: {
        prompt: response.usageMetadata?.promptTokenCount ?? 0,
        completion: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/scene-tools/replicate/analyze] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
