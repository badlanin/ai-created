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
import { buildBackgroundSwapPrompt } from "@/lib/scene-tools-prompt";

export const runtime = "nodejs";
export const maxDuration = 600;

// 强制 Pro 模型 + 4K：背景换图必须用最强档（细节保留 + 光线匹配是难点）
const SWAP_MODEL = "gemini-3-pro-image-preview";
const SWAP_SIZE = "4K" as const;
// 温度低，最大化"保留原图人物"的确定性
const SWAP_TEMP = 0.2;

const OUTPUT_DIR_REL = "outputs";

/**
 * POST /api/scene-tools/background-swap
 *
 * formData:
 *   - source_image: File (the original batch-photo result, the model + clothing)
 *   - scene_id: number (scene plate id from scenes table, must be usage='single')
 *   - aspect_ratio: '3:4' | '4:3' | '1:1' | etc (optional; defaults to source's nominal)
 *
 * 流程：
 *   1. 校验 source_image + scene_id（scene 必须 usage='single'）
 *   2. 读 scene plate 文件 → 拼装 prompt
 *   3. 调 Gemini Pro Image edit（双图输入：原片 + scene plate）
 *   4. 输出保存到 DATA_DIR/outputs/swap_<id>.png
 *   5. 记账
 *   6. 返回 result_image_url
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    assertWithinBudget(user.id, user.role);

    const formData = await req.formData();

    // ─── 验入参 ───
    const sourceImage = formData.get("source_image");
    if (!(sourceImage instanceof File)) {
      return NextResponse.json(
        { error: "请上传原片（source_image）" },
        { status: 400 },
      );
    }
    if (sourceImage.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "原片太大（限 20MB），请压缩后再传" },
        { status: 400 },
      );
    }

    const sceneIdRaw = formData.get("scene_id");
    const sceneId = Number(sceneIdRaw);
    if (!Number.isFinite(sceneId)) {
      return NextResponse.json({ error: "scene_id 不合法" }, { status: 400 });
    }

    const aspectRatioRaw = formData.get("aspect_ratio");
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
    const aspectRatio =
      typeof aspectRatioRaw === "string" &&
      ALLOWED_RATIOS.includes(aspectRatioRaw)
        ? aspectRatioRaw
        : "3:4";

    // ─── 读 scene plate ───
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
    if (scene.usage !== "single") {
      return NextResponse.json(
        { error: "该场景属于海报库，不能用于背景换图（仅支持主图场景库）" },
        { status: 400 },
      );
    }

    const sceneAbsPath = path.join(DATA_DIR_PATH, scene.image_path);
    let sceneBuf: Buffer;
    try {
      sceneBuf = await fs.readFile(sceneAbsPath);
    } catch (err) {
      console.error("[background-swap] 读 scene plate 失败:", err);
      return NextResponse.json(
        { error: "场景图文件丢失，请联系管理员" },
        { status: 500 },
      );
    }

    // ─── 准备 Gemini 输入 ───
    const sourceBuf = Buffer.from(await sourceImage.arrayBuffer());
    const sourceMime = sourceImage.type || "image/jpeg";
    const sceneMime = sceneAbsPath.toLowerCase().endsWith(".png")
      ? "image/png"
      : sceneAbsPath.toLowerCase().endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";

    const inputs: GenImageInput[] = [
      { buffer: sourceBuf, mimeType: sourceMime }, // IMAGE 1 = 原片
      { buffer: sceneBuf, mimeType: sceneMime }, // IMAGE 2 = scene plate
    ];

    const prompt = buildBackgroundSwapPrompt(scene.name);

    // ─── 调 Gemini Pro Image ───
    const gen = await generateImage(inputs, prompt, SWAP_MODEL, {
      aspectRatio,
      imageSize: SWAP_SIZE,
      temperature: SWAP_TEMP,
    });

    // ─── 落盘 ───
    const outputsDir = path.join(DATA_DIR_PATH, OUTPUT_DIR_REL);
    await fs.mkdir(outputsDir, { recursive: true });

    const ext = gen.mimeType.includes("png") ? "png" : "jpg";
    const outId = `swap_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const filename = `${outId}.${ext}`;
    const absPath = path.join(outputsDir, filename);
    await fs.writeFile(absPath, gen.data);

    // ─── 记账 ───
    recordUsage({
      userId: user.id,
      model: SWAP_MODEL,
      feature: "other",
      usageMetadata: gen.usageMetadata,
      success: true,
      notes: {
        kind: "scene-tools-background-swap",
        scene_id: scene.id,
        scene_name: scene.name,
        out_id: outId,
      },
    });

    // ─── 写入 history（render_jobs，立即 completed 的 1-item 伪 job）───
    const promptTokens = gen.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = gen.usageMetadata?.candidatesTokenCount ?? 0;
    const costInfo = calcCost(SWAP_MODEL, promptTokens, completionTokens);
    const resultUrl = `/assets/${OUTPUT_DIR_REL}/${filename}`;
    recordSingleShotJob({
      user_id: user.id,
      feature: "background_swap",
      model: SWAP_MODEL,
      label: `背景换图 · ${scene.name}`,
      result_image_path: `${OUTPUT_DIR_REL}/${filename}`,
      result_image_url: resultUrl,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_cny: costInfo.cost_cny,
      params: {
        scene_id: scene.id,
        scene_name: scene.name,
        aspect_ratio: aspectRatio,
      },
    });

    return NextResponse.json({
      result_id: outId,
      result_image_url: resultUrl,
      mime_type: gen.mimeType,
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
      },
      scene: {
        id: scene.id,
        name: scene.name,
      },
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/scene-tools/background-swap] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
