/**
 * "原型 + 变体" 模式 prompt 构造器
 *
 * 用法：
 *   const prompt = buildPrototypeVariantPrompt({
 *     ethnicity: "east-asian",
 *     age: "25-30",
 *     hairColor: "black",
 *     hairStyle: "long-straight",
 *   });
 *   const result = await generateImage({
 *     inputs: [{ buffer: prototypeBuf, mimeType: "image/jpeg" }],
 *     prompt,
 *     modelId: "gpt-image-2",
 *     n: 4,                          // 一次出 4 张变体
 *     size: "1024x1536",
 *     quality: "high",
 *   });
 *
 * 来源：docs/new-identity-prompts.md 的 v4 方案 A（中性运动套装）
 * 改造点：
 *   - 把"换脸 + 换装 + 锁定身体/姿势/背景"的核心逻辑提炼成模板
 *   - 接受 ethnicity / age / hairColor / hairStyle 4 个参数动态拼接 face/hair 段
 *   - 删除 v4 文档里"GENERATE THREE VARIANTS side-by-side"的拼图玩法，改为
 *     依赖 OpenAI 的 n=N 一次出 N 张独立全身图，更好用
 *
 * 安全词关键替换（v3 → v4）：
 *   bodysuit → tank top
 *   leotard → athletic shorts
 *   high-cut → mid-length
 *   snug → fitted but not tight
 */

export type PrototypeEthnicity =
  | "east-asian"
  | "southeast-asian"
  | "south-asian"
  | "european-fair"
  | "european-mediterranean"
  | "african"
  | "latin-american"
  | "middle-eastern"
  | "mixed";

export type PrototypeAge = "20-25" | "25-30" | "30-35" | "35-40";

export type PrototypeHairColor =
  | "black"
  | "dark-brown"
  | "brown"
  | "blonde-light"
  | "blonde-medium"
  | "red"
  | "gray-silver";

export type PrototypeHairStyle =
  | "long-straight"
  | "long-wavy"
  | "medium-shoulder"
  | "short-bob"
  | "updo-bun";

export interface PrototypeParams {
  ethnicity: PrototypeEthnicity;
  age: PrototypeAge;
  hairColor: PrototypeHairColor;
  hairStyle: PrototypeHairStyle;
}

/* ───────── 各维度 → 英文片段 ───────── */

const ETHNICITY_PHRASE: Record<PrototypeEthnicity, string> = {
  "east-asian":
    "East Asian (Chinese / Korean / Japanese features), warm-light skin tone",
  "southeast-asian":
    "Southeast Asian, warm light-tan skin tone, soft delicate features",
  "south-asian":
    "South Asian (Indian / Pakistani features), warm medium skin tone",
  "european-fair":
    "Northern European, fair / porcelain skin tone, refined features",
  "european-mediterranean":
    "Mediterranean European, olive-tan skin tone, warm undertones",
  african: "Black, medium-deep skin tone, beautiful natural features",
  "latin-american":
    "Latin American, warm tan skin tone, expressive features",
  "middle-eastern":
    "Middle Eastern, warm olive skin tone, deep set eyes",
  mixed:
    "mixed-ethnicity (ambiguously multicultural), warm medium skin tone",
};

const AGE_PHRASE: Record<PrototypeAge, string> = {
  "20-25": "early-twenties, youthful fresh face",
  "25-30": "late-twenties, elegant mature face",
  "30-35": "early-thirties, refined sophisticated face",
  "35-40": "late-thirties, graceful mature face",
};

const HAIR_COLOR_PHRASE: Record<PrototypeHairColor, string> = {
  black: "natural black hair",
  "dark-brown": "dark chestnut brown hair",
  brown: "medium warm brown hair",
  "blonde-light": "light golden blonde hair",
  "blonde-medium": "honey blonde hair",
  red: "warm auburn / red-brown hair",
  "gray-silver": "elegant gray-silver hair",
};

const HAIR_STYLE_PHRASE: Record<PrototypeHairStyle, string> = {
  "long-straight":
    "long straight hair falling to mid-back length, sleek and natural",
  "long-wavy":
    "long soft wavy hair falling to mid-back length, natural texture",
  "medium-shoulder":
    "shoulder-length hair with soft inward curl at the ends",
  "short-bob": "neat bob haircut ending around the jawline",
  "updo-bun":
    "elegant low bun gathered at the nape, neat with a few soft loose strands at the temples",
};

/* ───────── 主构造函数 ───────── */

export function buildPrototypeVariantPrompt(params: PrototypeParams): string {
  const facePhrase = `A different ${ETHNICITY_PHRASE[params.ethnicity]} woman, ${AGE_PHRASE[params.age]}`;
  const hairPhrase = `${HAIR_COLOR_PHRASE[params.hairColor]}, ${HAIR_STYLE_PHRASE[params.hairStyle]}`;

  return `Transform this photograph into a clean MODEL REFERENCE PORTRAIT
suitable for an AI clothing try-on workflow. Three changes must happen at
once: replace the face/hair, replace the outfit with neutral activewear,
keep everything else identical.

═══════════════════════════════════════════════════
1. KEEP EXACTLY UNCHANGED FROM THE INPUT IMAGE
═══════════════════════════════════════════════════
- Body shape, proportions, height, weight
- Pose, body angle, hand gestures, finger positions
- Head tilt direction, gaze direction
- Background (color, texture, gradient, shadows)
- Lighting (direction, intensity, color temperature)
- Camera angle, framing (full body), depth of field
- Image aspect ratio and resolution

═══════════════════════════════════════════════════
2. CHANGE THE FACE AND HAIR to a NEW person
═══════════════════════════════════════════════════
${facePhrase}
- Different facial structure, eye shape, nose, lips, jawline from the input
- Photorealistic, non-celebrity, magazine-editorial quality
- Natural skin texture: visible pores, subtle skin imperfections, NO airbrushed plastic look
- Soft natural makeup (subtle eyeliner, nude lip)
- Hair: ${hairPhrase}

═══════════════════════════════════════════════════
3. REPLACE THE OUTFIT with NEUTRAL ACTIVEWEAR
═══════════════════════════════════════════════════
Replace the original clothing with a clean two-piece activewear set:

▸ Top: a plain matte beige sleeveless athletic tank top, fitted but not
   tight, scoop neckline, no patterns or decorations, no logos.
▸ Bottom: plain matte beige athletic mid-length shorts (ending around
   mid-thigh), no patterns or decorations.
▸ Both pieces: same warm neutral beige color (≈ #D9C0A2 to #E8CDB0),
   matte cotton-blend feel, very plain construction.
▸ NO lace, NO mesh, NO embroidery, NO patterns, NO prints, NO logos,
   NO seams that draw attention.

═══════════════════════════════════════════════════
4. FEET AND ACCESSORIES
═══════════════════════════════════════════════════
- Bare feet on neutral ground OR plain nude sandals
- NO jewelry of any kind
- NO bag, NO scarf, NO hat

═══════════════════════════════════════════════════
5. SKIN / HAIR / TEXTURE REALISM (CRITICAL)
═══════════════════════════════════════════════════
- Skin must show real pore detail at face / décolletage / arms
- Subtle natural blemishes acceptable (slight redness, fine lines)
- Hair must show individual strand definition, not a glossy plastic helmet
- Fabric must show real texture (cotton weave subtly visible)
- Lighting must produce believable subsurface scattering on skin

═══════════════════════════════════════════════════
6. ABSOLUTE FORBIDDENS
═══════════════════════════════════════════════════
- Do not keep any part of the original dress / clothing
- Do not add patterns, decorations, or fabric textures to the activewear
- Do not change body proportions or pose
- Do not make the new face look like a celebrity
- Do not add text, watermarks, logos, signatures
- Do not crop or re-frame the image

═══════════════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════════════
A single photorealistic full-body photograph of a new model wearing a
plain beige tank top and plain beige athletic shorts, in the exact same
pose / body / background / lighting as the original input image. Clean
studio reference quality, ready for clothing try-on workflows.`;
}

/* ───────── 类型守卫 ───────── */

const ETHNICITIES: PrototypeEthnicity[] = [
  "east-asian",
  "southeast-asian",
  "south-asian",
  "european-fair",
  "european-mediterranean",
  "african",
  "latin-american",
  "middle-eastern",
  "mixed",
];
const AGES: PrototypeAge[] = ["20-25", "25-30", "30-35", "35-40"];
const HAIR_COLORS: PrototypeHairColor[] = [
  "black",
  "dark-brown",
  "brown",
  "blonde-light",
  "blonde-medium",
  "red",
  "gray-silver",
];
const HAIR_STYLES: PrototypeHairStyle[] = [
  "long-straight",
  "long-wavy",
  "medium-shoulder",
  "short-bob",
  "updo-bun",
];

export function isValidPrototypeEthnicity(v: unknown): v is PrototypeEthnicity {
  return typeof v === "string" && (ETHNICITIES as string[]).includes(v);
}
export function isValidPrototypeAge(v: unknown): v is PrototypeAge {
  return typeof v === "string" && (AGES as string[]).includes(v);
}
export function isValidPrototypeHairColor(
  v: unknown,
): v is PrototypeHairColor {
  return typeof v === "string" && (HAIR_COLORS as string[]).includes(v);
}
export function isValidPrototypeHairStyle(
  v: unknown,
): v is PrototypeHairStyle {
  return typeof v === "string" && (HAIR_STYLES as string[]).includes(v);
}
