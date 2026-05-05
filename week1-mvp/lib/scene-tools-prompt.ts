/**
 * Scene Tools — Prompt builders
 *
 * 背景换图（background swap）/ 氛围海报 / 社媒图 三个子功能的 prompt 拼装
 * 都放在这里。当前只实现子功能 1：buildBackgroundSwapPrompt()。
 */

// ─────────────────────────────────────────────────────────
// 子功能 1：背景换图（background swap）
// ─────────────────────────────────────────────────────────

/**
 * 拼装背景换图 prompt。
 *
 * 给 Gemini Pro Image edit 模式吃两张图：
 *   IMAGE 1 = 原始成片（模特 + 服装 + 旧背景）
 *   IMAGE 2 = scene plate（空场景）
 *
 * 任务：保留 IMAGE 1 的人 / 衣 / 姿势 / 表情，把背景替换为 IMAGE 2，
 * 同时让人物的光线方向 / 阴影 / 色温 / 氛围跟 IMAGE 2 匹配。
 *
 * @param scenePlateName - scene plate 的中文名（注入 prompt 帮模型对齐语义）
 */
export function buildBackgroundSwapPrompt(scenePlateName?: string): string {
  const sceneHint = scenePlateName
    ? `\n  Scene plate name (for context): "${scenePlateName}"`
    : "";

  return `You will receive TWO images:

▸ IMAGE 1 — A photograph of a model wearing clothing in some background.
▸ IMAGE 2 — An empty venue background plate (no people).${sceneHint}

══════════════════════════════════════════════════════════
🚨 TASK
══════════════════════════════════════════════════════════

Generate ONE new photograph that places the SUBJECT from IMAGE 1
into the SETTING from IMAGE 2, as if the model had been photographed
on location at IMAGE 2's venue.

══════════════════════════════════════════════════════════
✅ MUST PRESERVE EXACTLY (from IMAGE 1)
══════════════════════════════════════════════════════════

These elements come from IMAGE 1 and must NOT change:
- Model's face: identity, features, makeup, hair color & style, expression
- Model's body: pose, proportions, gestures, hand positions
- Clothing: every detail — color, fabric, fit, length, neckline, sleeves,
  patterns, embroidery, beads, lace, buttons, zippers, hems
- Accessories: jewelry, shoes, belts, bags as shown in IMAGE 1
- Skin texture, age, ethnicity — keep exactly as in IMAGE 1

❌ DO NOT change the model's appearance, outfit, or pose in any way.
❌ DO NOT swap the model with a different person.
❌ DO NOT modify clothing color, length, or details.

══════════════════════════════════════════════════════════
🔄 MUST REPLACE (from IMAGE 1's environment)
══════════════════════════════════════════════════════════

Replace ALL of these with elements from IMAGE 2:
- The entire background, walls, floor, ground, sky
- Any environmental objects (furniture, plants, props) behind/around the model
- The setting / location atmosphere

══════════════════════════════════════════════════════════
☀️ MUST RE-LIGHT THE SUBJECT TO MATCH IMAGE 2
══════════════════════════════════════════════════════════

This is the most important INTEGRATION step. The model from IMAGE 1
will not look like she belongs in IMAGE 2 unless her lighting matches:

- Light direction: re-light the model so highlights and shadows on her
  face / body / clothing fall in the SAME direction as the natural light
  in IMAGE 2 (e.g., if IMAGE 2 has sun from upper-left, the model's
  highlights must also be on her upper-left).
- Color temperature: shift the model's skin tone and clothing tones to
  match IMAGE 2's color temperature (warm golden hour vs cool overcast).
- Shadow density: match the contrast level — IMAGE 2's environment
  shadows should match the depth of shadow on the model.
- Ground shadow: cast a realistic shadow from the model onto the ground
  in IMAGE 2's setting, with shape and direction consistent with IMAGE 2's
  light source.
- Ambient bounce: add subtle color reflections from IMAGE 2's surroundings
  onto the model (e.g., green grass = subtle green bounce on legs;
  warm stone wall = warm bounce on shadow side).
- Atmospheric perspective: if IMAGE 2 has haze / fog / glare, apply
  proportional softening to the subject's edges and contrast.

══════════════════════════════════════════════════════════
📐 COMPOSITION
══════════════════════════════════════════════════════════

- Output aspect ratio: SAME as IMAGE 1 (do not crop or extend the frame)
- Subject placement: place the model in IMAGE 2's "people insertion zone"
  (the natural ground / floor area where a person would stand)
- Subject scale: keep the same scale as in IMAGE 1 (head/body proportions
  unchanged; only the background changes)
- If IMAGE 1 was full-body, output is full-body; if half-body, half-body.

══════════════════════════════════════════════════════════
❌ FORBIDDEN
══════════════════════════════════════════════════════════

- Concept art / painted look — output must be photographic
- Mismatched lighting (subject lit from one direction, environment from
  another) — light direction MUST be unified
- "Pasted-on" feel where the model floats above the background without
  ground shadow or bounce light
- Adding decorative elements not in IMAGE 2 (no extra flowers, props)
- Adding a second person, statue, or silhouette
- Modifying the model's body proportions or face features
- Adding text, watermarks, logos
- Returning IMAGE 1 unchanged (you MUST replace the background)

══════════════════════════════════════════════════════════
OUTPUT
══════════════════════════════════════════════════════════

Output ONE photograph at high resolution. The result should look like
the model was actually photographed on location at IMAGE 2's venue —
NOT like a Photoshop composite, but like a real shoot.
`;
}

// ─────────────────────────────────────────────────────────
// 子功能 3：社媒图（phone snap 风格）
// ─────────────────────────────────────────────────────────

/** 社媒风格预设 —— 不同氛围对应不同 phone-snap 风格修饰 */
export type SocialVibe = "casual" | "party" | "street" | "lifestyle";

const VIBE_HINTS: Record<SocialVibe, string> = {
  casual:
    "casual everyday hang-out moment, slight laugh / candid expression, NOT posed",
  party:
    "party / celebration vibe, motion energy, drink in hand or moving / dancing, joyful spontaneous",
  street:
    "street walking / city vibe, looking off-camera or mid-stride, urban casual",
  lifestyle:
    "lifestyle vlog moment, mid-activity (eating / sightseeing / chatting), unstaged",
};

const VIBE_LABELS: Record<SocialVibe, string> = {
  casual: "日常 Casual",
  party: "派对 Party",
  street: "街拍 Street",
  lifestyle: "Lifestyle 生活",
};

export const SOCIAL_VIBE_OPTIONS = (
  Object.keys(VIBE_LABELS) as SocialVibe[]
).map((v) => ({ value: v, label: VIBE_LABELS[v] }));

export function isValidSocialVibe(v: unknown): v is SocialVibe {
  return typeof v === "string" && v in VIBE_LABELS;
}

/**
 * 拼装社媒图（phone snap）prompt。
 *
 * 输入图片顺序约定（API 端按这个顺序 push 进 inputs 数组）：
 *   IMAGE 1     = 产品图（衣服）
 *   IMAGE 2..N  = identity 图（1-3 个模特）
 *   IMAGE N+1   = scene plate
 *
 * 关键设计：phone-snap 风格让 AI 的"完美"倾向变成弱点 —
 * 故意"拍坏"= 真实感 = 社媒爆款的特质。
 *
 * @param identityCount - 几张 identity 图（1-3）
 * @param vibe - 风格氛围
 * @param sceneName - scene plate 中文名（注入语义）
 */
export function buildSocialSnapPrompt(
  identityCount: number,
  vibe: SocialVibe,
  sceneName?: string,
): string {
  const n = Math.max(1, Math.min(3, identityCount));
  const identityIndexRange =
    n === 1 ? "IMAGE 2" : n === 2 ? "IMAGES 2-3" : "IMAGES 2-4";
  const sceneImageIndex = n === 1 ? "IMAGE 3" : n === 2 ? "IMAGE 4" : "IMAGE 5";
  const sceneHint = sceneName
    ? ` (scene name for context: "${sceneName}")`
    : "";
  const peopleNoun = n === 1 ? "the model" : `the ${n} models`;
  const vibeHint = VIBE_HINTS[vibe];

  return `You will receive ${n + 2} images and generate ONE photograph.

▸ IMAGE 1     — Product / clothing reference (the garment to be worn)
▸ ${identityIndexRange}  — ${n} model identity reference${n > 1 ? "s" : ""} (face / body / skin)
▸ ${sceneImageIndex}     — Scene background plate${sceneHint}

══════════════════════════════════════════════════════════
🚨 TASK — Generate a SOCIAL-MEDIA PHONE-SNAP photograph
══════════════════════════════════════════════════════════

Place ${peopleNoun} (from ${identityIndexRange}, wearing the garment from IMAGE 1)
into the scene from ${sceneImageIndex}. Render as if shot CASUALLY ON A PHONE
in a candid moment — NOT a professional photo shoot.

Vibe: ${vibeHint}

══════════════════════════════════════════════════════════
📱 PHONE-SNAP AESTHETIC (deliberately imperfect — imperfection IS the point)
══════════════════════════════════════════════════════════

Camera: as if shot on iPhone 13 / 14 / 15 main camera or Samsung Galaxy.

Required imperfections (ALL must be present, this is what makes it real):
- Slight motion blur somewhere (subject's hand, hair flying, edge of frame)
- Mild auto-exposure imbalance (one bright window or light source slightly
  blown out, or a shadow area slightly crushed)
- Casual amateur framing: subject NOT perfectly centered. Maybe head close
  to top edge, or one subject partially cropped at edge of frame, or
  composition feels "snapped quickly without thinking"
- Flash-like or harsh-light moments OK (e.g., direct phone-flash on face
  if it suits the vibe / late-night feel)
- Slight subject sharpness drop — NOT studio-perfect focus
- Minor lens distortion at edges typical of phone wide-angle (~24mm equiv.)
- Hint of digital noise / grain in shadow areas
- Optional: slight finger-shadow / phone-grip vignette in one corner

Color and processing:
- iPhone-like warm-leaning auto-white-balance (slightly warmer than
  professional WB)
- Mid-saturation, NOT pro-color-graded
- Slight contrast boost typical of phone JPEG processing
- NO editorial film look. NO Portra. NO professional retouch.

❌ FORBIDDEN — these break the "real phone snap" feel:
- Studio-perfect lighting / soft beauty light on subject
- Editorial film grain, Kodak Portra look
- Magazine retouching (skin smoothing, color grading)
- Professional composition (rule of thirds perfectly applied)
- Symmetric framing
- Overly polished / Vogue-editorial feel
- Concept art / painted look / 3D render aesthetic

══════════════════════════════════════════════════════════
✅ MUST PRESERVE
══════════════════════════════════════════════════════════

- Garment from IMAGE 1: color, fabric, fit, cut, all visible details
- Each model's face / hair / body type from their identity image
${
  n > 1
    ? "- Each model wears the same garment from IMAGE 1 (matched style)\n"
    : ""
}- Scene from ${sceneImageIndex}: location, lighting direction, atmosphere

══════════════════════════════════════════════════════════
🧍 PEOPLE COMPOSITION
══════════════════════════════════════════════════════════

${
  n === 1
    ? `Single model placed in the scene's natural ground / floor area.
Slightly off-center is fine and encouraged.`
    : `Place all ${n} models in the scene with natural spatial relationship:
- They can overlap, lean toward each other, share a casual moment
- DO NOT line them up like a formal group photo
- DO NOT position them perfectly evenly spaced
- One can be slightly out-of-focus or partially cropped at edge — that's
  what real phone snaps look like
- Heights and gestures should vary naturally`
}

═══════════════════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════════════════

Output ONE photograph. The result should look like it was just snapped
and uploaded directly to Instagram / TikTok / 小红书 — fresh, alive,
slightly imperfect, NOT a retouched professional shoot.
`;
}

