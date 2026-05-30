/**
 * 鞋型选择器（per-batch deterministic shoe picker）
 *
 * ─────────────────────────────────────────────
 * 为什么需要：
 *   batch-photo 是 N 次独立的 API 调用，每次模型只看到 1 张图正在生成。
 *   如果 prompt 给一个"菜单"（如"细高跟 / pump / 细带款"），每次调用模型
 *   会从菜单里随机挑一个 → 不同图出现不同款。
 *
 * 解决：
 *   在 job 创建时根据 garment_attrs.主色调 挑一双**具体**鞋型（含颜色 / 款式
 *   / 跟高 / 材质），把这串描述存到 job.params.shoe_spec，每次 item 处理时
 *   注入到 prompt 的 {{shoe_spec}} 占位符 → 模型每次看到完全一致的鞋型描述
 *   + batch_seed 共享 → 一致性大幅提升。
 *
 * 颜色映射决策（顺序很重要，先匹配先出）：
 *   1) 黑色 / 深色族（酒红、墨绿、海军等） → 黑色高跟鞋
 *   2) 金属金（玫瑰金、香槟金）           → 香槟金高跟鞋
 *   3) 银色                              → 银色高跟鞋
 *   4) 冷色（蓝 / 绿 / 青 / 紫）          → 银色高跟鞋
 *   5) 暖色（红 / 橙 / 粉 / 桃）          → 裸色高跟鞋
 *   6) 浅色（白 / 米 / 香槟 / 裸 / 浅 / 淡）→ 香槟色 / 裸色高跟鞋
 *   7) 兜底                              → 裸色高跟鞋
 *
 * 锁定的鞋型规格（所有色组共用，只换鞋色）：
 *   尖头浅口 pump · 约 10cm 细高跟 stiletto · 缎面 · 鞋面简洁
 *   选这个款式的理由：礼服 / 伴娘服场景最通用 + 模型最擅长画这种经典款。
 * ─────────────────────────────────────────────
 */

export type GarmentAttrs = Record<string, string | string[]> | null | undefined;

/**
 * 鞋型基础描述（颜色之外的所有规格） —— 整批锁定，不变
 */
const HEEL_BASE =
  "尖头浅口高跟鞋（pointed-toe pump），约 10cm 细高跟（stiletto heel），缎面材质，鞋面简洁光滑、无装饰";

/* 鞋色文案（按色组划分） */
const COLOR_BLACK = "黑色（black）";
const COLOR_GOLD = "香槟金（champagne gold）";
const COLOR_SILVER = "银色（silver / metallic）";
const COLOR_NUDE = "裸色（nude）";
const COLOR_CHAMPAGNE_NUDE = "裸色 / 香槟色（nude / champagne）";

/* 颜色识别正则 —— 每个 group 里塞了实战常见的中文色名变体 */
const RE_BLACK = /(黑|纯黑|墨黑|碳黑)/;
const RE_DEEP =
  /(酒红|勃艮第|墨绿|墨蓝|海军|藏青|深蓝|深红|深紫|深绿|深灰|焦糖)/;
const RE_GOLD = /(玫瑰金|香槟金|金色|金属)/;
const RE_SILVER = /(银色|银)/;
const RE_COOL = /(蓝|绿|青|紫|蒂芙|薄荷|湖|碧)/;
const RE_WARM = /(红|橙|粉|桃|玫瑰|珊瑚|莓|樱|蜜)/;
const RE_LIGHT = /(白|奶|象牙|香槟|裸|肉|浅|淡|米|杏)/;

/**
 * 根据服装属性返回一个**具体且确定**的鞋型描述字符串。
 *
 * 同样的 garmentAttrs 输入永远返回同样的输出（纯函数）。
 *
 * @param attrs analyze 阶段提取的 garment_attrs（含 "主色调" 字段）
 * @returns 单行字符串，可直接塞进 prompt 的 {{shoe_spec}} 占位符
 */
export function pickShoeSpec(attrs: GarmentAttrs): string {
  const color = readColor(attrs);

  if (!color) return formatSpec(COLOR_NUDE);

  // 顺序很重要：深色 / 黑 优先，避免"酒红"被 RE_WARM("红") 抢匹配
  if (RE_BLACK.test(color) || RE_DEEP.test(color))
    return formatSpec(COLOR_BLACK);
  if (RE_GOLD.test(color)) return formatSpec(COLOR_GOLD);
  if (RE_SILVER.test(color)) return formatSpec(COLOR_SILVER);
  if (RE_COOL.test(color)) return formatSpec(COLOR_SILVER);
  if (RE_WARM.test(color)) return formatSpec(COLOR_NUDE);
  if (RE_LIGHT.test(color)) return formatSpec(COLOR_CHAMPAGNE_NUDE);

  return formatSpec(COLOR_NUDE);
}

/* ─────────── 内部工具 ─────────── */

function readColor(attrs: GarmentAttrs): string {
  if (!attrs) return "";
  const v = (attrs as Record<string, unknown>)["主色调"];
  if (typeof v !== "string") return "";
  return v.trim();
}

function formatSpec(colorPhrase: string): string {
  return `${colorPhrase}${HEEL_BASE}`;
}
