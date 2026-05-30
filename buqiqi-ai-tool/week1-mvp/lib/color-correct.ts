import sharp from "sharp";

/**
 * 后处理色彩校正 / Post-Process Color Correction
 *
 * ─────────────────────────────────────────────────────────
 * 升级版（mask-based）：
 *   只校正"接近主色的像素"，背景 / 肤色 / 装饰等不动。
 *
 *   关键：每个像素都计算它和主色的 ΔE（LAB 空间），
 *         ΔE < maskThreshold 才参与校正，且在边界做平滑过渡，
 *         避免出现突兀的硬边。
 *
 * 设计动机：
 *   旧版的全图 RGB 缩放对中性色（灰背景）/ 肤色（粉橙）副作用大 ——
 *   把这些颜色也乘了 +25% 的倍率，导致整图偏色 / 曝光过度。
 *   Mask-based 通过"只动主色像素"避免了这个问题。
 *
 * 性能：
 *   2K 图（≈ 4.3M 像素）全像素扫一遍 ≈ 1-2 秒（可接受）。
 *   sRGB → LAB 转换在内层热点用查表 / 简化版加速。
 *
 * 替代方案（工作量更大、未来再考虑）：
 *   - SAM segmentation：用文本 prompt 自动 mask 服装，最精确
 *   - K-means cluster：动态找色簇，比 ΔE 阈值更鲁棒
 * ─────────────────────────────────────────────────────────
 */

export interface CorrectionResult {
  /** 校正后的 buffer */
  buffer: Buffer;
  /** 是否实际进行了校正（false = ΔE 已达标，跳过） */
  applied: boolean;
  /** 输出图主色（校正前） */
  before: { r: number; g: number; b: number };
  /** 校正前 ΔE（CIE76，LAB） */
  beforeDeltaE: number;
  /** 实际用的 multiplier（applied=true 时有值） */
  multiplier?: { r: number; g: number; b: number };
  /** 实际命中 mask 的像素占比（0-1，applied=true 时有值） */
  maskedPixelRatio?: number;
}

export interface CorrectionOptions {
  /**
   * ΔE 阈值，主色和目标色 ΔE 超过这个才校正。默认 6
   * （≈ 肉眼可见色差最低值）
   */
  threshold?: number;
  /**
   * 单通道最大缩放系数，防过校正失真。默认 1.6
   */
  maxRatio?: number;
  /** 单通道最小缩放系数。默认 0.6 */
  minRatio?: number;
  /**
   * 校正强度（0-2）。1 = 标准；0 = 不校正；2 = 加倍。
   * 给 UI 滑块用：strength_factor 控制实际应用的乘性偏移。
   * 默认 1.0
   */
  strength?: number;
  /**
   * Mask 阈值：像素跟"主色"的 LAB-ΔE 小于此值才参与校正。默认 30
   * - 越小：mask 越严格（只校正非常接近主色的像素），副作用越小
   * - 越大：覆盖更多渐变 / 阴影 / 高光区域，但可能误伤
   * 30 对纯色服装够用，复杂图案可调到 40-50
   */
  maskThreshold?: number;
  /**
   * 算法模式：
   *   - "masked"（默认）：只校正主色像素
   *   - "global"：全图缩放（旧行为，兼容用，副作用大）
   */
  mode?: "masked" | "global";
}

/**
 * 主入口：根据目标 HEX 校正图片色调
 */
export async function correctImageColor(
  buffer: Buffer,
  targetHex: string,
  options: CorrectionOptions = {},
): Promise<CorrectionResult> {
  const threshold = options.threshold ?? 6;
  const maxRatio = options.maxRatio ?? 1.6;
  const minRatio = options.minRatio ?? 0.6;
  const strength = options.strength ?? 1.0;
  const maskThreshold = options.maskThreshold ?? 30;
  const mode = options.mode ?? "masked";

  const target = hexToRgb(targetHex);
  if (!target) {
    throw new Error(`无效 HEX 色号: ${targetHex}`);
  }

  const dominant = await sampleDominantColor(buffer);
  const dE = deltaE(target, dominant);

  // strength=0 直接跳过
  if (dE < threshold || strength <= 0) {
    return {
      buffer,
      applied: false,
      before: dominant,
      beforeDeltaE: dE,
    };
  }

  // 算 base multipliers（基于 strength=1）
  const epsilon = 4;
  const baseR = (target.r + epsilon) / (dominant.r + epsilon);
  const baseG = (target.g + epsilon) / (dominant.g + epsilon);
  const baseB = (target.b + epsilon) / (dominant.b + epsilon);

  // strength 缩放：strength_factor 控制偏离 1.0 的程度
  // strength=0 → ratio=1（不变）；strength=1 → ratio=base；strength=2 → ratio=2*base-1
  const scaleByStrength = (base: number) => 1 + (base - 1) * strength;

  const clamp = (r: number) => Math.max(minRatio, Math.min(maxRatio, r));
  const cR = clamp(scaleByStrength(baseR));
  const cG = clamp(scaleByStrength(baseG));
  const cB = clamp(scaleByStrength(baseB));

  if (mode === "global") {
    // 旧行为，全图缩放（保留以备需要）
    const corrected = await sharp(buffer)
      .linear([cR, cG, cB], [0, 0, 0])
      .toBuffer();
    return {
      buffer: corrected,
      applied: true,
      before: dominant,
      beforeDeltaE: dE,
      multiplier: { r: cR, g: cG, b: cB },
      maskedPixelRatio: 1,
    };
  }

  // ─── Mask-based 模式（默认）───
  // 取出整图原始 RGB（去 alpha）
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels; // 3 (after removeAlpha)
  const width = info.width;
  const height = info.height;

  // 主色的 LAB（外层算一次，内层只算每个像素的 LAB）
  const dominantLab = rgbToLab(dominant.r, dominant.g, dominant.b);

  // 用预算 sRGB→Linear 查表，加速热路径
  const linearLut = buildSrgbLinearLut();

  // mask 边界平滑宽度（最后 30% 区段做线性渐变 falloff）
  const softEdge = maskThreshold * 0.3;

  const out = Buffer.allocUnsafe(data.length);
  let maskedCount = 0;
  const totalPixels = width * height;

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // 计算这个像素的 LAB（用查表加速）
    const lab = rgbToLabFast(r, g, b, linearLut);
    const pixelDe = Math.sqrt(
      (lab.L - dominantLab.L) ** 2 +
        (lab.a - dominantLab.a) ** 2 +
        (lab.b - dominantLab.b) ** 2,
    );

    if (pixelDe >= maskThreshold) {
      // 完全在 mask 外：保持原样
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      continue;
    }

    // 在 mask 内：算渐变系数（边界平滑）
    // ΔE = maskThreshold - softEdge 之内：完全应用（factor=1）
    // ΔE = maskThreshold 处：完全不应用（factor=0）
    let factor = 1;
    if (pixelDe > maskThreshold - softEdge) {
      factor = (maskThreshold - pixelDe) / softEdge;
    }

    // 应用 factor 加权的乘性校正
    // 等价于：r * (1 + (cR - 1) * factor)
    const newR = r * (1 + (cR - 1) * factor);
    const newG = g * (1 + (cG - 1) * factor);
    const newB = b * (1 + (cB - 1) * factor);

    out[i] = clampU8(newR);
    out[i + 1] = clampU8(newG);
    out[i + 2] = clampU8(newB);
    maskedCount++;
  }

  // 重新编码：保持原图扩展名（PNG 或 JPG）
  const meta = await sharp(buffer).metadata();
  const isPng = meta.format === "png";
  const corrected = await sharp(out, {
    raw: { width, height, channels: 3 },
  })
    .toFormat(isPng ? "png" : "jpeg", isPng ? undefined : { quality: 95 })
    .toBuffer();

  return {
    buffer: corrected,
    applied: true,
    before: dominant,
    beforeDeltaE: dE,
    multiplier: { r: cR, g: cG, b: cB },
    maskedPixelRatio: maskedCount / totalPixels,
  };
}

/* ═════════════ 内部工具 ═════════════ */

function clampU8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * 主色采样：取图片中心 50% × 50% 区域的平均色，下移避脸。
 */
async function sampleDominantColor(
  buffer: Buffer,
): Promise<{ r: number; g: number; b: number }> {
  const meta = await sharp(buffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 20 || h < 20) {
    throw new Error(`图片太小（${w}×${h}），无法采样`);
  }

  const cropL = Math.floor(w * 0.25);
  const cropT = Math.floor(h * 0.30);
  const cropW = Math.floor(w * 0.50);
  const cropH = Math.floor(h * 0.50);

  const { data, info } = await sharp(buffer)
    .extract({ left: cropL, top: cropT, width: cropW, height: cropH })
    .resize(80, 80, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  let sumR = 0,
    sumG = 0,
    sumB = 0,
    count = 0;
  for (let i = 0; i < data.length; i += channels) {
    sumR += data[i];
    sumG += data[i + 1];
    sumB += data[i + 2];
    count++;
  }
  return {
    r: sumR / count,
    g: sumG / count,
    b: sumB / count,
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/* ── sRGB → LAB（D65）── */

function srgbToLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.04045
    ? norm / 12.92
    : Math.pow((norm + 0.055) / 1.055, 2.4);
}

/**
 * 256 元素查表，避免每个像素的 pow() 调用。
 * 把热路径从 ~20us/px 降到 ~3us/px。
 */
function buildSrgbLinearLut(): Float64Array {
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i);
  return lut;
}

function linearRgbToXyz(r: number, g: number, b: number) {
  return {
    X: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    Y: r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
    Z: r * 0.0193339 + g * 0.1191920 + b * 0.9503041,
  };
}

function xyzToLab(X: number, Y: number, Z: number) {
  const Xn = 0.95047;
  const Yn = 1.0;
  const Zn = 1.08883;
  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(X / Xn);
  const fy = f(Y / Yn);
  const fz = f(Z / Zn);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function rgbToLab(r: number, g: number, b: number) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const xyz = linearRgbToXyz(lr, lg, lb);
  return xyzToLab(xyz.X, xyz.Y, xyz.Z);
}

/** 像素级热路径专用：用查表加速 sRGB → Linear */
function rgbToLabFast(
  r: number,
  g: number,
  b: number,
  lut: Float64Array,
): { L: number; a: number; b: number } {
  const lr = lut[r];
  const lg = lut[g];
  const lb = lut[b];
  const xyz = linearRgbToXyz(lr, lg, lb);
  return xyzToLab(xyz.X, xyz.Y, xyz.Z);
}

function deltaE(
  rgb1: { r: number; g: number; b: number },
  rgb2: { r: number; g: number; b: number },
): number {
  const lab1 = rgbToLab(rgb1.r, rgb1.g, rgb1.b);
  const lab2 = rgbToLab(rgb2.r, rgb2.g, rgb2.b);
  return Math.sqrt(
    (lab1.L - lab2.L) ** 2 +
      (lab1.a - lab2.a) ** 2 +
      (lab1.b - lab2.b) ** 2,
  );
}

/**
 * 给前端 / 调试用：算两个色 ΔE
 */
export function computeDeltaE(
  hex1: string,
  hex2OrRgb: string | { r: number; g: number; b: number },
): number | null {
  const a = hexToRgb(hex1);
  if (!a) return null;
  const b =
    typeof hex2OrRgb === "string" ? hexToRgb(hex2OrRgb) : hex2OrRgb;
  if (!b) return null;
  return deltaE(a, b);
}

/**
 * 给前端 / API 用：仅采样 + 算 ΔE，不修改图。
 * 用于"调整"模态框初次打开时显示当前 ΔE。
 */
export async function probeImageColor(
  buffer: Buffer,
  targetHex: string,
): Promise<{
  dominant: { r: number; g: number; b: number };
  deltaE: number;
}> {
  const target = hexToRgb(targetHex);
  if (!target) throw new Error(`无效 HEX: ${targetHex}`);
  const dominant = await sampleDominantColor(buffer);
  return {
    dominant,
    deltaE: deltaE(target, dominant),
  };
}
