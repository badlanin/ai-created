/**
 * OpenAI gpt-image-2 调用封装
 *
 * 跟 lib/gemini-image.ts 同 interface，方便统一 dispatcher。
 *
 * 鉴权：API key（admin → 系统设置 配置，存 settings 表 'openai_api_key'）
 * 代理：可选，admin → 系统设置 配 'openai_proxy_url'（例 http://127.0.0.1:7892）。
 *      GFW 环境下必需，否则 OpenAI API 走不出去。
 *
 * 两个端点：
 *   - generate (text → image)：images.generate
 *   - edit (multi-image input + text → image)：images.edit（Try-On / 仿图主用）
 *
 * 模型：
 *   - gpt-image-2（主力，4K 支持，高品质）
 *   - gpt-image-1-mini（备用，便宜；OpenAI 没有 gpt-image-2-mini）
 *
 * 价格（Tier 1 实测 5 IPM 上限，月预算 $100）：
 *   1024×1536 high  $0.165 / 张
 *   1024×1536 medium $0.041
 *   1024×1536 low   $0.005
 *   3840×2160 high  ~$0.50（4K，未实测）
 *
 * 内容审核：避免 "bodysuit / leotard / nude / tight" 等触发词，
 *           docs/new-identity-prompts.md 里有完整避雷指南。
 */

import OpenAI from "openai";
import { getDb } from "./db";

/** 单次调用硬超时 */
const CALL_TIMEOUT_MS = 580_000;

/**
 * gpt-image-2 size 约束（来自官方 prompting guide）：
 *   - max edge < 3840 px（严格小于！3840x2160 会被拒）
 *   - 两条边都是 16 的倍数
 *   - 长短边比例 ≤ 3:1
 *   - 总像素 655,360 ≤ N ≤ 8,294,400
 *
 * 因此 4K 用 3824x2144 / 2144x3824（被 16 整除 + max edge 3824 < 3840）
 * 2K 用 2560x1440 / 1440x2560（官方推荐 QHD）
 */
export type OpenAIImageSize =
  | "1024x1024"
  | "1024x1536"
  | "1536x1024"
  | "2560x1440"
  | "1440x2560"
  | "2048x2048"
  | "2048x1152"
  | "3824x2144"
  | "2144x3824"
  | "auto";

export type OpenAIImageQuality = "low" | "medium" | "high" | "auto";

export type OpenAIImageBackground = "transparent" | "opaque" | "auto";

export interface OpenAIImageInput {
  buffer: Buffer;
  mimeType: string;
  /** 可选文件名，默认 input_<i>.<ext> */
  filename?: string;
}

export interface OpenAIImageOptions {
  /** 输出尺寸，默认 1024x1536（竖） */
  size?: OpenAIImageSize;
  /** 画质档位，默认 high */
  quality?: OpenAIImageQuality;
  /** 输出格式，默认 png */
  outputFormat?: "png" | "jpeg" | "webp";
  /** jpeg/webp 压缩 0-100 */
  outputCompression?: number;
  /** moderation 严格度 */
  moderation?: "auto" | "low";
  /**
   * 背景：'opaque'（强制不透明，产品/电商主用）/ 'transparent'（透明背景 PNG）/ 'auto'
   * 默认让模型自己决定（auto）
   */
  background?: OpenAIImageBackground;
  /** 一次返回几张图（1..10），默认 1。identity 变体生成时建议 4 */
  n?: number;
}

export interface OpenAIImageResult {
  mimeType: string;
  data: Buffer; // 原始 PNG/JPEG/WebP 字节
  textResponse?: string;
  model: string;
  /** OpenAI 返回的 usage 信息（input + output tokens） */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

/* ───────── settings 读取 ───────── */

interface OpenAISettings {
  apiKey: string;
  proxyUrl: string;
}

function readSettings(): OpenAISettings {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT key, value FROM settings
         WHERE key IN ('openai_api_key', 'openai_proxy_url')`,
      )
      .all() as Array<{ key: string; value: string }>;
    let apiKey = "";
    let proxyUrl = "";
    for (const r of rows) {
      if (r.key === "openai_api_key") apiKey = (r.value || "").trim();
      if (r.key === "openai_proxy_url") proxyUrl = (r.value || "").trim();
    }
    return { apiKey, proxyUrl };
  } catch (err) {
    console.warn(
      "[openai-image] 读 settings 失败：",
      err instanceof Error ? err.message : err,
    );
    return { apiKey: "", proxyUrl: "" };
  }
}

/* ───────── 代理 fetch 构造 ─────────
 *
 * Node 自带 fetch 用的是内置 undici，跟 npm 装的 undici 不是同一实例，
 * 直接 setGlobalDispatcher 没用。
 * 这里用 undici.fetch + ProxyAgent 包装出一个新 fetch 函数，
 * 传给 OpenAI client 构造函数（OpenAI SDK 支持自定义 fetch）。
 */
async function buildFetchWithProxy(
  proxyUrl: string,
): Promise<typeof fetch | undefined> {
  if (!proxyUrl) return undefined;
  try {
    const undici = await import("undici");
    const dispatcher = new undici.ProxyAgent(proxyUrl);
    return ((input: RequestInfo | URL, init?: RequestInit) =>
      undici.fetch(input as any, {
        ...(init as any),
        dispatcher,
      }) as unknown as Promise<Response>) as typeof fetch;
  } catch (e) {
    console.warn(
      "[openai-image] 想走代理但加载 undici 失败：",
      e instanceof Error ? e.message : e,
    );
    return undefined;
  }
}

/* ───────── 构造 OpenAI client ───────── */

async function buildClient(): Promise<OpenAI> {
  const { apiKey, proxyUrl } = readSettings();
  if (!apiKey) {
    throw new Error(
      "OpenAI API key 未配置。去 admin → 系统设置 → 填入从 platform.openai.com 申请的 key 后重试。",
    );
  }
  const proxiedFetch = await buildFetchWithProxy(proxyUrl);
  return new OpenAI({
    apiKey,
    fetch: proxiedFetch,
  });
}

/* ───────── helper：超时包装 ───────── */

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${label} 超过 ${ms / 1000}s 无响应`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]);
}

/* ───────── helper：response → result ───────── */

function unpackResponse(
  response: { data?: Array<{ b64_json?: string }>; usage?: Record<string, unknown> },
  modelId: string,
  outputFormat?: "png" | "jpeg" | "webp",
): OpenAIImageResult {
  const item = response.data?.[0];
  if (!item?.b64_json) {
    throw new Error("OpenAI 没返回图片（b64_json 为空）");
  }
  const buffer = Buffer.from(item.b64_json, "base64");
  const mimeType =
    outputFormat === "jpeg"
      ? "image/jpeg"
      : outputFormat === "webp"
        ? "image/webp"
        : "image/png";
  return {
    mimeType,
    data: buffer,
    model: modelId,
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens as number | undefined,
          outputTokens: response.usage.output_tokens as number | undefined,
          totalTokens: response.usage.total_tokens as number | undefined,
        }
      : undefined,
  };
}

/* ───────── 主入口 ───────── */

/**
 * 纯文字 → 图（无输入图）
 *
 * 用例：identity 生成（从文字描述）/ 场景图从无生有
 */
export async function generateImageOpenAI(
  prompt: string,
  modelId: string = "gpt-image-2",
  options: OpenAIImageOptions = {},
): Promise<OpenAIImageResult> {
  const client = await buildClient();

  const callPromise = client.images.generate({
    model: modelId,
    prompt,
    size: (options.size || "1024x1536") as OpenAIImageSize,
    quality: (options.quality || "high") as OpenAIImageQuality,
    output_format: options.outputFormat,
    output_compression: options.outputCompression,
    moderation: options.moderation,
    background: options.background,
    n: options.n,
  } as Parameters<typeof client.images.generate>[0]);

  const response = await withTimeout(
    callPromise,
    CALL_TIMEOUT_MS,
    `OpenAI ${modelId} generate`,
  );

  const result = unpackResponse(response as never, modelId, options.outputFormat);
  console.log(
    `[openai-image] generate OK model=${modelId} size=${options.size ?? "1024x1536"} quality=${options.quality ?? "high"} → ${(result.data.length / 1024).toFixed(0)} KB`,
  );
  return result;
}

/**
 * 多图输入 + 文字 → 图（核心：Try-On / 仿图 / 多 source 合成）
 *
 * 用例：
 *   - Try-On：模特图 + 服装平铺图 → 模特穿着图
 *   - 仿图：参考图 + N 张产品图 → 多人合成
 *   - 背景换图：原片 + 场景图 → 换景成片
 */
export async function editImageOpenAI(
  images: OpenAIImageInput[],
  prompt: string,
  modelId: string = "gpt-image-2",
  options: OpenAIImageOptions = {},
): Promise<OpenAIImageResult> {
  if (images.length === 0) {
    throw new Error("editImageOpenAI 至少需要 1 张输入图");
  }
  const client = await buildClient();

  // OpenAI SDK 接受 File-like Uploadable。Buffer 用 toFile 转换
  const { toFile } = await import("openai/uploads");
  const imageFiles = await Promise.all(
    images.map(async (img, i) => {
      const ext = img.mimeType.split("/")[1] || "png";
      const filename = img.filename || `input_${i}.${ext}`;
      return toFile(img.buffer, filename, { type: img.mimeType });
    }),
  );

  const callPromise = client.images.edit({
    model: modelId,
    image: imageFiles as unknown as never, // SDK 类型不太准，运行时 OK
    prompt,
    size: (options.size || "1024x1536") as OpenAIImageSize,
    quality: (options.quality || "high") as OpenAIImageQuality,
    output_format: options.outputFormat,
    output_compression: options.outputCompression,
    moderation: options.moderation,
    background: options.background,
    n: options.n,
  } as Parameters<typeof client.images.edit>[0]);

  const response = await withTimeout(
    callPromise,
    CALL_TIMEOUT_MS,
    `OpenAI ${modelId} edit`,
  );

  const result = unpackResponse(response as never, modelId, options.outputFormat);
  console.log(
    `[openai-image] edit OK model=${modelId} inputs=${images.length} size=${options.size ?? "1024x1536"} quality=${options.quality ?? "high"} → ${(result.data.length / 1024).toFixed(0)} KB`,
  );
  return result;
}

/* ───────── 价格估算（按 size × quality 固定价）───────── */

/**
 * 估算单张图成本（USD）。
 * gpt-image-2 是按 output 固定价 + input tokens 计费。
 * 这里返回的是 output 固定价部分（占大头）。
 */
export function estimateOpenAIImageCostUSD(
  size: OpenAIImageSize,
  quality: OpenAIImageQuality,
): number {
  // 来源：OpenAI 官方 pricing 表（2026-04），按 (width*height) 像素插值
  // 4K 用 3824x2144 替代 3840x2160（API 边长上限 < 3840，含端点会拒）
  const table: Record<string, Record<string, number>> = {
    "1024x1024": { low: 0.006, medium: 0.053, high: 0.211 },
    "1024x1536": { low: 0.005, medium: 0.041, high: 0.165 },
    "1536x1024": { low: 0.005, medium: 0.041, high: 0.165 },
    "2560x1440": { low: 0.028, medium: 0.250, high: 1.0 },
    "1440x2560": { low: 0.028, medium: 0.250, high: 1.0 },
    "2048x2048": { low: 0.024, medium: 0.212, high: 0.844 },
    "2048x1152": { low: 0.018, medium: 0.159, high: 0.633 },
    "3824x2144": { low: 0.064, medium: 0.560, high: 2.24 },
    "2144x3824": { low: 0.064, medium: 0.560, high: 2.24 },
  };
  const sz = table[size as string] || table["1024x1536"];
  const q = quality === "auto" ? "high" : quality;
  return sz[q] ?? sz.high;
}

/** USD → CNY 估算（按 settings.usd_to_cny 默认 7.1） */
export function estimateOpenAIImageCostCNY(
  size: OpenAIImageSize,
  quality: OpenAIImageQuality,
  usdToCny: number = 7.1,
): number {
  return estimateOpenAIImageCostUSD(size, quality) * usdToCny;
}
