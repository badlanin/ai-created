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
import { buildReplicatePrompt } from "@/lib/scene-tools-prompt";

export const runtime = "nodejs";
export const maxDuration = 600;

const MODEL = "gemini-3-pro-image-preview";
const SIZE = "4K" as const;
const TEMP = 0.4;
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

type ModelMeta = {
  label: string;
  position: string;
  role: string;
  pose: string;
  view: string;
  framing: string;
};

/**
 * POST /api/scene-tools/replicate/compose
 *
 * 仿图融合：参考图 + N 张产品图（按 A/B/C/D/E 顺序对应参考图模特位）→ 一张新合成图。
 * 参考图给场景/光线/构图/姿势，产品图给身份+服装。
 *
 * formData:
 *   - reference_image: File（参考图）
 *   - source_image_A: File
 *   - source_image_B?: File
 *   - source_image_C?: File
 *   - source_image_D?: File
 *   - source_image_E?: File
 *   - models_meta: string (JSON of analyze response models[])
 *   - aspect_ratio?: '3:4' | ... (默认 3:4)
 *   - user_hint?: string (≤ 200 字)
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    assertWithinBudget(user.id, user.role);

    const formData = await req.formData();

    // ─── 参考图 ───
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

    // ─── 解析 models_meta（来自 analyze）───
    const metaRaw = formData.get("models_meta");
    let models: ModelMeta[];
    try {
      const parsed = JSON.parse(String(metaRaw || "[]"));
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("models_meta 为空");
      }
      models = parsed.slice(0, 5).map((m, i) => ({
        label: ["A", "B", "C", "D", "E"][i],
        position: typeof m?.position === "string" ? m.position : "",
        role: typeof m?.role === "string" ? m.role : "",
        pose: typeof m?.pose === "string" ? m.pose : "",
        view: typeof m?.view === "string" ? m.view : "",
        framing: typeof m?.framing === "string" ? m.framing : "",
      }));
    } catch (e) {
      return NextResponse.json(
        { error: "models_meta 不合法，请重新解析参考图" },
        { status: 400 },
      );
    }

    // ─── 拿 N 张产品图（按 A/B/C/D/E 对应）───
    const sourceImages: File[] = [];
    for (const m of models) {
      const f = formData.get(`source_image_${m.label}`);
      if (!(f instanceof File)) {
        return NextResponse.json(
          {
            error: `Slot ${m.label} 的产品图未上传（source_image_${m.label}）`,
          },
          { status: 400 },
        );
      }
      if (f.size > 20 * 1024 * 1024) {
        return NextResponse.json(
          { error: `Slot ${m.label} 产品图太大（限 20MB）` },
          { status: 400 },
        );
      }
      sourceImages.push(f);
    }

    // ─── aspect_ratio ───
    const arRaw = formData.get("aspect_ratio");
    const aspectRatio =
      typeof arRaw === "string" && ALLOWED_RATIOS.includes(arRaw) ? arRaw : "3:4";

    // ─── user_hint ───
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

    // ─── 准备 inputs（IMAGE 1 = ref, IMAGES 2..N+1 = sources）───
    const refBuf = Buffer.from(await refImage.arrayBuffer());
    const refMime = refImage.type || "image/jpeg";
    const inputs: GenImageInput[] = [
      { buffer: refBuf, mimeType: refMime },
    ];
    for (const f of sourceImages) {
      const buf = Buffer.from(await f.arrayBuffer());
      inputs.push({ buffer: buf, mimeType: f.type || "image/jpeg" });
    }

    // ─── 调 Gemini Pro Image 4K ───
    const prompt = buildReplicatePrompt(models, userHint);
    const gen = await generateImage(inputs, prompt, MODEL, {
      aspectRatio,
      imageSize: SIZE,
      temperature: TEMP,
    });

    // ─── 落盘 ───
    const outputsDir = path.join(DATA_DIR_PATH, OUTPUT_DIR_REL);
    await fs.mkdir(outputsDir, { recursive: true });
    const ext = gen.mimeType.includes("png") ? "png" : "jpg";
    const outId = `replicate_${Date.now()}_${crypto
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
        kind: "scene-tools-replicate-compose",
        count: models.length,
        labels: models.map((m) => m.label),
        out_id: outId,
      },
    });

    // ─── history ───
    const promptTokens = gen.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = gen.usageMetadata?.candidatesTokenCount ?? 0;
    const costInfo = calcCost(MODEL, promptTokens, completionTokens);
    const resultUrl = `/assets/${OUTPUT_DIR_REL}/${filename}`;
    recordSingleShotJob({
      user_id: user.id,
      feature: "replicate",
      model: MODEL,
      label: `仿图 · ${models.length} 人`,
      result_image_path: `${OUTPUT_DIR_REL}/${filename}`,
      result_image_url: resultUrl,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_cny: costInfo.cost_cny,
      params: {
        count: models.length,
        models,
        aspect_ratio: aspectRatio,
        user_hint: userHint || null,
      },
    });

    return NextResponse.json({
      result_id: outId,
      result_image_url: resultUrl,
      mime_type: gen.mimeType,
      tokens: { prompt: promptTokens, completion: completionTokens },
      count: models.length,
      user_hint: userHint || null,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/scene-tools/replicate/compose] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
