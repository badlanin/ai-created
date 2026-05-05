import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { DATA_DIR_PATH, getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateImage, type GenImageInput } from "@/lib/gemini-image";
import { recordUsage } from "@/lib/usage";
import { assertWithinBudget } from "@/lib/pricing";
import {
  buildSocialSnapPrompt,
  isValidSocialVibe,
  type SocialVibe,
} from "@/lib/scene-tools-prompt";

export const runtime = "nodejs";
export const maxDuration = 600;

// 社媒图：Pro 模型保证多人合成质量；2K 够用（社媒不需要 4K）
const SNAP_MODEL = "gemini-3-pro-image-preview";
const SNAP_SIZE = "2K" as const;
// 温度稍高 —— "imperfection 就是真实感"，让模型自由发挥构图
const SNAP_TEMP = 0.5;

const OUTPUT_DIR_REL = "outputs";

// scene plate 同时接受 single 或 poster（社媒可在任何场景里拍）
const ALLOWED_USAGE = new Set(["single", "poster"]);

const ALLOWED_RATIOS = ["9:16", "1:1", "4:5", "16:9", "3:4"];

/**
 * POST /api/scene-tools/social-snap
 *
 * formData:
 *   - product_image: File（产品/服装图）
 *   - identity_ids: JSON array of 1-3 numbers（identity 的 model.id）
 *   - scene_id: number
 *   - aspect_ratio: '9:16' | '1:1' | '4:5' | '16:9' | '3:4'
 *   - vibe: 'casual' | 'party' | 'street' | 'lifestyle'
 *
 * 流程：
 *   1. 校验入参 + 加载 identity / scene
 *   2. 拼装 prompt（多 identity 自动适配）
 *   3. 调 Gemini Pro Image 多图合成（产品 + N identity + scene plate）
 *   4. 输出落盘 → 记账 → 返 result_url
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    assertWithinBudget(user.id, user.role);

    const formData = await req.formData();

    // ─── 产品图 ───
    const productImage = formData.get("product_image");
    if (!(productImage instanceof File)) {
      return NextResponse.json(
        { error: "请上传产品图（product_image）" },
        { status: 400 },
      );
    }
    if (productImage.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "产品图太大（限 20MB）" },
        { status: 400 },
      );
    }

    // ─── identity ids ───
    const identityIdsRaw = formData.get("identity_ids");
    let identityIds: number[] = [];
    try {
      const parsed = JSON.parse(String(identityIdsRaw || "[]"));
      if (Array.isArray(parsed)) {
        identityIds = parsed.filter((v) => Number.isFinite(v)).map(Number);
      }
    } catch {}
    if (identityIds.length === 0) {
      return NextResponse.json(
        { error: "请至少选 1 个 identity" },
        { status: 400 },
      );
    }
    if (identityIds.length > 3) {
      return NextResponse.json(
        { error: "最多 3 个 identity" },
        { status: 400 },
      );
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
        : "9:16"; // 默认竖屏 stories 比例

    // ─── vibe ───
    const vibeRaw = formData.get("vibe");
    if (!isValidSocialVibe(vibeRaw)) {
      return NextResponse.json({ error: "vibe 非法" }, { status: 400 });
    }
    const vibe: SocialVibe = vibeRaw;

    // ─── 加载 identity 行 ───
    const db = getDb();
    const idPlaceholders = identityIds.map(() => "?").join(",");
    const identities = db
      .prepare(
        `SELECT id, name, image_path FROM models
         WHERE kind = 'identity' AND id IN (${idPlaceholders})`,
      )
      .all(...identityIds) as Array<{
      id: number;
      name: string;
      image_path: string;
    }>;
    if (identities.length !== identityIds.length) {
      return NextResponse.json(
        { error: "部分 identity 不存在" },
        { status: 404 },
      );
    }
    // 保持顺序与传入一致
    const identityById = new Map(identities.map((i) => [i.id, i]));
    const orderedIdentities = identityIds.map((id) => identityById.get(id)!);

    // ─── 加载 scene ───
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
    const productBuf = Buffer.from(await productImage.arrayBuffer());
    const productMime = productImage.type || "image/jpeg";

    const identityBufs = await Promise.all(
      orderedIdentities.map(async (idn) => ({
        buffer: await fs.readFile(path.join(DATA_DIR_PATH, idn.image_path)),
        mimeType: "image/png" as string,
      })),
    );

    const sceneAbsPath = path.join(DATA_DIR_PATH, scene.image_path);
    const sceneBuf = await fs.readFile(sceneAbsPath);
    const sceneMime = sceneAbsPath.toLowerCase().endsWith(".png")
      ? "image/png"
      : sceneAbsPath.toLowerCase().endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";

    // ─── 顺序：产品 / identities / scene （跟 prompt 里描述对齐）───
    const inputs: GenImageInput[] = [
      { buffer: productBuf, mimeType: productMime },
      ...identityBufs,
      { buffer: sceneBuf, mimeType: sceneMime },
    ];

    const prompt = buildSocialSnapPrompt(
      orderedIdentities.length,
      vibe,
      scene.name,
    );

    // ─── 调 Gemini ───
    const gen = await generateImage(inputs, prompt, SNAP_MODEL, {
      aspectRatio,
      imageSize: SNAP_SIZE,
      temperature: SNAP_TEMP,
    });

    // ─── 落盘 ───
    const outputsDir = path.join(DATA_DIR_PATH, OUTPUT_DIR_REL);
    await fs.mkdir(outputsDir, { recursive: true });

    const ext = gen.mimeType.includes("png") ? "png" : "jpg";
    const outId = `snap_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const filename = `${outId}.${ext}`;
    const absPath = path.join(outputsDir, filename);
    await fs.writeFile(absPath, gen.data);

    // ─── 记账 ───
    recordUsage({
      userId: user.id,
      model: SNAP_MODEL,
      feature: "other",
      usageMetadata: gen.usageMetadata,
      success: true,
      notes: {
        kind: "scene-tools-social-snap",
        identity_count: orderedIdentities.length,
        identity_ids: identityIds,
        scene_id: scene.id,
        scene_name: scene.name,
        vibe,
        aspect_ratio: aspectRatio,
        out_id: outId,
      },
    });

    return NextResponse.json({
      result_id: outId,
      result_image_url: `/assets/${OUTPUT_DIR_REL}/${filename}`,
      mime_type: gen.mimeType,
      tokens: {
        prompt: gen.usageMetadata?.promptTokenCount ?? 0,
        completion: gen.usageMetadata?.candidatesTokenCount ?? 0,
      },
      scene: { id: scene.id, name: scene.name },
      identities: orderedIdentities.map((i) => ({ id: i.id, name: i.name })),
      vibe,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/scene-tools/social-snap] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
