/**
 * 多图 prompt 输入清单 helper
 *
 * 背景：
 *   OpenAI gpt-image-2 官方 prompting guide §2 强调 multi-image input 要
 *   显式按 index 标注每张参考图的职责（"Image 1: product, Image 2: style"），
 *   否则模型容易混淆主次。Gemini 也吃这一套但更宽容。
 *
 *   旧 prompt 模板里硬编码"参考图 1-2 = 产品，参考图 3 = 模特，参考图 4 = 场景"，
 *   但 batch-photo 实际产品图数量 1..3、场景图可有可无，硬索引经常错位。
 *
 *   这个 helper 按实际输入顺序动态生成 "Image N: ROLE — 取什么 / 忽略什么"
 *   清单，作为整个 prompt 的前置 header。
 *
 * 用法：
 *   const manifest = buildImageManifest({ productCount: 2, hasIdentity: true, hasScene: true });
 *   const finalPrompt = `${manifest}\n\n${existingPrompt}`;
 */

export interface ImageManifestOpts {
  /** 产品图数量（1..3） */
  productCount: number;
  /** 是否包含模特肖像图（identity） */
  hasIdentity: boolean;
  /** 是否包含场景背景图 */
  hasScene: boolean;
  /** 场景人话名（如"晚宴大厅"），仅 hasScene=true 时使用 */
  sceneName?: string;
  /** 末尾是否额外挂一张色卡（recolor 用） */
  hasColorSwatch?: boolean;
  /** 色卡的目标色名（如"香槟金"），仅 hasColorSwatch=true 时使用 */
  swatchColorName?: string;
  /** 色卡的 hex（如 "#D4AF37"），仅 hasColorSwatch=true 时使用 */
  swatchHex?: string;
}

/**
 * 产品图角色（按 idx 决定标签）。
 *   1 张：通用产品图
 *   2 张：正面 / 背面
 *   3 张：正面 / 背面 / 细节
 */
function productRoleLabel(idx: number, total: number): string {
  if (total === 1) return "产品图";
  if (total === 2) return idx === 0 ? "产品图正面" : "产品图背面";
  // 3 张
  if (idx === 0) return "产品图正面";
  if (idx === 1) return "产品图背面";
  return "产品图细节";
}

/**
 * 生成多图输入清单 header。
 *
 * 输出 OpenAI / Gemini 都吃的双语版（英文 Image N 标签 + 中文职责说明），
 * 末尾留两个换行方便后续拼。
 */
export function buildImageManifest(opts: ImageManifestOpts): string {
  const lines: string[] = [];
  let idx = 1;

  // 产品图
  for (let i = 0; i < opts.productCount; i++) {
    const role = productRoleLabel(i, opts.productCount);
    lines.push(
      `▸ Image ${idx} — ${role}（PRODUCT GARMENT REFERENCE）\n` +
        `   提取：服装本体的颜色 / 面料 / 版型 / 长度 / 领口 / 袖型 / 装饰细节\n` +
        `   忽略：图里可能出现的模特脸、姿势、原背景、灯光氛围`,
    );
    idx++;
  }

  // 模特肖像
  if (opts.hasIdentity) {
    lines.push(
      `▸ Image ${idx} — 模特肖像（MODEL IDENTITY REFERENCE）\n` +
        `   提取：脸型 / 肤色 / 发型 / 眼睛 / 体型\n` +
        `   忽略：图里的背景、姿势、穿着（穿着以产品图为准）`,
    );
    idx++;
  }

  // 场景背景
  if (opts.hasScene) {
    const sceneSuffix = opts.sceneName ? `（${opts.sceneName}）` : "";
    lines.push(
      `▸ Image ${idx} — 场景背景${sceneSuffix}（SCENE BACKGROUND REFERENCE）\n` +
        `   作用：最终图唯一的背景 / 地面 / 墙面 / 光线氛围来源\n` +
        `   要求：忠实复现，不要凭空加入参考图里没有的家具 / 道具 / 人物`,
    );
    idx++;
  }

  // 色卡（recolor 用）
  if (opts.hasColorSwatch) {
    const colorLabel = opts.swatchColorName
      ? `${opts.swatchColorName}${opts.swatchHex ? ` ${opts.swatchHex}` : ""}`
      : opts.swatchHex || "目标色";
    lines.push(
      `▸ Image ${idx} — 目标色色卡（COLOR SWATCH ANCHOR）\n` +
        `   作用：服装最终应该出现的精确色（${colorLabel}）\n` +
        `   要求：服装颜色像素级对齐这张色卡，肤色 / 背景 / 头发不受影响`,
    );
    idx++;
  }

  const total = idx - 1;
  return `══════════════════════════════════════════════════════════
📋 INPUT IMAGE MANIFEST — 本次共 ${total} 张参考图，请按职责区分使用
══════════════════════════════════════════════════════════

${lines.join("\n\n")}
`;
}
