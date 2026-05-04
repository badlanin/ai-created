import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { DATA_DIR_PATH } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateImage } from "@/lib/gemini-image";
import { recordUsage } from "@/lib/usage";
import { assertWithinBudget } from "@/lib/pricing";
import {
  buildIdentityPrompt,
  isValidEthnicity,
  isValidAge,
  isValidHairColor,
  isValidHairStyle,
  isValidBodyShape,
  type IdentityParams,
} from "@/lib/identity-prompt";

export const runtime = "nodejs";
export const maxDuration = 600;

// 强制 Pro 模型 + 4K + 3:4：identity 出图必须用最强档，不接受降级
const IDENTITY_MODEL = "gemini-3-pro-image-preview";
const IDENTITY_ASPECT = "3:4" as const;
const IDENTITY_SIZE = "4K" as const;
// 温度低一点，prompt 写得这么死，不要让模型自由发挥
const IDENTITY_TEMP = 0.3;

const TEMP_DIR_REL = "temp/identity-gen";
const TEMP_TTL_MS = 60 * 60 * 1000; // 1 小时未提交的暂存图自动清理

/**
 * POST /api/identities/generate
 *
 * body: {
 *   ethnicity, age, hairColor, hairStyle, bodyShape  // 5 个枚举值
 * }
 *
 * 流程：
 *   1. 校验参数 → 拼装 v4 prompt → 调 Pro 4K 出图（约 30-90 秒）
 *   2. 暂存到 DATA_DIR/temp/identity-gen/<gen_id>.png
 *   3. 顺手清理超过 1 小时未提交的旧暂存
 *   4. 记账（usage_records，feature=other，notes 标记 identity-gen）
 *   5. 返回 { gen_id, image_url, params } 给前端预览
 *
 * 用户预览满意后调 POST /api/identities/commit 把 temp 提交进 identity 库。
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    assertWithinBudget(user.id, user.role);

    const body = (await req.json()) as Record<string, unknown>;

    if (!isValidEthnicity(body.ethnicity)) {
      return NextResponse.json({ error: "ethnicity 非法" }, { status: 400 });
    }
    if (!isValidAge(body.age)) {
      return NextResponse.json({ error: "age 非法" }, { status: 400 });
    }
    if (!isValidHairColor(body.hairColor)) {
      return NextResponse.json({ error: "hairColor 非法" }, { status: 400 });
    }
    if (!isValidHairStyle(body.hairStyle)) {
      return NextResponse.json({ error: "hairStyle 非法" }, { status: 400 });
    }
    if (!isValidBodyShape(body.bodyShape)) {
      return NextResponse.json({ error: "bodyShape 非法" }, { status: 400 });
    }

    const params: IdentityParams = {
      ethnicity: body.ethnicity,
      age: body.age,
      hairColor: body.hairColor,
      hairStyle: body.hairStyle,
      bodyShape: body.bodyShape,
    };

    const prompt = buildIdentityPrompt(params);

    // ─── 调 Gemini Pro Image ───
    const gen = await generateImage(
      [], // 纯文生图，无参考图
      prompt,
      IDENTITY_MODEL,
      {
        aspectRatio: IDENTITY_ASPECT,
        imageSize: IDENTITY_SIZE,
        temperature: IDENTITY_TEMP,
      },
    );

    // ─── 暂存到 temp ───
    const tempDir = path.join(DATA_DIR_PATH, TEMP_DIR_REL);
    await fs.mkdir(tempDir, { recursive: true });

    const ext = gen.mimeType.includes("png") ? "png" : "jpg";
    const genId = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const filename = `${genId}.${ext}`;
    const absPath = path.join(tempDir, filename);
    await fs.writeFile(absPath, gen.data);

    // ─── 清理超过 TTL 的旧 temp 文件（不阻塞返回）───
    cleanupTempFiles(tempDir).catch((e) => {
      console.warn("[identities/generate] temp cleanup 失败:", e);
    });

    // ─── 记账 ───
    recordUsage({
      userId: user.id,
      model: IDENTITY_MODEL,
      feature: "other",
      usageMetadata: gen.usageMetadata,
      success: true,
      notes: {
        kind: "identity-generator",
        params,
        gen_id: genId,
      },
    });

    return NextResponse.json({
      gen_id: genId,
      image_url: `/assets/${TEMP_DIR_REL}/${filename}`,
      params,
      mime_type: gen.mimeType,
      tokens: {
        prompt: gen.usageMetadata?.promptTokenCount ?? 0,
        completion: gen.usageMetadata?.candidatesTokenCount ?? 0,
      },
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/identities/generate] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * 清理 temp/identity-gen/ 下超过 TEMP_TTL_MS 的旧文件
 */
async function cleanupTempFiles(tempDir: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(tempDir);
  } catch {
    return; // 目录不存在就跳过
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
        // ignore individual errors
      }
    }),
  );
}
