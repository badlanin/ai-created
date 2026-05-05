import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { DATA_DIR_PATH, getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateImage, type GenImageInput } from "@/lib/gemini-image";
import { recordUsage } from "@/lib/usage";
import { assertWithinBudget, calcCost } from "@/lib/pricing";
import { recordSingleShotJob } from "@/lib/jobs-db";
import {
  buildPosterPrompt,
  isValidPosterComposition,
  type PosterComposition,
} from "@/lib/scene-tools-prompt";

export const runtime = "nodejs";
export const maxDuration = 600;

// 海报：Pro Image + 4K（要 hero/banner 用，必须高分辨率）
const POSTER_MODEL = "gemini-3-pro-image-preview";
const POSTER_SIZE = "4K" as const;
// 温度低 —— 海报多人合成最大难点是 control，给模型自由发挥会失控
const POSTER_TEMP = 0.3;

const OUTPUT_DIR_REL = "outputs";

// scene plate 接受 single 或 poster 双库（虽然倾向 poster，但 single 也能强行用）
const ALLOWED_USAGE = new Set(["single", "poster"]);

// poster 比例：偏横屏 / 正方 KV 用，竖屏少见
const ALLOWED_RATIOS = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:2",
  "21:9",
  "3:4",
  "2:3",
];

const MAX_SOURCES = 5;

/**
 * POST /api/scene-tools/poster
 *
 * formData:
 *   - source_image0..4: File（1-5 张已有的成片）
 *   - scene_id: number
 *   - aspect_ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:2' | '21:9' | etc
 *   - composition: 'static' | 'gathering'
 *   - user_hint: string（可选，构图额外指令）
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    assertWithinBudget(user.id, user.role);

    const formData = await req.formData();

    // ─── 收集原片（1-5 张） ───
    const sourceFiles: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (/^source_image\d+$/.test(key) && value instanceof File) {
        sourceFiles.push(value);
      }
    }
    if (sourceFiles.length === 0) {
      return NextResponse.json(
        { error: "请上传至少 1 张原片" },
        { status: 400 },
      );
    }
    if (sourceFiles.length > MAX_SOURCES) {
      return NextResponse.json(
        { error: `最多 ${MAX_SOURCES} 张原片` },
        { status: 400 },
      );
    }
    for (const f of sourceFiles) {
      if (f.size > 20 * 1024 * 1024) {
        return NextResponse.json(
          { error: `原片太大（限 20MB / 张）：${f.name || "unnamed"}` },
          { status: 400 },
        );
      }
    }

    // ─── scene ───
    const sceneId = Number(formData.get("scene_id"));
    if (!Number.isFinite(sceneId)) {
      return NextResponse.json({ error: "scene_id 不合法" }, { status: 400 });
    }

    // ─── aspect ratio ───
    const aspectRatioRaw = formData.get("aspect_ratio");
    const aspectRatio =
      typeof aspectRatioRaw === "string" &&
      ALLOWED_RATIOS.includes(aspectRatioRaw)
        ? aspectRatioRaw
        : "16:9"; // 默认横屏 KV

    // ─── composition ───
    const compositionRaw = formData.get("composition");
    if (!isValidPosterComposition(compositionRaw)) {
      return NextResponse.json({ error: "composition 非法" }, { status: 400 });
    }
    const composition: PosterComposition = compositionRaw;

    // ─── user_hint ───
    const userHintRaw = formData.get("user_hint");
    const userHint =
      typeof userHintRaw === "string" ? userHintRaw.trim() : "";

    // ─── 加载 scene ───
    const db = getDb();
    const scene = db
      .prepare(
        `SELECT id, name, image_path, usage FROM scenes WHERE id = ?`,
      )
      .get(sceneId) as
      | { id: number; name: string; image_path: string; usage: string }
      | undefined;
    if (!scene) {
      return NextResponse.json({ error: "场景不存在" }, { status: 404 });
    }
    if (!ALLOWED_USAGE.has(scene.usage)) {
      return NextResponse.json(
        { error: "scene usage 非法" },
        { status: 400 },
      );
    }

    // ─── 读所有图 ───
    const sourceInputs: GenImageInput[] = [];
    for (const f of sourceFiles) {
      const buffer = Buffer.from(await f.arrayBuffer());
      sourceInputs.push({
        buffer,
        mimeType: f.type || "image/jpeg",
      });
    }

    const sceneAbsPath = path.join(DATA_DIR_PATH, scene.image_path);
    const sceneBuf = await fs.readFile(sceneAbsPath);
    const sceneMime = sceneAbsPath.toLowerCase().endsWith(".png")
      ? "image/png"
      : sceneAbsPath.toLowerCase().endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";

    // 顺序：原片 1..N / scene plate
    const inputs: GenImageInput[] = [
      ...sourceInputs,
      { buffer: sceneBuf, mimeType: sceneMime },
    ];

    const prompt = buildPosterPrompt(
      sourceFiles.length,
      composition,
      scene.name,
      userHint || undefined,
    );

    // ─── 调 Gemini ───
    const gen = await generateImage(inputs, prompt, POSTER_MODEL, {
      aspectRatio,
      imageSize: POSTER_SIZE,
      temperature: POSTER_TEMP,
    });

    // ─── 落盘 ───
    const outputsDir = path.join(DATA_DIR_PATH, OUTPUT_DIR_REL);
    await fs.mkdir(outputsDir, { recursive: true });

    const ext = gen.mimeType.includes("png") ? "png" : "jpg";
    const outId = `poster_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const filename = `${outId}.${ext}`;
    const absPath = path.join(outputsDir, filename);
    await fs.writeFile(absPath, gen.data);

    // ─── 记账 ───
    recordUsage({
      userId: user.id,
      model: POSTER_MODEL,
      feature: "other",
      usageMetadata: gen.usageMetadata,
      success: true,
      notes: {
        kind: "scene-tools-poster",
        source_count: sourceFiles.length,
        scene_id: scene.id,
        scene_name: scene.name,
        composition,
        aspect_ratio: aspectRatio,
        user_hint: userHint || null,
        out_id: outId,
      },
    });

    // ─── 写 history ───
    const promptTokens = gen.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = gen.usageMetadata?.candidatesTokenCount ?? 0;
    const costInfo = calcCost(POSTER_MODEL, promptTokens, completionTokens);
    const resultUrl = `/assets/${OUTPUT_DIR_REL}/${filename}`;
    recordSingleShotJob({
      user_id: user.id,
      feature: "poster",
      model: POSTER_MODEL,
      label: `氛围海报 · ${scene.name}（${sourceFiles.length} 人 · ${composition}）`,
      result_image_path: `${OUTPUT_DIR_REL}/${filename}`,
      result_image_url: resultUrl,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_cny: costInfo.cost_cny,
      params: {
        source_count: sourceFiles.length,
        scene_id: scene.id,
        scene_name: scene.name,
        composition,
        aspect_ratio: aspectRatio,
        user_hint: userHint || null,
      },
    });

    return NextResponse.json({
      result_id: outId,
      result_image_url: resultUrl,
      mime_type: gen.mimeType,
      tokens: { prompt: promptTokens, completion: completionTokens },
      scene: { id: scene.id, name: scene.name },
      source_count: sourceFiles.length,
      composition,
      aspect_ratio: aspectRatio,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/scene-tools/poster] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
