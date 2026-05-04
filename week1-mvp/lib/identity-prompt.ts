/**
 * Identity Prompt Builder — v4
 *
 * 用 5 个枚举参数（ethnicity / age / hair color / hair style / body shape）
 * 拼装一段约 150 行的 prompt，喂给 gemini-3-pro-image-preview 出"模特身份
 * 参考图"（identity）：全身、白底、nude bodysuit、解剖比例正确、毛孔级真实感。
 *
 * 设计理由和参数枚举详见 docs/identity-prompt-v4.md。
 */

// ─────────────────────────────────────────────────────────
// 参数类型
// ─────────────────────────────────────────────────────────

export type Ethnicity =
  | "east-asian"
  | "southeast-asian"
  | "south-asian"
  | "european-fair"
  | "european-mediterranean"
  | "african"
  | "latin-american"
  | "middle-eastern"
  | "mixed";

export type AgeRange = "20-25" | "25-30" | "30-35" | "35-40";

export type HairColor =
  | "black"
  | "dark-brown"
  | "brown"
  | "blonde-light"
  | "blonde-medium"
  | "red"
  | "gray-silver";

export type HairStyle =
  | "long-straight"
  | "long-wavy"
  | "medium-shoulder"
  | "short-bob"
  | "updo-bun";

export type BodyShape =
  | "slim"
  | "standard"
  | "athletic"
  | "curvy"
  | "plus"
  | "maternity"
  | "teen";

export interface IdentityParams {
  ethnicity: Ethnicity;
  age: AgeRange;
  hairColor: HairColor;
  hairStyle: HairStyle;
  bodyShape: BodyShape;
}

// ─────────────────────────────────────────────────────────
// 枚举 → 英文短语映射（注入 SUBJECT SPEC 段）
// ─────────────────────────────────────────────────────────

const ETHNICITY_DESC: Record<Ethnicity, string> = {
  "east-asian":
    "East Asian (Chinese / Korean / Japanese mix), warm yellow-undertone medium skin",
  "southeast-asian":
    "Southeast Asian (Filipino / Thai / Vietnamese mix), warm tan skin",
  "south-asian":
    "South Asian (Indian / Pakistani / Bengali mix), warm medium-deep skin",
  "european-fair":
    "Northern European (Scandinavian / British / German mix), fair skin with cool pink undertone",
  "european-mediterranean":
    "Mediterranean European (Italian / Spanish / Greek mix), warm olive skin",
  african: "African / African American, deep tan-to-dark skin",
  "latin-american":
    "Latin American (Mexican / Brazilian / Colombian mix), warm tan skin",
  "middle-eastern":
    "Middle Eastern (Persian / Arab / Turkish mix), warm medium skin",
  mixed: "Mixed ethnic background, warm medium skin",
};

const AGE_DESC: Record<AgeRange, string> = {
  "20-25": "20-25 years old (young adult, fresh skin)",
  "25-30": "25-30 years old (young adult, mature features)",
  "30-35":
    "30-35 years old (visible expression lines, real skin texture)",
  "35-40":
    "35-40 years old (early signs of aging, more pronounced lines)",
};

const HAIR_COLOR_DESC: Record<HairColor, string> = {
  black: "jet black",
  "dark-brown": "dark chestnut brown",
  brown: "medium brown",
  "blonde-light": "light golden blonde",
  "blonde-medium": "medium honey blonde",
  red: "natural auburn red",
  "gray-silver": "natural salt-and-pepper gray",
};

const HAIR_STYLE_DESC: Record<HairStyle, string> = {
  "long-straight":
    "long straight (mid-back length), parted center, smooth and uniform",
  "long-wavy":
    "long natural waves (mid-back length), parted center, visible flyaways at edges",
  "medium-shoulder":
    "shoulder-length, slight inward curl, natural movement",
  "short-bob": "chin-length bob, sleek and clean",
  "updo-bun":
    "low bun at nape, hair pulled back smoothly, NO flyaways (clean updo)",
};

const BODY_SHAPE_DESC: Record<BodyShape, string> = {
  slim: "slim athletic build (BMI ~19), narrow shoulders, slim hips",
  standard:
    "average healthy build (BMI ~22), balanced proportions",
  athletic:
    "athletic toned build (BMI ~22), defined shoulders and waist",
  curvy: "curvy hourglass build (BMI ~24), wider hips and bust",
  plus:
    "plus-size build (BMI ~28-30), full figure with proportional curves",
  maternity:
    "pregnancy 6-7 months, visible baby bump, otherwise standard build",
  teen:
    "teen build (15-17 yo equivalent), youthful proportions, smaller frame",
};

// 眼睛颜色由 ethnicity 推导（合理默认；不暴露给前端为单独字段）
const EYE_COLOR_BY_ETHNICITY: Record<Ethnicity, string> = {
  "east-asian": "dark brown eyes",
  "southeast-asian": "dark brown eyes",
  "south-asian": "dark brown to nearly black eyes",
  "european-fair": "blue or hazel eyes",
  "european-mediterranean": "hazel-brown eyes",
  african: "dark brown eyes",
  "latin-american": "warm brown eyes",
  "middle-eastern": "dark hazel-brown eyes",
  mixed: "hazel-brown eyes",
};

// ─────────────────────────────────────────────────────────
// Prompt 拼装
// ─────────────────────────────────────────────────────────

/**
 * 拼装 v4 identity prompt。详细分层和反例语言见 docs/identity-prompt-v4.md。
 */
export function buildIdentityPrompt(params: IdentityParams): string {
  const ethnicityDesc = ETHNICITY_DESC[params.ethnicity];
  const ageDesc = AGE_DESC[params.age];
  const hairColorDesc = HAIR_COLOR_DESC[params.hairColor];
  const hairStyleDesc = HAIR_STYLE_DESC[params.hairStyle];
  const bodyShapeDesc = BODY_SHAPE_DESC[params.bodyShape];
  const eyeColorDesc = EYE_COLOR_BY_ETHNICITY[params.ethnicity];

  return `═══════════════════════════════════════════════════════
🚨🚨🚨 PRIORITY 0 — MUST SATISFY FIRST 🚨🚨🚨
═══════════════════════════════════════════════════════

This is a CLINICAL REFERENCE PHOTO for downstream outfit/scene compositing.
This is NOT a fashion editorial. NOT a lookbook shot. NOT a campaign image.
Think: "before-fitting reference at a designer studio" / "anatomy reference
for a character artist" / "Skims model casting card."

▸ FRAMING:
- Full-body photograph: top of head to bottom of feet, all 10 toes visible
- Head occupies 12-13% of image height (NOT a close-up, NOT zoomed in)
- Subject vertically centered, ~5% headroom and ~3% foot room
- 3:4 portrait, 4K resolution

▸ WARDROBE — STRICT:
- Subject wears ONLY a seamless nude/beige form-fitting bodysuit
  (Skims/Wolford basic style, scoop neck, high-cut leg, no patterns,
  no decorative stitching)
- ❌ NO sweater, NO jeans, NO pants, NO dress, NO jacket, NO outerwear
- ❌ NO jewelry, NO accessories, NO shoes/socks (barefoot only)
- ❌ NO heavy makeup look — bare-face natural

▸ BACKGROUND — STRICT:
- Pure white seamless paper, RGB approximately (248, 248, 248)
- Evenly lit, very subtle natural floor shadow beneath feet
- ❌ NO windows, NO architecture, NO walls, NO doors, NO floor tiles
- ❌ NO environmental scene of any kind (no warehouse, no loft, no studio set)
- ❌ NO blurred background indicating space — only flat white paper

If the subject wears anything besides a bodysuit: WRONG, regenerate.
If the background contains windows, walls, floor texture, or any architecture:
WRONG, regenerate.
If the image looks like an "editorial fashion shot": WRONG, regenerate.
If the camera zooms past full-body framing: WRONG, regenerate.
If the feet are cut off or top of head cut off: WRONG, regenerate.

Skin texture (pores, sheen, lines) should be visible at 100% PIXEL ZOOM in
the 4K output, but NOT visible at primary view — keep camera at full-body
distance.

═══════════════════════════════════════════════════════
🚨 PRIORITY 1 — ANATOMICAL PROPORTIONS 🚨
═══════════════════════════════════════════════════════

Important: image generation models have a strong bias toward elongated
"runway model" proportions (1:8.5 or longer). You MUST counteract this bias.

Generate this person with proportions that may LOOK slightly stocky compared
to fashion illustration — that is correct. We want REAL human anatomy:

- Head height = 1/7.5 of total body height. If total figure is 750 pixels tall,
  head must be 100 pixels tall (NOT 88 or less).
- Legs from hip socket to floor = 47-50% of total height.
  If total figure is 750 pixels, legs are 360 pixels max (NOT 400+).
- The head should look LARGE relative to a fashion model. That's correct.
- The legs should look SHORTER than a runway model. That's correct.

Reference: a real photograph of an average person, NOT a Vogue runway shot.
NOT a fashion illustration. NOT an idealized 1:9 proportions sketch.

Self-check before output:
☐ Is the head at least 13% of total figure height?
☐ Are legs less than 50% of total height?
☐ Does the figure look like a real average person, not a runway model?

═══════════════════════════════════════════════════════
SUBJECT SPEC (this specific identity)
═══════════════════════════════════════════════════════

- Gender: female
- Age: ${ageDesc}
- Ethnicity: ${ethnicityDesc}
- Hair: ${hairColorDesc}, ${hairStyleDesc}
- Eyes: ${eyeColorDesc}, calm direct gaze, slight under-eye depth
  (real eye structure, not "dark circles")
- Face: oval shape with subtle natural asymmetry (1-2mm acceptable),
  natural eyebrows, medium-full lips
- Body: ${bodyShapeDesc}

═══════════════════════════════════════════════════════
SKIN — Photorealistic micro-texture (visible at 100% zoom only)
═══════════════════════════════════════════════════════

The realism comes from SURFACE TEXTURE, not from large spots/marks.
Generate skin where the eye perceives "this is a real photo" because of
micro-variations across every square millimeter, NOT because of distinct
moles or beauty marks.

▸ Pores (most important):
  - Visible at 100% crop on cheeks, nose, forehead, chin
  - Density variation: tighter on nose tip, more relaxed on outer cheeks
  - Each pore renders as a tiny depression catching micro-shadow

▸ Film / sensor grain:
  - Subtle ISO 400-equivalent grain across entire image
  - Slightly heavier in shadow areas (under jaw, ear edge, neck)
  - NOT digital noise — analog film aesthetic

▸ Light interaction (sebum + sub-surface):
  - T-zone sheen: subtle bright micro-reflections on forehead center,
    nose ridge, philtrum, chin tip
  - Matte zones: outer cheeks, jawline, temples — diffuse, not glowing
  - Sub-surface scattering visible in thin areas: earlobe edges
    (faint pink-orange), nostril membrane, eyelid skin
  - The sheen is NON-UNIFORM and IRREGULAR — not a smooth gradient

▸ Settled foundation / 卡粉 (editorial signature):
  - Foundation has settled into fine expression lines around nose folds
    (nasolabial), under eyes (subtle creasing), corners of mouth
  - Slightly emphasized texture where makeup pools (NOT thick, just real)
  - Powder catches light differently from bare skin — visible in T-zone
    reflections

▸ Pigment micro-variation (non-uniform, non-blotchy):
  - Slight redness undertone on cheekbones, ear shells, inner eyelid edge
  - Very subtle uneven pigment across décolletage and shoulders
  - Forearms slightly more tanned than torso
  - Knees and elbows slightly darker than surrounding skin

▸ Tiny freckles / micro-imperfections (NOT moles):
  - Sparse light freckles 0.3-0.8mm equivalent across nose bridge,
    cheekbones, shoulders — like dust scattered, easy to miss at first glance
  - Maximum 5-8 freckles total, ALL very small, NEVER clustered
  - NO single dark spot larger than 1mm
  - NO moles, NO beauty marks, NO distinct dark spots

▸ Hair:
  - Individual strands at all edges, visible flyaways (except clean updo)
  - Backlit edge strands show rim glow / light pass-through
  - Wave/curl/straight texture has natural variation, NOT painted clumps

▸ Eyes:
  - Iris fiber pattern visible (crypts, Fuchs furrows)
  - Faint vessels in sclera near outer corners
  - Individually rendered eyelashes (lower lashes too)
  - Tiny moisture meniscus at lower lid, catchlight in pupil

▸ Lips:
  - Vertical lip lines clearly visible
  - Subtle color variation: upper slightly darker than lower
  - Micro-cracks at corners
  - NO gloss, NO thick lipstick — natural matte tone

═══════════════════════════════════════════════════════
❌ FORBIDDEN
═══════════════════════════════════════════════════════

- ANY mole, beauty mark, or dark spot >1mm — none on face, none on body
- Smooth porcelain / airbrushed / "AI baby skin"
- Plastic / 3D render / Unreal Engine subsurface
- Symmetric features, perfect teeth, uniform skin tone
- Painted hair clumps, anime highlights
- "Generic AI model face" — this person should look specific and real
- Visible redness on nose tip / nostrils
- Acne / pimples / breakouts
- Patchy blotchy pigment

═══════════════════════════════════════════════════════
POSE
═══════════════════════════════════════════════════════

- Standing fully upright, weight balanced equally, feet shoulder-width apart,
  arms relaxed at sides hanging naturally
- Hands visible at sides, fingers relaxed and slightly curved
- ALL 10 TOES visible and clearly separated, barefoot
- Facing camera frontally (0° rotation), eyes looking directly into lens
- Expression: subtle neutral with hint of warmth — eyes alive, mouth closed,
  jaw relaxed

═══════════════════════════════════════════════════════
CAMERA AND LIGHTING
═══════════════════════════════════════════════════════

- Camera: medium format equivalent, Phase One IQ4 150MP
- Lens: 80mm f/2.8 (NO wide-angle distortion at hands/feet)
- Aperture: f/5.6, full body sharp
- Camera at chest height, perfectly level
- Light: 1.5m softbox front-right at 30° azimuth + 15° elevation, white V-flat
  fill opposite, soft even illumination, no harsh shadows
- White balance 5500K, low saturation, neutral tones
- 3:4 portrait, 4K resolution
`;
}

// ─────────────────────────────────────────────────────────
// 给前端用：枚举值 → 中文 label（用在下拉框）
// ─────────────────────────────────────────────────────────

export const ETHNICITY_LABELS: Record<Ethnicity, string> = {
  "east-asian": "东亚（中日韩）",
  "southeast-asian": "东南亚",
  "south-asian": "南亚（印度等）",
  "european-fair": "北欧 / 西欧（白皙）",
  "european-mediterranean": "南欧（地中海橄榄色）",
  african: "非裔",
  "latin-american": "拉美",
  "middle-eastern": "中东",
  mixed: "混血",
};

export const AGE_LABELS: Record<AgeRange, string> = {
  "20-25": "20-25 岁",
  "25-30": "25-30 岁",
  "30-35": "30-35 岁",
  "35-40": "35-40 岁",
};

export const HAIR_COLOR_LABELS: Record<HairColor, string> = {
  black: "黑色",
  "dark-brown": "深栗棕",
  brown: "中棕",
  "blonde-light": "浅金",
  "blonde-medium": "蜂蜜金",
  red: "红棕",
  "gray-silver": "灰白",
};

export const HAIR_STYLE_LABELS: Record<HairStyle, string> = {
  "long-straight": "长直发（中背长）",
  "long-wavy": "长波浪（中背长）",
  "medium-shoulder": "齐肩内卷",
  "short-bob": "波波短发",
  "updo-bun": "低盘发",
};

export const BODY_SHAPE_LABELS: Record<BodyShape, string> = {
  slim: "纤瘦",
  standard: "标准",
  athletic: "运动健康",
  curvy: "曲线丰满",
  plus: "大码",
  maternity: "孕妇",
  teen: "青少年",
};

// 用前端的 SelectField 类组件喜欢这种数组格式
export const ETHNICITY_OPTIONS = (
  Object.keys(ETHNICITY_LABELS) as Ethnicity[]
).map((v) => ({ value: v, label: ETHNICITY_LABELS[v] }));
export const AGE_OPTIONS = (Object.keys(AGE_LABELS) as AgeRange[]).map(
  (v) => ({ value: v, label: AGE_LABELS[v] }),
);
export const HAIR_COLOR_OPTIONS = (
  Object.keys(HAIR_COLOR_LABELS) as HairColor[]
).map((v) => ({ value: v, label: HAIR_COLOR_LABELS[v] }));
export const HAIR_STYLE_OPTIONS = (
  Object.keys(HAIR_STYLE_LABELS) as HairStyle[]
).map((v) => ({ value: v, label: HAIR_STYLE_LABELS[v] }));
export const BODY_SHAPE_OPTIONS = (
  Object.keys(BODY_SHAPE_LABELS) as BodyShape[]
).map((v) => ({ value: v, label: BODY_SHAPE_LABELS[v] }));

// 类型守卫
export function isValidEthnicity(v: unknown): v is Ethnicity {
  return typeof v === "string" && v in ETHNICITY_LABELS;
}
export function isValidAge(v: unknown): v is AgeRange {
  return typeof v === "string" && v in AGE_LABELS;
}
export function isValidHairColor(v: unknown): v is HairColor {
  return typeof v === "string" && v in HAIR_COLOR_LABELS;
}
export function isValidHairStyle(v: unknown): v is HairStyle {
  return typeof v === "string" && v in HAIR_STYLE_LABELS;
}
export function isValidBodyShape(v: unknown): v is BodyShape {
  return typeof v === "string" && v in BODY_SHAPE_LABELS;
}
