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
  buildBackgroundSwapPrompt,
  isValidBackgroundSwapMode,
  type BackgroundSwapMode,
} from "@/lib/scene-tools-prompt";

export const runtime = "nodejs";
export const maxDuration = 600;

// 强制 Pro 模型 + 4K：背景换图必须用最强档（细节保留 + 光线匹配是难点）
const SWAP_MODEL = "gemini-3-pro-image-preview";
const SWAP_SIZE = "4K" as const;
// 不同 mode 用不同温度：
// - composition：稍高（0.4）让模型按场景重新布光 / 微调姿势
// - edit：低（0.2）锁定原图人物状态
const TEMP_BY_MODE: Record<BackgroundSwapMode, number> = {
  composition: 0.4,
  edit: 0.2,
};

const OUTPUT_DIR_REL = "outputs";

/**
 * POST /api/scene-tools/background-swap
 *
 * formData:
 *   - source_image: File (the original batch-photo result, the model + clothing)
 *   - scene_id: number (scene plate id from scenes table, must be usage='single')
 *   - aspect_ratio: '3:4' | '4:3' | '1:1' | etc (optional; defaults '3:4')
 *   - mode: 'composition' | 'edit' (optional; default 'composition')
 *       composition = 把人物当 identity+服装参考，在新场景里重新拍一张（重置光线/姿势/取景）
 *       edit = 在原片基础上仅替换背景（保留原姿势/原光线，几何对齐）
 *   - user_hint: string (optional, ≤200 chars) — 给模型的额外提示，例如"侧身倚墙""略低头微笑"
 *
 * 流程：
 *   1. 校验 source_image + scene_id（scene 必须 usage='single'）+ mode + user_hint
 *   2. 读 scene plate 文件 → 拼装 prompt（按 mode 选 composition / edit）
 *   3. 调 Gemini Pro Image（双图输入：原片 + scene plate）
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

    // ─── mode（composition 默认 / edit 兜底）───
    const modeRaw = formData.get("mode");
    const mode: BackgroundSwapMode =
      typeof modeRaw === "string" && isValidBackgroundSwapMode(modeRaw)
        ? modeRaw
        : "composition";

    // ─── user_hint（可选，≤200 字）───
    const userHintRaw = formData.get("user_hint");
    let userHint: string | undefined;
    if (typeof userHintRaw === "string") {
      const trimmed = userHintRaw.trim();
      if (trimmed.length > 0) {
        if (trimmed.length > 200) {
          return NextResponse.json(
            { error: "user_hint 太长（限 200 字）" },
            { status: 400 },
          );
        }
        userHint = trimmed;
      }
    }

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

    const prompt = buildBackgroundSwapPrompt(scene.name, mode, userHint);

    // ─── 调 Gemini Pro Image ───
    const gen = await generateImage(inputs, prompt, SWAP_MODEL, {
      aspectRatio,
      imageSize: SWAP_SIZE,
      temperature: TEMP_BY_MODE[mode],
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
        mode,
        user_hint: userHint || null,
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
      label: `背景换图 · ${scene.name}${mode === "composition" ? "（合成）" : "（编辑）"}`,
      result_image_path: `${OUTPUT_DIR_REL}/${filename}`,
      result_image_url: resultUrl,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_cny: costInfo.cost_cny,
      params: {
        scene_id: scene.id,
        scene_name: scene.name,
        aspect_ratio: aspectRatio,
        mode,
        user_hint: userHint || null,
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
      mode,
      user_hint: userHint || null,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/scene-tools/background-swap] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
