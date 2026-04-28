import sharp from "sharp";

/**
 * 后处理色彩校正 / Post-Process Color Correction
 *
 * ─────────────────────────────────────────────────────────
 * 为什么需要：
 *   即使有强 prompt + 色卡参考，Gemini Image 模型生成的颜色
 *   仍可能朝训练分布"中心化"漂移（最常见：饱和度下降 / 色相微移）。
 *   尤其是浅色（接近白）和近原色场景，模型几乎"懒得改"。
 *
 *   单靠 prompt 是 LLM/diffusion 模型的固有限制，AdobeSensei 这类
 *   工业方案也都是 prompt + 后处理双轨。
 *
 * 思路：
 *   1. 模型生成完后，采样输出图主色（中心 50% 区域均值）
 *   2. 跟目标 HEX 算 ΔE（CIE76，LAB 空间）
 *   3. ΔE 超过阈值就通过 sharp.linear 做 per-channel 比例缩放，
 *      把整图轻微"拉"向目标色
 *   4. 限幅避免过度校正
 *
 * 局限：
 *   - 不是 segmentation，会一并影响背景（电商图背景纯净，影响不大）
 *   - 极端反色场景（比如想把红改成绿）这个方法效果差 —— 但那种场景
 *     prompt + 色卡通常已经够了，post-correction 主要救近色场景
 * ─────────────────────────────────────────────────────────
 */

export interface CorrectionResult {
  /** 校正后的 PNG/JPG buffer */
  buffer: Buffer;
  /** 是否实际进行了校正（false = ΔE 已达标，跳过） */
  applied: boolean;
  /** 校正前主色（RGB） */
  before: { r: number; g: number; b: number };
  /** 校正前 ΔE（CIE76，LAB） */
  beforeDeltaE: number;
  /** 实际用的 multiplier（applied=true 时有值） */
  multiplier?: { r: number; g: number; b: number };
}

export interface CorrectionOptions {
  /** ΔE 阈值，超过才校正。默认 6（≈ 肉眼可见色差） */
  threshold?: number;
  /** 单通道最大缩放系数，防止过度校正失真。默认 1.6 */
  maxRatio?: number;
  /** 单通道最小缩放系数。默认 0.6 */
  minRatio?: number;
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

  const target = hexToRgb(targetHex);
  if (!target) {
    throw new Error(`无效 HEX 色号: ${targetHex}`);
  }

  const dominant = await sampleDominantColor(buffer);
  const dE = deltaE(target, dominant);

  if (dE < threshold) {
    return {
      buffer,
      applied: false,
      before: dominant,
      beforeDeltaE: dE,
    };
  }

  // 计算每通道乘性比例（加 epsilon 避免除以接近零的暗值）
  const epsilon = 4;
  const rR = (target.r + epsilon) / (dominant.r + epsilon);
  const rG = (target.g + epsilon) / (dominant.g + epsilon);
  const rB = (target.b + epsilon) / (dominant.b + epsilon);

  const clamp = (r: number) => Math.max(minRatio, Math.min(maxRatio, r));
  const cR = clamp(rR);
  const cG = clamp(rG);
  const cB = clamp(rB);

  // sharp.linear: output = a × input + b
  // 我们要 output_R = cR × input_R, etc.
  const corrected = await sharp(buffer)
    .linear([cR, cG, cB], [0, 0, 0])
    .toBuffer();

  return {
    buffer: corrected,
    applied: true,
    before: dominant,
    beforeDeltaE: dE,
    multiplier: { r: cR, g: cG, b: cB },
  };
}

/* ═════════════ 内部工具 ═════════════ */

/**
 * 采样图片中心 50% × 50% 区域的平均颜色。
 *
 * 假设：电商商品图主体居中，中心区域 ≈ 服装主色。
 * 略微偏下（top 30% 而非 25%）以避开模特脸。
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
  const cropT = Math.floor(h * 0.30); // 偏下，避开模特脸 / 头部
  const cropW = Math.floor(w * 0.50);
  const cropH = Math.floor(h * 0.50);

  // 降采样到 80×80 加速 + 平滑
  const { data, info } = await sharp(buffer)
    .extract({ left: cropL, top: cropT, width: cropW, height: cropH })
    .resize(80, 80, { fit: "inside" })
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

/**
 * HEX → RGB（合法时返回，否则 null）
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/* ── sRGB → LAB 用于 ΔE 计算（CIE76）── */

function srgbToLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.04045
    ? norm / 12.92
    : Math.pow((norm + 0.055) / 1.055, 2.4);
}

function linearRgbToXyz(r: number, g: number, b: number) {
  // sRGB D65 矩阵
  return {
    X: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    Y: r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
    Z: r * 0.0193339 + g * 0.1191920 + b * 0.9503041,
  };
}

function xyzToLab(X: number, Y: number, Z: number) {
  // D65 白点
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

/**
 * CIE76 色差（ΔE*ab）—— 简单经典，对小色差精度够。
 *
 * 参考阈值：
 *   ΔE < 1     肉眼几乎不可分辨
 *   ΔE 1-3     需要专业训练才看出
 *   ΔE 3-6     仔细看可分辨
 *   ΔE 6-10    一眼明显不同色
 *   ΔE > 10    完全不同色
 */
function deltaE(
  rgb1: { r: number; g: number; b: number },
  rgb2: { r: number; g: number; b: number },
): number {
  const lab1 = rgbToLab(rgb1.r, rgb1.g, rgb1.b);
  const lab2 = rgbToLab(rgb2.r, rgb2.g, rgb2.b);
  return Math.sqrt(
    Math.pow(lab1.L - lab2.L, 2) +
      Math.pow(lab1.a - lab2.a, 2) +
      Math.pow(lab1.b - lab2.b, 2),
  );
}
