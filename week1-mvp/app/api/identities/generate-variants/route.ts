import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { DATA_DIR_PATH } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateImage, estimateImageCostUSD } from "@/lib/image-gen";
import { recordUsage } from "@/lib/usage";
import { assertWithinBudget } from "@/lib/pricing";
import {
  buildPrototypeVariantPrompt,
  isValidPrototypeEthnicity,
  isValidPrototypeAge,
  isValidPrototypeHairColor,
  isValidPrototypeHairStyle,
  type PrototypeParams,
} from "@/lib/identity-prototype-prompt";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * POST /api/identities/generate-variants
 *
 * "原型 + 变体"模式：
 *   1. 用户上传一张真人原型图（multipart formData: prototype）
 *   2. 选 ethnicity / age / hairColor / hairStyle 4 个维度
 *   3. 选变体数 N（1..4）
 *   4. 后台用 OpenAI gpt-image-2 的 edit 模式跑 N 张变体（保留身体/姿势/背景，换头 + 换中性服装）
 *   5. 返回 N 个 { gen_id, image_url, params } 让前端预览
 *   6. 用户挑满意的那张去 /api/identities/commit 落库
 *
 * 用 OpenAI 不用 Gemini：
 *   - prompt 是英文 "preserve body/pose/lighting, change face/hair/outfit"，OpenAI 跟得更紧
 *   - OpenAI 支持 n 参数原生跑变体（实测一次出 N 张比循环 N 次稳定）
 *   - identity 出图对 face preservation 不重要，对 body geometry preservation 重要 —— OpenAI edit 在这块做得更好
 *
 * 模型：gpt-image-2（4K 系列 size 自动按 aspect 选）
 *
 * formData：
 *   - prototype: File（必传，原型图）
 *   - ethnicity / age / hairColor / hairStyle: string（4 个枚举值）
 *   - n: 1..4（默认 1）
 */
const TEMP_DIR_REL = "temp/identity-gen";
const TEMP_TTL_MS = 60 * 60 * 1000;

// OpenAI gpt-image-2 系列 + 高画质 + 竖向 1024x1536（够清晰、不烧钱）
// 4K 一张 $2.24，N=4 就要 $9 = ¥64，太贵；high quality 1024x1536 一张 $0.165，N=4 约 ¥4.7
const VARIANT_MODEL = "gpt-image-2";
const VARIANT_SIZE = "1024x1536" as const;
const VARIANT_QUALITY = "high" as const;

export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    assertWithinBudget(user.id, user.role);

    const formData = await req.formData();

    // ─── 原型图（必传） ───
    const prototypeRaw = formData.get("prototype");
    if (!(prototypeRaw instanceof File)) {
      return NextResponse.json(
        { error: "prototype（原型图）必传" },
        { status: 400 },
      );
    }
    if (prototypeRaw.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "原型图太大（限 20MB）" },
        { status: 400 },
      );
    }
    if (!prototypeRaw.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "原型必须是图片" },
        { status: 400 },
      );
    }

    // ─── 4 个枚举参数 ───
    const ethnicity = formData.get("ethnicity");
    const age = formData.get("age");
    const hairColor = formData.get("hairColor");
    const hairStyle = formData.get("hairStyle");

    if (!isValidPrototypeEthnicity(ethnicity)) {
      return NextResponse.json({ error: "ethnicity 非法" }, { status: 400 });
    }
    if (!isValidPrototypeAge(age)) {
      return NextResponse.json({ error: "age 非法" }, { status: 400 });
    }
    if (!isValidPrototypeHairColor(hairColor)) {
      return NextResponse.json({ error: "hairColor 非法" }, { status: 400 });
    }
    if (!isValidPrototypeHairStyle(hairStyle)) {
      return NextResponse.json({ error: "hairStyle 非法" }, { status: 400 });
    }

    const params: PrototypeParams = { ethnicity, age, hairColor, hairStyle };

    // ─── 变体数 N（1..4） ───
    const nRaw = formData.get("n");
    let n = Number(nRaw);
    if (!Number.isFinite(n) || n < 1) n = 1;
    if (n > 4) n = 4;

    // ─── 构造 prompt + 输入 buffer ───
    const prompt = buildPrototypeVariantPrompt(params);
    const prototypeBuf = Buffer.from(await prototypeRaw.arrayBuffer());
    const prototypeInput = {
      buffer: prototypeBuf,
      mimeType: prototypeRaw.type || "image/jpeg",
    };

    // ─── 并行跑 N 次（每次 n=1） ───
    // 不用 OpenAI 的 n=N 参数：实测同一次调用的多张变体差异不大；
    // 拆成 N 次独立调用 + 每次都是新随机种子，变体更明显。
    // Tier 1 = 5 IPM，N 最多 4 不会超限。
    const tempDir = path.join(DATA_DIR_PATH, TEMP_DIR_REL);
    await fs.mkdir(tempDir, { recursive: true });

    const results = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        const gen = await generateImage({
          inputs: [prototypeInput],
          prompt,
          modelId: VARIANT_MODEL,
          size: VARIANT_SIZE,
          quality: VARIANT_QUALITY,
        });

        const ext = gen.mimeType.includes("png") ? "png" : "jpg";
        const genId = `${Date.now()}_${i}_${crypto.randomBytes(4).toString("hex")}`;
        const filename = `${genId}.${ext}`;
        const absPath = path.join(tempDir, filename);
        await fs.writeFile(absPath, gen.data);

        // 记账：OpenAI 走固定单价
        const costOverrideUsd = estimateImageCostUSD({
          modelId: VARIANT_MODEL,
          size: VARIANT_SIZE,
          quality: VARIANT_QUALITY,
        });
        recordUsage({
          userId: user.id,
          model: VARIANT_MODEL,
          feature: "other",
          usageMetadata: {
            promptTokenCount: gen.usage?.inputTokens,
            candidatesTokenCount: gen.usage?.outputTokens,
            totalTokenCount: gen.usage?.totalTokens,
          },
          success: true,
          costOverrideUsd,
          notes: {
            kind: "identity-generator-variant",
            provider: gen.provider,
            params,
            variant_idx: i,
            gen_id: genId,
          },
        });

        return {
          gen_id: genId,
          image_url: `/assets/${TEMP_DIR_REL}/${filename}`,
          mime_type: gen.mimeType,
        };
      }),
    );

    // ─── 清理超过 TTL 的旧 temp 文件（不阻塞返回） ───
    cleanupTempFiles(tempDir).catch((e) => {
      console.warn("[generate-variants] temp cleanup 失败:", e);
    });

    return NextResponse.json({
      variants: results,
      params,
      model: VARIANT_MODEL,
      count: results.length,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/identities/generate-variants] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}

async function cleanupTempFiles(tempDir: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(tempDir);
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    entries.map(async (name) => {
      const abs = path.join(tempDir, name);
      try {
        const stat = await fs.stat(abs);
        if (!stat.isFile()) return;
        if (now - stat.mtimeMs > TEMP_TTL_MS) {
          await fs.unlink(abs);
        }
      } catch {
        // ignore
      }
    }),
  );
}
