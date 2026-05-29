import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { assertWithinBudget } from "@/lib/pricing";
import { recordUsage } from "@/lib/usage";
import { DATA_DIR_PATH } from "@/lib/db";
import { buildGenaiClient } from "@/lib/genai-client";

export const runtime = "nodejs";
export const maxDuration = 60;

const PRODUCT_LISTING_GEMINI_MODEL = "gemini-2.5-flash";
const CALL_TIMEOUT_MS = 55_000;

type MediaInput = {
  url?: string;
  alt?: string | null;
  role?: string | null;
};

const PRODUCT_LISTING_SYSTEM_PROMPT = `你是专业的 Shopify 礼服商品上架助手。
请根据用户提示词和商品图片，生成可直接用于 Shopify 商品页的信息。

输出要求：
- 必须以用户提供的商品图片为主要依据，优先识别图片中的颜色、面料、版型、领口、细节和商品风格。
- 只输出字段内容，不要 Markdown、代码块、解释、寒暄。
- 使用 key: value 格式，每个字段单独一行。
- 字段建议包含：商品标题、商品描述、产品类型、供应商、产品系列、标签、主色调、面料材质、领口设计、整体版型、SKU、原价、售价、库存、SEO标题、SEO描述。
- 同时输出 Shopify 类别元字段，字段名固定为：类别元字段颜色、类别元字段尺寸、类别元字段织物、类别元字段年龄段、类别元字段穿着场合、类别元字段裙子风格、类别元字段领口、类别元字段裙子/连衣裙长度类型、类别元字段袖长类型、类别元字段目标性别。
- 字段名使用中文，字段值可按用户要求使用英文或中文；如果用户没有指定，商品标题、描述、标签和 SEO 信息优先使用英文。
- 不要编造图片中看不到的强细节；不确定的字段保持稳妥、商品化表达。
- 内容保持干净，去掉多余空格、乱码、无效控制字符。`;

export async function POST(req: NextRequest) {
  let user: { id: number; role: string } | null = null;
  const model = PRODUCT_LISTING_GEMINI_MODEL;
  try {
    user = await requireUser();
    assertWithinBudget(user.id, user.role);

    const body = (await req.json()) as {
      prompt?: string;
      media?: MediaInput[];
    };
    const prompt = sanitizeText(body.prompt || "");
    if (!prompt) {
      return NextResponse.json(
        { error: "请输入大模型提示词" },
        { status: 400 },
      );
    }

    const media = Array.isArray(body.media) ? body.media.slice(0, 8) : [];
    const warnings: string[] = [];
    const images = [];
    for (const item of media) {
      const loaded = await loadLocalAssetImage(item, warnings);
      if (loaded) images.push(loaded);
    }
    if (media.length === 0) {
      return NextResponse.json(
        { error: "请先在媒体 Media 中添加商品图片，再开始解析。" },
        { status: 400 },
      );
    }
    if (images.length === 0) {
      return NextResponse.json(
        {
          error:
            warnings[0] ||
            "媒体 Media 中没有可读取的本地图片，请重新上传或从历史记录加入图片。",
          warnings,
        },
        { status: 400 },
      );
    }

    const mediaSummary =
      media.length > 0
        ? media
            .map((item, index) => {
              const role = item.role ? ` / ${item.role}` : "";
              const alt = item.alt ? ` / ${item.alt}` : "";
              return `${index + 1}. ${item.url || "无 URL"}${role}${alt}`;
            })
            .join("\n")
        : "当前没有媒体图片，请只根据用户提示词整理可上架内容。";

    const client = buildGenaiClient();
    const result = await withTimeout(
      client.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `用户提示词：
${prompt}

媒体 Media：
${mediaSummary}

请严格根据以上 ${images.length} 张商品图片生成，不要脱离图片内容。`,
              },
              ...images.map((image) => ({
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.buffer.toString("base64"),
                },
              })),
            ],
          },
        ],
        config: {
          systemInstruction: PRODUCT_LISTING_SYSTEM_PROMPT,
          temperature: 0.25,
        },
      }),
      CALL_TIMEOUT_MS,
    );

    const text = sanitizeText(result.text || "");
    if (!text) {
      throw new Error("大模型没有返回可用内容，请调整提示词后重试。");
    }

    recordUsage({
      userId: user.id,
      model,
      feature: "other",
      usageMetadata: result.usageMetadata,
      success: true,
      notes: {
        kind: "product-listing-ai-output",
        provider: "gemini_api",
        media_count: images.length,
        skipped_media_count: Math.max(0, media.length - images.length),
      },
    });

    return NextResponse.json({
      ok: true,
      text,
      cleanedText: text,
      model,
      imageCount: images.length,
      warnings,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/product-listing/ai-output] 失败:", msg);
    if (user && status !== 429) {
      recordUsage({
        userId: user.id,
        model,
        feature: "other",
        success: false,
        error: msg,
        notes: { kind: "product-listing-ai-output", provider: "gemini_api" },
      });
    }
    return NextResponse.json({ error: msg }, { status });
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Gemini 调用超时，请稍后重试。")),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadLocalAssetImage(
  item: MediaInput,
  warnings: string[],
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const url = (item.url || "").trim();
  if (!url.startsWith("/assets/")) {
    if (url) warnings.push(`已跳过非本地媒体：${url}`);
    return null;
  }

  const cleanPath = decodeURIComponent(url.split("?")[0].slice("/assets/".length));
  const absPath = path.resolve(DATA_DIR_PATH, cleanPath);
  const dataRoot = path.resolve(DATA_DIR_PATH);
  if (!absPath.startsWith(dataRoot + path.sep)) {
    warnings.push(`已跳过非法媒体路径：${url}`);
    return null;
  }

  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) {
      warnings.push(`媒体不是文件：${url}`);
      return null;
    }
    return {
      buffer: await fs.readFile(absPath),
      mimeType: mimeFromPath(absPath),
    };
  } catch {
    warnings.push(`媒体文件不存在：${url}`);
    return null;
  }
}

function mimeFromPath(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function sanitizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
