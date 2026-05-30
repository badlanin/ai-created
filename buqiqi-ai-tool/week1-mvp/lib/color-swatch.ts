import sharp from "sharp";

/**
 * 程序化生成"目标色色卡"PNG —— 给 Gemini Image 模型作为颜色锚定参考图。
 *
 * ──────────────────────────────────────────────────────────────────
 * 为什么需要：
 *   Image-edit 模型把 HEX 字符串"理解"为大致色调，输出主色会朝训练分布
 *   中心漂移（最常见的偏差是 desaturation 和"美学化"）。多张独立调用
 *   之间还会有色温微移，导致 batch 输出色差。
 *
 * 解决：
 *   把目标色渲染成一张纯色 PNG，作为额外的视觉参考图传入。模型有了
 *   像素级锚点，颜色精度和 batch 一致性都大幅提升。
 *
 * 是 stable-diffusion / FLUX 做精确换色的标准技巧。
 * ──────────────────────────────────────────────────────────────────
 *
 * 用法：
 *   const swatchBuf = await generateColorSwatchPng("#E8B197");
 *   inputs.push({ buffer: swatchBuf, mimeType: "image/png" });
 *
 *   // prompt 里说"最后一张参考图是色卡，颜色严格对齐"
 */

export interface SwatchOptions {
  /** 输出尺寸（正方形）。默认 256，足够大让模型识别但不浪费 token */
  size?: number;
}

/**
 * @param hex  #RRGGBB 或 RRGGBB 都行
 * @returns    PNG Buffer，可直接喂 GenImageInput
 */
export async function generateColorSwatchPng(
  hex: string,
  options: SwatchOptions = {},
): Promise<Buffer> {
  const size = options.size ?? 256;
  const rgb = parseHex(hex);
  if (!rgb) {
    throw new Error(
      `generateColorSwatchPng: 非法 hex 色号 "${hex}"，应为 #RRGGBB`,
    );
  }

  // 用 sharp 创建 size×size 的纯色图像
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: rgb.r, g: rgb.g, b: rgb.b },
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * 单个 batch 内同 hex 重复使用同一份色卡 buffer，省 sharp 调用。
 * Map<hex_uppercase, Promise<Buffer>>
 *
 * 注意：是 module-level 缓存，进程重启后清空。
 *      不同 batch 共享同一缓存反而是好事 —— 同样的 hex 永远生成相同的字节。
 */
const swatchCache = new Map<string, Promise<Buffer>>();

/**
 * 带缓存版本：同样 hex 第二次调用直接复用 buffer。
 */
export function getColorSwatchPng(
  hex: string,
  options: SwatchOptions = {},
): Promise<Buffer> {
  const key = `${hex.toUpperCase()}_${options.size ?? 256}`;
  let p = swatchCache.get(key);
  if (!p) {
    p = generateColorSwatchPng(hex, options);
    swatchCache.set(key, p);
  }
  return p;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
