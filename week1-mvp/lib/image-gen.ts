/**
 * 统一出图入口（多 provider 分发）
 *
 * 用法：
 *   import { generateImage } from "@/lib/image-gen";
 *   const result = await generateImage({
 *     inputs: [{buffer, mimeType}, ...],
 *     prompt: "...",
 *     modelId: "gpt-image-2",        // 或 "gemini-3-pro-image-preview"
 *     aspectRatio: "3:4",
 *     imageSize: "4K",                // Gemini 用
 *     quality: "high",                // OpenAI 用
 *     size: "2160x3840",              // OpenAI 用（替代 aspectRatio + imageSize）
 *     temperature: 0.4,               // 只 Gemini 支持
 *     seed: 12345,                    // 只 Gemini 支持
 *   });
 *
 * 按 modelId 前缀自动分发到 gemini-image / openai-image，
 * 返回统一 shape 的结果（包含 mimeType / data / model / usageMetadata）。
 */

import {
  generateImage as generateImageGemini,
  type GenImageInput,
  type GenImageResult,
  type GenImageOptions,
} from "./gemini-image";
import {
  editImageOpenAI,
  generateImageOpenAI,
  estimateOpenAIImageCostUSD,
  type OpenAIImageBackground,
  type OpenAIImageInput,
  type OpenAIImageResult,
  type OpenAIImageSize,
  type OpenAIImageQuality,
} from "./openai-image";

export type ImageProvider = "gemini" | "openai";

/** 按 modelId 推断 provider */
export function getProviderForModel(modelId: string): ImageProvider {
  if (modelId.startsWith("gpt-image")) return "openai";
  return "gemini";
}

/**
 * 通用出图参数。两个 provider 的参数尽量在这里规整成一套，
 * 内部 dispatcher 会按 provider 取它需要的字段。
 */
export interface UnifiedImageOptions {
  /** 输入参考图（0 张 = 纯文生图；多张 = edit / multi-image edit）*/
  inputs?: Array<{ buffer: Buffer; mimeType: string; filename?: string }>;

  /** prompt 文本（必填）*/
  prompt: string;

  /** 模型 ID。决定走哪个 provider */
  modelId: string;

  // ── Gemini-flavored params ──
  /** Gemini: '3:4' '4:3' '1:1' '16:9' '9:16' 等 */
  aspectRatio?: string;
  /** Gemini: '1K' | '2K' | '4K' */
  imageSize?: "0.5K" | "1K" | "2K" | "4K";
  /** Gemini: seed（弱锁），OpenAI 不支持 */
  seed?: number;
  /** Gemini: 0-1 temperature，OpenAI 不支持 */
  temperature?: number;

  // ── OpenAI-flavored params ──
  /** OpenAI: 显式像素 size，如 "2160x3840"。优先级高于 aspectRatio+imageSize */
  size?: OpenAIImageSize;
  /** OpenAI: 'low' | 'medium' | 'high' | 'auto'。等价于画质档位 */
  quality?: OpenAIImageQuality;
  /** OpenAI: 'png' | 'jpeg' | 'webp'，默认 png */
  outputFormat?: "png" | "jpeg" | "webp";
  /** OpenAI: jpeg/webp 压缩 0-100 */
  outputCompression?: number;
  /**
   * OpenAI: 背景控制 —— 'opaque'（强制不透明，产品/电商）/ 'transparent'（透明 PNG）/ 'auto'
   * Gemini 路径忽略
   */
  background?: OpenAIImageBackground;
  /**
   * OpenAI: 一次返回几张图（1..10）。Gemini 路径忽略（Gemini 一次返回 1 张）
   * 当前 wrapper 仍返回首张（n>1 时其余被丢，未来可改成数组返回）
   */
  n?: number;
}

/** 统一返回 */
export interface UnifiedImageResult {
  mimeType: string;
  data: Buffer;
  model: string;
  provider: ImageProvider;
  textResponse?: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

/* ───────── aspectRatio + imageSize → OpenAI size 映射 ───────── */

/**
 * 判断该 OpenAI 模型是否只支持 legacy 固定 size 集
 * （gpt-image-1 / 1.5 / 1-mini 都只支持 1024x1024 / 1024x1536 / 1536x1024 / auto）。
 * 只有 gpt-image-2 支持自定义 size + 2K/4K。
 */
function isLegacyOpenAISizeModel(modelId: string): boolean {
  if (!modelId.startsWith("gpt-image")) return false;
  // gpt-image-2 是新模型，支持自定义；其他全部 legacy
  return !modelId.startsWith("gpt-image-2");
}

function mapAspectAndSizeToOpenAI(
  aspectRatio?: string,
  imageSize?: "0.5K" | "1K" | "2K" | "4K",
  modelId?: string,
): OpenAIImageSize {
  // 横竖判断
  let isPortrait = false;
  let isSquare = false;
  if (aspectRatio) {
    const [w, h] = aspectRatio.split(":").map(Number);
    if (w && h) {
      isPortrait = h > w;
      isSquare = w === h;
    }
  }

  const tier = imageSize || "1K";
  const legacy = modelId ? isLegacyOpenAISizeModel(modelId) : false;

  // ─── Legacy 模型（gpt-image-1 / 1.5 / 1-mini）：只能 1024x1024 / 1024x1536 / 1536x1024 ───
  // 2K/4K 档位降级到 legacy 集里的最大尺寸（portrait 1024x1536 / landscape 1536x1024 / square 1024x1024）
  if (legacy) {
    if (isSquare) return "1024x1024";
    if (isPortrait) return "1024x1536";
    return "1536x1024";
  }

  // ─── gpt-image-2（max edge < 3840 严格小于；2K 用 2560x1440 官方推荐档）───

  if (isSquare) {
    // 方形
    if (tier === "1K") return "1024x1024";
    if (tier === "2K") return "2048x2048";
    if (tier === "4K") return "2048x2048"; // 方形 4K 受 max-edge 3:1 约束影响小，2K 已足够
    return "1024x1024";
  }

  if (isPortrait) {
    if (tier === "1K") return "1024x1536";
    if (tier === "2K") return "1440x2560";
    if (tier === "4K") return "2144x3824";
    return "1024x1536";
  }

  // landscape
  if (tier === "1K") return "1536x1024";
  if (tier === "2K") return "2560x1440";
  if (tier === "4K") return "3824x2144";
  return "1536x1024";
}

/* ───────── imageSize → OpenAI quality 映射（如果用户没显式传 quality） ───────── */

function mapImageSizeToQuality(
  imageSize?: "0.5K" | "1K" | "2K" | "4K",
): OpenAIImageQuality {
  if (imageSize === "4K" || imageSize === "2K") return "high";
  if (imageSize === "1K") return "medium";
  return "low";
}

/* ───────── 主 dispatcher ───────── */

export async function generateImage(
  opts: UnifiedImageOptions,
): Promise<UnifiedImageResult> {
  const provider = getProviderForModel(opts.modelId);
  const inputs = opts.inputs || [];

  if (provider === "openai") {
    // OpenAI 路径
    const size: OpenAIImageSize =
      opts.size ??
      mapAspectAndSizeToOpenAI(opts.aspectRatio, opts.imageSize, opts.modelId);
    const quality: OpenAIImageQuality =
      opts.quality ?? mapImageSizeToQuality(opts.imageSize);

    let result: OpenAIImageResult;
    if (inputs.length === 0) {
      result = await generateImageOpenAI(opts.prompt, opts.modelId, {
        size,
        quality,
        outputFormat: opts.outputFormat,
        outputCompression: opts.outputCompression,
        background: opts.background,
        n: opts.n,
      });
    } else {
      const openaiInputs: OpenAIImageInput[] = inputs.map((i) => ({
        buffer: i.buffer,
        mimeType: i.mimeType,
        filename: i.filename,
      }));
      result = await editImageOpenAI(openaiInputs, opts.prompt, opts.modelId, {
        size,
        quality,
        outputFormat: opts.outputFormat,
        outputCompression: opts.outputCompression,
        background: opts.background,
        n: opts.n,
      });
    }
    return {
      mimeType: result.mimeType,
      data: result.data,
      model: result.model,
      provider: "openai",
      usage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        totalTokens: result.usage?.totalTokens,
      },
    };
  }

  // Gemini 路径
  const geminiInputs: GenImageInput[] = inputs.map((i) => ({
    buffer: i.buffer,
    mimeType: i.mimeType,
  }));
  const geminiOptions: GenImageOptions = {
    aspectRatio: opts.aspectRatio,
    imageSize: opts.imageSize,
    seed: opts.seed,
    temperature: opts.temperature,
  };
  const result: GenImageResult = await generateImageGemini(
    geminiInputs,
    opts.prompt,
    opts.modelId,
    geminiOptions,
  );
  return {
    mimeType: result.mimeType,
    data: result.data,
    model: result.model,
    provider: "gemini",
    textResponse: result.textResponse,
    usage: {
      inputTokens: result.usageMetadata?.promptTokenCount,
      outputTokens: result.usageMetadata?.candidatesTokenCount,
      totalTokens: result.usageMetadata?.totalTokenCount,
    },
  };
}

/**
 * 价格估算（按 provider + size + quality）
 */
export function estimateImageCostUSD(opts: {
  modelId: string;
  size?: OpenAIImageSize;
  quality?: OpenAIImageQuality;
  aspectRatio?: string;
  imageSize?: "0.5K" | "1K" | "2K" | "4K";
}): number {
  const provider = getProviderForModel(opts.modelId);
  if (provider === "openai") {
    const size =
      opts.size ??
      mapAspectAndSizeToOpenAI(opts.aspectRatio, opts.imageSize, opts.modelId);
    const quality = opts.quality ?? mapImageSizeToQuality(opts.imageSize);
    return estimateOpenAIImageCostUSD(size, quality);
  }
  // Gemini 走 token 计费，这里返回 0，让上游用 lib/pricing 估算
  return 0;
}
