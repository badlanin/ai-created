import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { DATA_DIR_PATH } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateImage, type GenImageInput } from "@/lib/gemini-image";
import { recordUsage } from "@/lib/usage";
import { assertWithinBudget, calcCost } from "@/lib/pricing";
import { recordSingleShotJob } from "@/lib/jobs-db";
import { buildTextShootPrompt } from "@/lib/scene-tools-prompt";

export const runtime = "nodejs";
export const maxDuration = 600;

const MODEL = "gemini-3-pro-image-preview";
const SIZE = "4K" as const;
const TEMP = 0.5;
const OUTPUT_DIR_REL = "outputs";

const ALLOWED_RATIOS = [
  "1:1",
  "3:2",
  "2:3",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
];

/**
 * POST /api/scene-tools/text-shoot
 *
 * 文字模式（独立测试功能，不依赖任何 scene plate）：
 * 用一张已有的模特+服装成片 + 一段文字场景描述，让模型自由发挥重新拍。
 *
 * formData:
 *   - source_image: File（含 1 位模特+服装的成片，背景任意，将被丢弃）
 *   - scene_text: string (≤ 500 字, 必填) —— 场景描述
 *   - pose_text?: string (≤ 200 字) —— 姿势引导
 *   - aspect_ratio?: '3:4' | ... (默认 3:4)
 *   - user_hint?: string (≤ 200 字) —— 创意追加
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    assertWithinBudget(user.id, user.role);

    const formData = await req.formData();

    // ─── 原片 ───
    const sourceImage = formData.get("source_image");
    if (!(sourceImage instanceof File)) {
      return NextResponse.json(
        { error: "请上传原片（source_image）" },
        { status: 400 },
      );
    }
    if (sourceImage.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "原片太大（限 20MB）" },
        { status: 400 },
      );
    }

    // ─── scene_text 必填 ───
    const sceneTextRaw = formData.get("scene_text");
    const sceneText =
      typeof sceneTextRaw === "string" ? sceneTextRaw.trim() : "";
    if (!sceneText) {
      return NextResponse.json(
        { error: "请填写场景描述（scene_text）" },
        { status: 400 },
      );
    }
    if (sceneText.length > 500) {
      return NextResponse.json(
        { error: "场景描述太长（限 500 字）" },
        { status: 400 },
      );
    }

    // ─── pose_text 可选 ───
    const poseTextRaw = formData.get("pose_text");
    let poseText: string | undefined;
    if (typeof poseTextRaw === "string") {
      const t = poseTextRaw.trim();
      if (t.length > 0) {
        if (t.length > 200) {
          return NextResponse.json(
            { error: "姿势描述太长（限 200 字）" },
            { status: 400 },
          );
        }
        poseText = t;
      }
    }

    // ─── user_hint 可选 ───
    const hintRaw = formData.get("user_hint");
    let userHint: string | undefined;
    if (typeof hintRaw === "string") {
      const t = hintRaw.trim();
      if (t.length > 0) {
        if (t.length > 200) {
          return NextResponse.json(
            { error: "user_hint 太长（限 200 字）" },
            { status: 400 },
          );
        }
        userHint = t;
      }
    }

    // ─── aspect_ratio ───
    const arRaw = formData.get("aspect_ratio");
    const aspectRatio =
      typeof arRaw === "string" && ALLOWED_RATIOS.includes(arRaw) ? arRaw : "3:4";

    // ─── 调 Gemini Pro Image 4K（只传原片，不传任何 plate）───
    const sourceBuf = Buffer.from(await sourceImage.arrayBuffer());
    const sourceMime = sourceImage.type || "image/jpeg";
    const inputs: GenImageInput[] = [
      { buffer: sourceBuf, mimeType: sourceMime },
    ];

    const prompt = buildTextShootPrompt(sceneText, poseText, userHint);
    const gen = await generateImage(inputs, prompt, MODEL, {
      aspectRatio,
      imageSize: SIZE,
      temperature: TEMP,
    });

    // ─── 落盘 ───
    const outputsDir = path.join(DATA_DIR_PATH, OUTPUT_DIR_REL);
    await fs.mkdir(outputsDir, { recursive: true });
    const ext = gen.mimeType.includes("png") ? "png" : "jpg";
    const outId = `text_shoot_${Date.now()}_${crypto
      .randomBytes(4)
      .toString("hex")}`;
    const filename = `${outId}.${ext}`;
    const absPath = path.join(outputsDir, filename);
    await fs.writeFile(absPath, gen.data);

    // ─── 记账 ───
    recordUsage({
      userId: user.id,
      model: MODEL,
      feature: "other",
      usageMetadata: gen.usageMetadata,
      success: true,
      notes: {
        kind: "scene-tools-text-shoot",
        scene_text_preview: sceneText.slice(0, 80),
        out_id: outId,
      },
    });

    // ─── history ───
    const promptTokens = gen.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = gen.usageMetadata?.candidatesTokenCount ?? 0;
    const costInfo = calcCost(MODEL, promptTokens, completionTokens);
    const resultUrl = `/assets/${OUTPUT_DIR_REL}/${filename}`;
    const labelPreview = sceneText.slice(0, 24).replace(/\s+/g, " ");
    recordSingleShotJob({
      user_id: user.id,
      feature: "text_shoot",
      model: MODEL,
      label: `文字场景 · ${labelPreview}${sceneText.length > 24 ? "…" : ""}`,
      result_image_path: `${OUTPUT_DIR_REL}/${filename}`,
      result_image_url: resultUrl,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_cny: costInfo.cost_cny,
      params: {
        scene_text: sceneText,
        pose_text: poseText || null,
        user_hint: userHint || null,
        aspect_ratio: aspectRatio,
      },
    });

    return NextResponse.json({
      result_id: outId,
      result_image_url: resultUrl,
      mime_type: gen.mimeType,
      tokens: { prompt: promptTokens, completion: completionTokens },
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/scene-tools/text-shoot] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
