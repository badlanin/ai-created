import { resolveModelId } from "./ai-models";
import { buildGenaiClient } from "./genai-client";
import { readImageInfo, formatImageInfo } from "./image-info";

/**
 * Nano Banana (Gemini * Image) 调用封装
 *
 * 能力：
 * - 输入若干张参考图 + 文本提示，生成新图
 * - 适合：换色、风格迁移、模特穿着合成
 *
 * 鉴权：Gemini API key（直连 aistudio.google.com）
 *   - 由 admin → 系统设置 配置，存在 settings 表里
 *
 * 可用模型由 ai_models 表动态维护（/admin/ai-models 管理）。
 *
 * 每次调用硬超时保护，避免请求挂起不返回：
 * - Flash Image 系列通常 5-15 秒出图
 * - Pro Image 系列有思考阶段（Thinking），可能 30-180 秒
 * - 我们给它 580s（9.6 分钟）上限，配合 thinkingBudget 限制思考长度
 * - 对应 route 里 maxDuration 要设 600s（留 20s 给 Next.js 返回错误）
 */

/** 单次 Gemini 调用超时（毫秒）。配套 maxDuration = 600s */
const CALL_TIMEOUT_MS = 580_000;

export interface GenImageInput {
  buffer: Buffer;
  mimeType: string;
}

export interface GenImageResult {
  mimeType: string;
  data: Buffer; // 生成图的原始字节
  textResponse?: string; // 模型附带的文本（通常有一段描述）
  model: string; // 实际用到的模型 ID（记录到 generations 表）
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  }; // Gemini API 返回的真实 token 计数，用于计费
}

/**
 * 调用 Nano Banana 生成一张新图。
 *
 * @param images 参考图列表（如产品正面/背面、模特图、场景图）
 * @param prompt 文本指令
 * @param modelOverride 单次调用的模型 ID（会经 resolveModelId 白名单校验）
 */
export interface GenImageOptions {
  /** 输出图片比例，如 '3:4' '2:3' '1:1' '16:9' 等。默认由模型决定（通常 1:1） */
  aspectRatio?: string;
  /**
   * 输出图片"档位"：'1K' | '2K' | '4K'（还有 '0.5K'）
   *
   * 默认 '1K'（约 896×1200 / 1024×1024）。
   * 关键：`gemini-3-pro-image-preview` 会按此输出真实对应分辨率；
   * 但 `gemini-3.1-flash-image-preview` 和 2.5 系列目前**静默忽略**，
   * 始终输出 ~1K。所以要真的 4K 输出，需要用 Pro 模型 + imageSize='4K'。
   */
  imageSize?: "0.5K" | "1K" | "2K" | "4K";
  /**
   * 随机种子（整数）—— 同一个 batch 的多张图传同一个 seed，
   * 让 AI 输出一致的脸 / 光线 / 背景，只让姿势/颜色等指令性元素变化。
   * 不传则每次都是新随机种子，batch 内会出现脸不同、背景漂移等问题。
   *
   * 注意：Gemini 图像模型对 seed 的"严格性"不如文本模型。
   * 即使同 seed，AI 还会有约 5-15% 的自由度。配合 temperature=0.1-0.2
   * 才能最大化一致性。
   */
  seed?: number;
  /**
   * 采样温度（0.0-1.0）。默认 0.4。
   * 批次一致性场景建议设 0.1-0.2，让 AI 别"自由发挥"。
   */
  temperature?: number;
}

export async function generateImage(
  images: GenImageInput[],
  prompt: string,
  modelOverride?: string,
  options: GenImageOptions = {},
): Promise<GenImageResult> {
  const MODEL = resolveModelId("image_gen", modelOverride);
  const ai = buildGenaiClient();

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [
    { text: prompt },
    ...images.map((img) => ({
      inlineData: {
        mimeType: img.mimeType || "image/jpeg",
        data: img.buffer.toString("base64"),
      },
    })),
  ];

  // Pro Image 是思考型模型（Thinking），要给它一个合理的思考预算，
  // 否则可能无限 thinking 导致卡死。Flash Image 不支持 thinking，
  // 多传这个字段不会报错，@google/genai 会自动忽略不支持的参数。
  const isProImage = MODEL.includes("pro-image");
  const configBase: Record<string, unknown> = {
    // Nano Banana 既可以返回图片也可以返回文本，都要
    responseModalities: ["IMAGE", "TEXT"],
    // 默认 0.4，传了 seed 时建议调用方降到 0.1-0.2 增强一致性
    temperature: options.temperature ?? 0.4,
  };
  // seed 锁定 —— 同一个 batch 的多张图共享，最大化一致性
  if (typeof options.seed === "number" && Number.isFinite(options.seed)) {
    configBase.seed = Math.floor(options.seed);
  }
  if (isProImage) {
    // 限定 Pro Image 的思考预算：2048 tokens 足够一般换色/简单合成场景
    // （不设置的话默认可能是 -1 动态无上限，容易拖到几分钟）
    configBase.thinkingConfig = { thinkingBudget: 2048 };
  }
  if (options.aspectRatio || options.imageSize) {
    // imageConfig:
    //   - aspectRatio: '1:1' | '3:2' | '2:3' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'
    //   - imageSize: '0.5K' | '1K' | '2K' | '4K'
    // 注意 Flash Image 模型会忽略 imageSize，只有 Pro Image 真的按这个出
    const imageConfig: Record<string, string> = {};
    if (options.aspectRatio) imageConfig.aspectRatio = options.aspectRatio;
    if (options.imageSize) imageConfig.imageSize = options.imageSize;
    configBase.imageConfig = imageConfig;
  }

  // 加 timeout wrapper：超过 CALL_TIMEOUT_MS 就抛 TimeoutError，
  // 避免被 Next.js maxDuration 强杀（用户连不到错误信息）
  const callPromise = ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: configBase,
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(
        new Error(
          `调用 ${MODEL} 超过 ${CALL_TIMEOUT_MS / 1000} 秒无响应，可能模型暂不可用，建议换另一个模型`,
        ),
      );
    }, CALL_TIMEOUT_MS);
  });

  const response = await Promise.race([callPromise, timeoutPromise]);

  // 解析 response.candidates[0].content.parts，找出 inlineData（图片）
  const candidates = response.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error(
      "Nano Banana 未返回任何候选结果。可能是内容被安全策略拦截。",
    );
  }

  let imageData: { mimeType: string; data: Buffer } | null = null;
  let textResponse: string | undefined;

  for (const cand of candidates) {
    const parts = cand.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const base64 = part.inlineData.data;
        imageData = {
          mimeType: part.inlineData.mimeType || "image/png",
          data: Buffer.from(base64, "base64"),
        };
      } else if (part.text) {
        textResponse = (textResponse ? textResponse + "\n" : "") + part.text;
      }
    }
    if (imageData) break;
  }

  if (!imageData) {
    throw new Error(
      `Nano Banana 没返回图片。${textResponse ? "模型说：" + textResponse : ""}`,
    );
  }

  // 日志输出图片信息（宽高 / 体积），用于诊断输出质量问题
  const info = readImageInfo(imageData.data, imageData.mimeType);
  console.log(
    `[gen OK] model=${MODEL} aspect=${options.aspectRatio ?? "default"} size=${options.imageSize ?? "1K(default)"} seed=${options.seed ?? "random"} temp=${options.temperature ?? 0.4} → ${formatImageInfo(info)}`,
  );

  return {
    mimeType: imageData.mimeType,
    data: imageData.data,
    textResponse,
    model: MODEL,
    usageMetadata: response.usageMetadata,
  };
}

/**
 * 构造换色 prompt
 *
 * 关键原则：
 * 1. 明确说"只改颜色"
 * 2. 要求保留面料纹理、装饰、廓形
 * 3. 给出目标颜色的自然语言描述 + HEX 色号辅助
 * 4. 按可用信息逐层叠加：材质/款式/真实感/用户种子
 */
export interface RecolorPromptOptions {
  /** 款式解析出的结构化属性（格式化后的一段文本） */
  garmentAttrs?: string;
  /** 材质库匹配后拼成的详细段落（formatMaterialDetails 的输出） */
  materialDetails?: string;
  /** 真实感预设的约束文本（formatRealismConstraints 的输出） */
  realismConstraints?: string;
  /** 用户自定义追加指令 */
  userSeed?: string;
  /** 输出清晰度档位：'hd' | '2k' | '4k'。会转成强约束文字进 prompt */
  qualityLevel?: "hd" | "2k" | "4k";
  /**
   * 原图的"主色调"（中文）。从 garment_attrs.主色调 抠出来。
   *
   * 用途：让模型知道"原色 → 新色"的明确变化路径，避免在两色相近时
   * 觉得"不需要改"而几乎复刻原图。
   */
  originalColorName?: string;
  /**
   * 是否在 inputs 里附带了一张目标色色卡（generateColorSwatchPng 生成的纯色 PNG）。
   * true 时 prompt 会显式引用"最后一张参考图是色卡"。
   */
  hasSwatch?: boolean;
}

/**
 * HEX → RGB 数值。用于在 prompt 里给模型多重色彩描述。
 * 输入 "#E8B197" 或 "E8B197" 都行；非法时返回 null。
 */
export function hexToRgb(
  hex: string,
): { r: number; g: number; b: number } | null {
  const h = hex.replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * 输出质量指令 · 关键：告诉模型**重绘而不是改图**，按目标分辨率渲染
 * 这是让"糊图变清晰"的核心——模型不会拘泥于原图的像素，而是按指令级别重新生成
 */
function buildQualityHint(level: "hd" | "2k" | "4k" = "2k"): string {
  const levelLabel = level === "4k" ? "4K 超清" : level === "2k" ? "2K 高清" : "HD 清晰";
  return `【输出质量 / Output Quality】${levelLabel}
- 必须输出 ${level.toUpperCase()} 级别的清晰锐利图像（${level.toUpperCase()} ultra-high resolution, tack-sharp）
- **即使输入图片模糊、有噪点、是截图或低像素，你必须 REDRAW / 重新渲染整张图，让它变得锐利清晰**
- 所有细节必须清晰可辨：面料纹理 / 蕾丝针脚 / 珠片反光 / 发丝 / 皮肤毛孔
- 不保留输入图的任何瑕疵：模糊、压缩块、噪点、色带都必须被重新生成的清晰版本覆盖
- 参考标准：专业电商摄影或时尚杂志的精修直出，印刷级清晰度 (magazine-quality, print-ready)
- 关键词强化：sharp focus, crystal clear, ultra-detailed, high-resolution, photorealistic, 8K textures

【构图约束 / Composition - 非常重要】
- **主体（服装 / 模特）必须位于画面中心区域**，水平居中或居中偏左 40-60%，不要靠画面边缘
- 主体完整呈现，**不能被裁切**（包括头顶、脚部、手臂、裙摆等）
- 高分辨率 (${level.toUpperCase()}) 输出时，保持构图稳定，**不要因画幅变大而让主体偏离中心或变小留太多空白**
- 关键词：subject centered, stable composition, full subject visible, no cropping of subject`;
}

export function buildRecolorPrompt(
  colorName: string,
  hex: string,
  options: RecolorPromptOptions = {},
): string {
  const rgb = hexToRgb(hex);
  // 给模型多种色彩表示，减少"理解偏差"导致的色值漂移
  const colorMultiRepr = rgb
    ? `「${colorName}」 · HEX ${hex.toUpperCase()} · RGB(${rgb.r}, ${rgb.g}, ${rgb.b})`
    : `「${colorName}」 · 色号 ${hex}`;

  const original = options.originalColorName?.trim();

  const parts: string[] = [
    `你是一位专业的服装电商修图师。请严格按照以下要求执行**完整的颜色替换**（不是微调）。`,
    ``,
    `【目标颜色 / Target Color · ⚠️ 严格匹配，零偏差】`,
    `必须把这件服装的主色调精确替换为：`,
    `  ▸ ${colorMultiRepr}`,
    `输出图的主色像素值必须严格落在目标色附近（CIE76 ΔE ≤ 5），不允许：`,
    `  ✗ 朝训练分布"中性化"漂移（保持纯度不要 desaturate）`,
    `  ✗ 朝原色"折中"（不要保留任何原色倾向）`,
    `  ✗ 美学化偏移（不要因为"好看"自行调整）`,
  ];

  // ── 原色对比段：解决"原色相近时模型不换色"问题 ──
  if (original && original !== "未提供") {
    parts.push(
      ``,
      `【⚠️ 关键：必须改变颜色 / Critical: Must Change】`,
      `输入图中服装的当前主色是「${original}」。`,
      `你的任务是把它**完全替换**为上面指定的目标色 ${colorMultiRepr.split(" · ")[0]}。`,
      `**即使原色和目标色看起来相近，也必须执行完整的颜色替换** —— 视觉上必须可清晰识别为"新颜色"。`,
      `禁止"几乎不变"或"略微调整"的输出 —— 那是失败结果。`,
    );
  } else {
    parts.push(
      ``,
      `【⚠️ 关键：必须执行完整颜色替换】`,
      `不允许输出"看起来差不多"的图。即使原图色调与目标色接近，也必须全面替换为目标色。`,
    );
  }

  // ── 色卡引用段（PR 2 需要 hasSwatch）──
  if (options.hasSwatch) {
    parts.push(
      ``,
      `【色卡参考图 / Color Reference Swatch】`,
      `**最后一张参考图是目标色色卡**（256×256 纯色块，仅供颜色锚定）。`,
      `服装主色必须严格匹配色卡所示颜色 —— 这是颜色一致性的硬约束：`,
      `  ▸ 同一批次的多张图、跨多次调用的输出，主色都必须对齐到这张色卡`,
      `  ▸ 直接用色卡里的像素值作为目标，不要自行解读 HEX 字符串`,
      `  ▸ ⚠️ 色卡只用于颜色提取，**不要把色卡的形状/边界/纯色块复制到输出图里**`,
    );
  }

  if (options.garmentAttrs) {
    parts.push("", "【款式信息 / Garment Info】", options.garmentAttrs);
  }

  if (options.materialDetails) {
    parts.push("", options.materialDetails);
  }

  parts.push(
    "",
    `【必须保留 / Must Preserve】`,
    `- 服装的廓形、版型、长度、剪裁细节`,
    `- 面料质感：必须严格按上述材质规则渲染（不同材质的光泽/透光/纹理差异绝不能混淆）`,
    `- 所有装饰细节（蕾丝、刺绣、珠片、褶皱、蝴蝶结、系带等）完全不动`,
    `- 模特（如有）的姿势、面部、发型、肤色、背景`,
    ``,
    `【只改 / Only Change】服装主体的主色调`,
    `- 改后的颜色要自然地覆盖所有大面积的布料`,
    `- 蕾丝、刺绣等装饰保持与主色协调（比如白色蕾丝不变，同色蕾丝要跟着变）`,
    `- 阴影和高光要符合新颜色在该材质下的光泽特性（缎面有强反光，雪纺无强反光等）`,
    `- 阴影区域可暗一些，高光区域可亮一些，但**主色平均值必须落在目标 RGB 附近**`,
  );

  if (options.realismConstraints) {
    parts.push("", options.realismConstraints);
  }

  // 清晰度指令（关键）——告诉模型按 2K/4K 重绘，不要复刻输入图的模糊
  parts.push("", buildQualityHint(options.qualityLevel ?? "2k"));

  parts.push(
    "",
    `【其他要求】保持商品摄影级质感，不要添加水印、logo、文字等任何额外元素。`,
  );

  if (options.userSeed?.trim()) {
    parts.push("", `【补充指令】${options.userSeed.trim()}`);
  }

  parts.push(
    "",
    `请输出一张修改后的产品图片。再次强调：主色必须严格等于 ${colorMultiRepr.split(" · ")[0]} ${rgb ? `(RGB ${rgb.r}, ${rgb.g}, ${rgb.b})` : ""}。`,
  );
  return parts.join("\n");
}

/**
 * 把款式解析的 JSON 对象格式化成 Prompt 里的"款式信息"段
 */
export function formatGarmentAttrs(
  attrs: Record<string, string | string[]> | null | undefined,
): string {
  if (!attrs) return "";
  const lines: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith("_")) continue; // skip meta fields like _model
    const v = Array.isArray(value) ? value.join("、") : String(value || "").trim();
    if (!v || v === "未提供") continue;
    lines.push(`- ${key}：${v}`);
  }
  return lines.join("\n");
}
