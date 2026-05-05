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
// 子功能 2：氛围海报（多人合成 KV）
// ─────────────────────────────────────────────────────────

/** 海报构图模式 */
export type PosterComposition = "static" | "gathering";

const POSTER_COMPOSITION_LABELS: Record<PosterComposition, string> = {
  static: "分区站位（稳，无重叠）",
  gathering: "松散群组（可对视、轻接触）",
};

export const POSTER_COMPOSITION_OPTIONS = (
  Object.keys(POSTER_COMPOSITION_LABELS) as PosterComposition[]
).map((v) => ({ value: v, label: POSTER_COMPOSITION_LABELS[v] }));

export function isValidPosterComposition(
  v: unknown,
): v is PosterComposition {
  return typeof v === "string" && v in POSTER_COMPOSITION_LABELS;
}

const COMPOSITION_RULES: Record<PosterComposition, string> = {
  static: `Composition mode: STATIC ZONE ALLOCATION (most reliable).

Each person occupies a SEPARATE horizontal zone of the frame:
- Divide the frame horizontally into N equal zones (where N = number of people)
- Person 1 (from IMAGE 1) → leftmost zone, vertically centered
- Person 2 (from IMAGE 2) → second zone from left, vertically centered
- Person 3 (from IMAGE 3) → middle zone, vertically centered
- Person 4 (from IMAGE 4) → second zone from right, vertically centered
- Person 5 (from IMAGE 5) → rightmost zone, vertically centered

Each person stays WITHIN their own zone. NO overlapping bodies, NO crossing
of arms/legs into adjacent zones. They all face roughly toward the camera
(0-30° rotation), eye-level direct gaze or slight averted look.

Spacing: gentle gap between people (~10-15% of frame width). They are
clearly each their own subject, like a "lookbook line-up shot."

This is the SAFEST mode — pose-tangle and body-merge issues minimized.`,

  gathering: `Composition mode: LOOSE GATHERING (slightly more interactive).

People form a casual cluster — NOT lined up rigidly, but also NOT in tight
overlap. Allow:
- Slight asymmetric spacing (some closer, some further)
- Heads turned toward each other (suggests conversation), eyes can still
  glance toward camera
- One or two people slightly behind / in front for depth
- A hand might rest lightly on another's shoulder or elbow — minimal contact
- Leaning toward each other slightly (5-10° body lean)

DO NOT:
- Cross arms / legs through other people's bodies
- Have anyone in front fully blocking another person's face
- Have hands intertwined or hugging tightly (that's "interactive" mode, v2)
- Make limb contact ambiguous (avoid "whose hand is this" confusion)

The vibe: a real group portrait moment — friends gathered for a photo,
caught in a relaxed second between formal pose and candid.`,
};

/**
 * 拼装氛围海报（poster）prompt。
 *
 * 输入图片顺序约定（API 端按这个顺序 push 进 inputs 数组）：
 *   IMAGES 1..N = 已有成片（每张含 1 位模特 + 服装）
 *   IMAGE N+1   = scene plate
 *
 * 跟 social-snap 同输入结构，但：
 *  - 4K（poster 要展示在 hero / banner，分辨率必须够）
 *  - editorial 调性，NOT phone-snap
 *  - 显式分区/松散群组（多人合成最大难点）
 *
 * @param sourceCount - 几张原片（1-5）
 * @param composition - 'static' | 'gathering'
 * @param sceneName - scene plate 中文名
 * @param userHint - 可选用户补充指令（"模特们站在长桌前举杯"）
 */
export function buildPosterPrompt(
  sourceCount: number,
  composition: PosterComposition,
  sceneName?: string,
  userHint?: string,
): string {
  const n = Math.max(1, Math.min(5, sourceCount));
  const sourceIndexRange =
    n === 1
      ? "IMAGE 1"
      : n === 2
        ? "IMAGES 1-2"
        : n === 3
          ? "IMAGES 1-3"
          : n === 4
            ? "IMAGES 1-4"
            : "IMAGES 1-5";
  const sceneImageIndex = `IMAGE ${n + 1}`;
  const sceneHint = sceneName
    ? ` (scene name for context: "${sceneName}")`
    : "";
  const peopleNoun = n === 1 ? "the model" : `the ${n} models`;
  const compositionRule = COMPOSITION_RULES[composition];
  const userHintBlock = userHint?.trim()
    ? `\n══════════════════════════════════════════════════════════
👤 USER ADDITIONAL HINT (creative direction)
══════════════════════════════════════════════════════════

${userHint.trim()}\n`
    : "";

  return `You will receive ${n + 1} images and generate ONE editorial-quality
poster photograph (suitable for website hero / banner / KV).

▸ ${sourceIndexRange}  — ${n} existing photograph${n > 1 ? "s" : ""} of model${n > 1 ? "s" : ""} wearing clothing.
   Each photo already shows one person with their clothing in some prior
   background. Extract the PERSON + their CLOTHING from each photo;
   ignore each photo's original background entirely.
▸ ${sceneImageIndex}     — Poster scene background plate${sceneHint}

══════════════════════════════════════════════════════════
🚨 TASK — Generate an ATMOSPHERIC POSTER (KV / banner / hero)
══════════════════════════════════════════════════════════

Place ${peopleNoun} from ${sourceIndexRange} into the scene from
${sceneImageIndex}, composed as a unified editorial poster — high-end
fashion campaign aesthetic, suitable for website hero, banner, or
marketing KV.

══════════════════════════════════════════════════════════
✅ MUST PRESERVE FROM EACH SOURCE PHOTO
══════════════════════════════════════════════════════════

For each source photo, KEEP exactly:
- Face, identity, expression baseline, hair color & style
- Body type, approximate pose (small natural variations OK)
- Clothing: ALL details — color, fabric, fit, length, neckline, sleeves,
  patterns, embroidery, beads, lace, buttons, hems, accessories, shoes
- Skin tone & texture

❌ DO NOT change anyone's appearance, swap faces, modify outfits.
❌ DO NOT borrow the original photos' backgrounds.
❌ DO NOT make multiple people look like the same model — each retains
   their own face from their respective source image.

══════════════════════════════════════════════════════════
🔄 REPLACE WITH ${sceneImageIndex}'S SCENE
══════════════════════════════════════════════════════════

The new background, ground, walls, sky, props, all environmental elements
come from ${sceneImageIndex}.

══════════════════════════════════════════════════════════
☀️ UNIFY LIGHTING — all subjects must share ONE light source
══════════════════════════════════════════════════════════

This is THE most critical step for a poster to look real (not a Photoshop
collage):

- All ${n === 1 ? "person" : "people"} must be lit by the SAME light source
  matching ${sceneImageIndex}'s natural light direction
- Light direction: identify ${sceneImageIndex}'s key light (where does sun /
  main light come from?) and apply that direction to every subject's face,
  body, clothing
- Shadow direction: every subject's shadow on the ground falls in the same
  direction (parallel shadows = unified light)
- Color temperature: shift all subjects' skin tones and clothing colors to
  the scene's color temp (warm golden hour vs cool overcast etc.)
- Density / contrast: match shadow depth to scene's contrast level
- Ambient bounce: subtle reflections from scene surfaces onto subjects
  (warm bounce from limestone, green bounce from grass, etc.)

If different source photos had different lighting originally, RE-LIGHT
all of them so they look like they were photographed together at this
moment, in this scene.

══════════════════════════════════════════════════════════
🧍 PEOPLE COMPOSITION
══════════════════════════════════════════════════════════

${compositionRule}

▸ SCALE UNIFORMITY — All subjects' heights must be consistent and realistic
  (no giant + tiny mismatches). Heads should sit at roughly similar
  vertical level unless the scene context suggests otherwise (e.g., one
  sitting, others standing).

▸ SUBJECT PLACEMENT — Each person stands on the scene's natural ground /
  floor surface with realistic proportional shadow at their feet.

▸ FACING DIRECTION — Default: subjects face roughly toward the camera
  (0-30° rotation). They are aware of being photographed.
${userHintBlock}
══════════════════════════════════════════════════════════
📐 OUTPUT QUALITY (poster / KV requirements)
══════════════════════════════════════════════════════════

This image will be used as a WEBSITE HERO / BANNER / KV — so:
- Editorial fashion campaign aesthetic — Vogue / Harper's Bazaar lookbook
- Premium magazine quality — sharp details on faces, clothing, environment
- Color graded for cohesive mood (NOT phone-snap raw)
- Composition framed for marketing use — clean negative space where text
  could be added later (top or bottom 15%)
- ALL subject faces clearly visible (not blocked by other people / props)
- Clothing details clearly readable (this is a fashion product poster)

══════════════════════════════════════════════════════════
❌ FORBIDDEN
══════════════════════════════════════════════════════════

- Phone-snap aesthetic (motion blur, amateur framing) — this is editorial
- Subjects in mismatched lighting (key indicator of bad composite)
- Tangled arms/legs between subjects
- Faces looking the same (each person retains their own identity)
- One subject blocking another's face
- Floating subjects (no ground shadow)
- Mismatched scale between subjects
- Adding decorative elements not in ${sceneImageIndex}
- Watermarks, logos, text overlays
- Concept art / painted look / 3D render aesthetic

══════════════════════════════════════════════════════════
OUTPUT
══════════════════════════════════════════════════════════

Output ONE photograph at high resolution. The result should look like a
single editorial photoshoot moment captured at ${sceneImageIndex}'s
location, with all ${n === 1 ? "subject" : "subjects"} present together
in unified lighting.
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
 *   IMAGES 1..N = 已有成片（每张里包含一位模特 + 服装 + 任意背景）
 *   IMAGE N+1   = scene plate（要替换的新场景）
 *
 * 跟"背景换图"的区别：背景换图是 1 张片 → 1 张片（换背景）；
 * 社媒图是 N 张片（每张人各异）→ 1 张合成（多人在新场景里）+ phone-snap 风格。
 *
 * 关键设计：phone-snap 风格让 AI 的"完美"倾向变成弱点 —
 * 故意"拍坏"= 真实感 = 社媒爆款的特质。
 *
 * @param sourceCount - 几张原片（1-3）
 * @param vibe - 风格氛围
 * @param sceneName - scene plate 中文名（注入语义）
 */
export function buildSocialSnapPrompt(
  sourceCount: number,
  vibe: SocialVibe,
  sceneName?: string,
): string {
  const n = Math.max(1, Math.min(3, sourceCount));
  const sourceIndexRange =
    n === 1 ? "IMAGE 1" : n === 2 ? "IMAGES 1-2" : "IMAGES 1-3";
  const sceneImageIndex = `IMAGE ${n + 1}`;
  const sceneHint = sceneName
    ? ` (scene name for context: "${sceneName}")`
    : "";
  const peopleNoun = n === 1 ? "the model" : `the ${n} models`;
  const vibeHint = VIBE_HINTS[vibe];

  return `You will receive ${n + 1} images and generate ONE photograph.

▸ ${sourceIndexRange}  — ${n} existing photograph${n > 1 ? "s" : ""} of model${n > 1 ? "s" : ""} wearing clothing.
   Each photo already shows one person with their clothing in some prior
   background. Extract the PERSON + their CLOTHING from each photo;
   ignore each photo's original background entirely.
▸ ${sceneImageIndex}     — New scene background plate${sceneHint}

══════════════════════════════════════════════════════════
🚨 TASK — Generate a SOCIAL-MEDIA PHONE-SNAP photograph
══════════════════════════════════════════════════════════

Take ${peopleNoun} from ${sourceIndexRange} and place ${n === 1 ? "her" : "them all"}
into the scene from ${sceneImageIndex}. Render as if shot CASUALLY ON A PHONE
in a candid moment — NOT a professional photo shoot.

Vibe: ${vibeHint}

══════════════════════════════════════════════════════════
✅ MUST PRESERVE FROM EACH SOURCE PHOTO
══════════════════════════════════════════════════════════

For each source photo, KEEP exactly these elements:
- Face, identity, expression, hair color & style
- Body type, pose (or close to original pose, slight natural variation OK)
- Clothing: every detail — color, fabric, fit, length, neckline, sleeves,
  patterns, embroidery, beads, lace, buttons, hems
- Skin tone & texture, accessories, shoes

❌ DO NOT change anyone's appearance, swap faces, modify outfits.
❌ DO NOT borrow the original photos' backgrounds — they go entirely.

══════════════════════════════════════════════════════════
🔄 REPLACE WITH ${sceneImageIndex}'S SCENE
══════════════════════════════════════════════════════════

The new background, ground, walls, sky, all environmental elements come
from ${sceneImageIndex}. The original backgrounds in ${sourceIndexRange}
are completely discarded.

══════════════════════════════════════════════════════════
☀️ RE-LIGHT EACH PERSON TO MATCH THE NEW SCENE
══════════════════════════════════════════════════════════

This is critical for the composite to look real — NOT pasted-on:
- Light direction: re-light each person so highlights/shadows on their
  face/body/clothing match the natural light direction in ${sceneImageIndex}
- Color temperature: shift skin tones and clothing colors to match the
  scene's color temperature (warm golden hour vs cool overcast etc.)
- Shadow density: match contrast level to the scene
- Ground shadows: cast realistic shadows from each person onto the scene's
  floor/ground, with shape and direction consistent with scene lighting
- Ambient bounce: subtle color reflection from scene's surroundings
  (green grass = subtle green tint on legs; warm stone = warm bounce on
  shadowed side)

══════════════════════════════════════════════════════════
🧍 ${n > 1 ? "MULTI-PERSON COMPOSITION" : "SINGLE-PERSON COMPOSITION"}
══════════════════════════════════════════════════════════

${
  n === 1
    ? `Place the model in the scene's natural ground/floor area.
Slightly off-center is fine and encouraged for phone-snap feel.`
    : `Place all ${n} models in the scene with NATURAL spatial relationship:
- They can overlap, lean toward each other, share a casual moment
- DO NOT line them up like a formal group photo
- DO NOT position them perfectly evenly spaced
- One can be slightly out-of-focus or partially cropped at edge — that's
  what real phone snaps look like
- Vary heights, postures, gestures — even if their original poses were
  similar, allow natural relaxation/adjustment for the moment
- Their relative scales should make sense (no giant + tiny mismatches)`
}

══════════════════════════════════════════════════════════
📱 PHONE-SNAP AESTHETIC (deliberately imperfect — imperfection IS the point)
══════════════════════════════════════════════════════════

Camera: as if shot on iPhone 13 / 14 / 15 main camera or Samsung Galaxy.

Required imperfections (ALL must be present, this is what makes it real):
- Slight motion blur somewhere (subject's hand, hair flying, edge of frame)
- Mild auto-exposure imbalance (one bright window or light source slightly
  blown out, or a shadow area slightly crushed)
- Casual amateur framing: subject NOT perfectly centered. Maybe head close
  to top edge, or one subject partially cropped at edge of frame
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
- Symmetric / rule-of-thirds perfectly applied
- Overly polished / Vogue-editorial feel
- Concept art / painted look / 3D render aesthetic

═══════════════════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════════════════

Output ONE photograph. The result should look like it was just snapped
and uploaded directly to Instagram / TikTok / 小红书 — fresh, alive,
slightly imperfect, NOT a retouched professional shoot.
`;
}

