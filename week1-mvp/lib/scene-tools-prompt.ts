/**
 * Scene Tools — Prompt builders
 *
 * 背景换图（background swap）/ 氛围海报 / 社媒图 三个子功能的 prompt 拼装
 * 都放在这里。当前只实现子功能 1：buildBackgroundSwapPrompt()。
 */

// ─────────────────────────────────────────────────────────
// 共享 FRAMING 段（关键反"硬塞全景"指令）
//
// 现有 scene plate 库里的 plate 大多是宽幅广角（整条柱廊 / 整片花园 /
// 整栋庄园），Gemini 默认会按 plate 全画幅 1:1 渲染，导致：
//   - 模特被强行塞到走廊正中央
//   - 模特和柱子 / 窗户 / 拱门的真实比例失调（模特看起来像玩偶）
//   - 出图焦段错（明明是产品图却像建筑摄影）
//
// 修法：在 prompt 里**反复**告诉模型：scene plate 是"氛围参考"
// 不是"必须复刻的画幅"，要心智裁切一个紧凑的局部。
// ─────────────────────────────────────────────────────────

/** 单人紧凑构图（背景换图主用，85mm 长焦感 + 浅景深）。export 给 batch-photo 复用。 */
export const FRAMING_TIGHT_SINGLE = `══════════════════════════════════════════════════════════
🎯 FRAMING & SCALE — the scene plate is ATMOSPHERE REFERENCE, not a canvas to fill
══════════════════════════════════════════════════════════

CRITICAL: the scene plate (IMAGE 2) is a reference for atmosphere, light,
materials, palette — NOT a canvas you must reproduce edge-to-edge.

▸ MENTALLY CROP a tight local region of the scene around the subject.
  Place her near ONE tangible anchor object she can lean on / stand
  beside (a column base, a railing section, a window ledge, a planter,
  a stair edge, a wall corner, a doorway frame). Show only that local
  fragment in the output — NOT the whole corridor, NOT the whole
  building, NOT the whole garden.

▸ BODY-TO-OBJECT SCALE — body height MUST read as a real human relative
  to visible reference objects:
    • a Doric column is ~80cm wide  → torso similar width
    • a baluster railing is ~90cm tall → at hip-to-waist height
    • a window ledge is ~95cm high → at hip height
    • a doorway is ~210cm tall → head reaches ~80% of the doorway
  Avoid the "tiny doll in giant architecture" mistake.

▸ LENS — 85mm portrait telephoto feel. NOT wide-angle. NO 24mm
  architectural-vista distortion. Compressed front-to-back perspective,
  intimate not panoramic.

▸ DEPTH OF FIELD — shallow (f/2.0–f/2.8 feel). Subject + immediate
  anchor stay tack-sharp. Background recedes into smooth creamy bokeh
  (color blocks and soft shapes), NOT crisp architectural detail.

▸ ALLOW ARCHITECTURE TO EXTEND OUT OF FRAME — one column may go off
  the top edge, one wall may go off the side. Out-of-frame signals
  intimacy. A clean fully-bounded establishing shot is WRONG here.

❌ DO NOT recreate the entire scene plate. NO panorama. NO full corridor
   view. NO sweeping vista. NO full-building reveal. NO 6-7-people-wide
   ground area. The plate is a mood board, not a blueprint.
`;

/** 多人中景构图（poster 用，50mm 自然 + 中等景深） */
const FRAMING_MEDIUM_GROUP = `══════════════════════════════════════════════════════════
🎯 FRAMING & SCALE — the scene plate is ATMOSPHERE REFERENCE, not a canvas to fill
══════════════════════════════════════════════════════════

CRITICAL: the scene plate is a reference for atmosphere, light, materials,
palette — NOT a canvas you must reproduce in full.

▸ MENTALLY CROP a defined SECTION of the scene that comfortably hosts the
  group of 3-4 people side by side, NOT 6-7. Show only that section in
  the output. Use one clear anchor element (a wall section, a window, a
  fountain corner, a railing, a path) as context — partially out of
  frame is fine and preferred.

▸ BODY-TO-OBJECT SCALE — every subject's body height must read as a real
  human relative to nearby reference objects (columns, doors, windows).
  Avoid "tiny dolls in giant architecture."

▸ LENS — 50mm natural portrait feel. NOT ultra-wide. NO panoramic look.

▸ DEPTH OF FIELD — moderate shallow (f/3.5–f/5.6 feel). Group plane
  sharp; background softens but remains recognizable.

❌ DO NOT recreate the entire scene plate's panorama. NO full-building
   reveal, NO scenic establishing shot. The plate is a mood board.
`;

/** Phone-snap 紧凑构图（社媒图用 —— 还是要有手机感，但不要广角全景） */
const FRAMING_PHONE_TIGHT = `══════════════════════════════════════════════════════════
🎯 FRAMING — even on phone, the camera was CLOSE to the subject(s)
══════════════════════════════════════════════════════════

The scene plate is atmosphere reference — NOT a panorama you must fill.

▸ The phone was held close. Frame should show subject(s) in the
  foreground/middle as a meaningful chunk of the image, with one or two
  scene elements behind them as casual context.
▸ NOT a scenic establishing shot with small figures in a vast landscape.
▸ Subjects' body heights must read as real humans relative to nearby
  reference objects (a doorway, a column, a sign, a car). No "doll vs
  giant architecture" look.
▸ Phone wide-angle (~24mm) distortion at the edges is allowed, but the
  central subjects stay close and intimate. Background can extend
  PARTIALLY OUT OF FRAME — that's how casual phone snaps actually look.
`;

// ─────────────────────────────────────────────────────────
// 子功能 1：背景换图（background swap）
// ─────────────────────────────────────────────────────────

/** 背景换图模式 */
export type BackgroundSwapMode = "composition" | "edit";

const BG_SWAP_MODE_LABELS: Record<BackgroundSwapMode, string> = {
  composition:
    "重新合成（推荐）—— 模型按新场景重新打光、可微调姿势，整合更自然",
  edit: "硬换（兜底）—— 锁定原图所有元素只换背景，可能有合成感",
};

export const BG_SWAP_MODE_OPTIONS = (
  Object.keys(BG_SWAP_MODE_LABELS) as BackgroundSwapMode[]
).map((v) => ({ value: v, label: BG_SWAP_MODE_LABELS[v] }));

export function isValidBackgroundSwapMode(
  v: unknown,
): v is BackgroundSwapMode {
  return typeof v === "string" && v in BG_SWAP_MODE_LABELS;
}

/**
 * 拼装背景换图 prompt（dispatch 到具体模式）。
 *
 *   IMAGE 1 = 原始成片（模特 + 服装 + 旧背景）
 *   IMAGE 2 = scene plate（空场景）
 *
 * - composition（推荐）：把原图当作"这个模特+这件衣服"的参考，
 *   按新场景重新合成一张照片，允许姿势 / 光线 / 镜头 / 距离自然变化。
 *   解决 edit 模式"人物悬浮、光线不匹配"的硬融感。
 * - edit（兜底）：完整保留原图人物 / 衣服 / 姿势，只换背景。
 *   有些场景需要严格保留原片状态时用。
 *
 * @param scenePlateName - scene plate 中文名
 * @param mode - composition / edit，默认 composition
 * @param userHint - 可选用户补充指令（"模特沿着小径走来"）
 */
export function buildBackgroundSwapPrompt(
  scenePlateName?: string,
  mode: BackgroundSwapMode = "composition",
  userHint?: string,
): string {
  if (mode === "composition") {
    return buildBackgroundSwapPromptComposition(scenePlateName, userHint);
  }
  return buildBackgroundSwapPromptEdit(scenePlateName);
}

/* ───────── composition 模式（推荐） ───────── */

function buildBackgroundSwapPromptComposition(
  scenePlateName?: string,
  userHint?: string,
): string {
  const sceneHint = scenePlateName
    ? `\n  Scene location name: "${scenePlateName}"`
    : "";
  const userHintBlock = userHint?.trim()
    ? `\n══════════════════════════════════════════════════════════
👤 USER ADDITIONAL HINT (creative direction)
══════════════════════════════════════════════════════════

${userHint.trim()}\n`
    : "";

  return `You will receive TWO images:

▸ IMAGE 1 — A photograph of a model wearing a specific garment
   (in some prior background — that background is to be DISCARDED).
▸ IMAGE 2 — A new venue / location.${sceneHint}

══════════════════════════════════════════════════════════
🚨 TASK — Generate a FRESH SHOOT at IMAGE 2's location
══════════════════════════════════════════════════════════

This is NOT "paste subject onto new background" editing.
This is a brand-new photograph captured ON LOCATION at IMAGE 2's venue,
using IMAGE 1 as a "this is the model and her dress" reference.

Think: same model + same dress, photographed by a different photographer
at a different time and place. Pose may shift naturally; lighting is
completely redone.

══════════════════════════════════════════════════════════
✅ EXTRACT FROM IMAGE 1 (preserve identity, NOT pixel data)
══════════════════════════════════════════════════════════

KEEP:
- Model's face: identity, features, hair color & style, skin tone
- Garment: color, fabric, fit, length, neckline, sleeves, patterns,
  embroidery, beads, lace, hems, all visible details
- Accessories visible on the subject (jewelry, shoes, etc.)

❌ DO NOT preserve from IMAGE 1:
- The original background — completely gone
- The original lighting on the subject — fully redone for IMAGE 2
- The original pose — allowed to shift naturally for the new scene
- The original camera distance / framing — set fresh for new scene

══════════════════════════════════════════════════════════
🎬 RENDER FRESH AT IMAGE 2
══════════════════════════════════════════════════════════

▸ POSE: natural for IMAGE 2's setting. The pose CAN AND SHOULD shift
  slightly from the source — e.g., if IMAGE 2 is a path she might be
  walking; if it's a wall she might lean. Do NOT robotically lock the
  source pose.

▸ CAMERA: eye-level fashion editorial framing, full body or 3/4 framing
  (match the natural scale a fashion photographer would choose for
  IMAGE 2's environment).

▸ LIGHTING: 100% from IMAGE 2's natural light sources. The subject MUST
  look as if she was actually photographed at this venue at this time
  of day:
  - Color temperature: shift skin tone and dress color to match scene
    (warm golden hour vs cool overcast vs warm string-lit night)
  - Brightness: match scene's ambient level (night scene = subject is
    darker overall, with selective rim/key from practical lights)
  - Shadow direction: from scene's key light, with realistic ground
    shadow at the subject's feet
  - Ambient bounce: subtle color reflections from scene surfaces onto
    subject (warm stone bounce, green grass bounce, etc.)
  - Atmospheric perspective / haze: if scene has haze, apply it to
    subject's edges proportionally

▸ INTEGRATION: subject stands in IMAGE 2's natural "people zone"
  (path, floor, lawn, ground area). Soft anchored shadows at feet.
  No "cut-out" silhouette — edges should feel organically lit by scene.

${FRAMING_TIGHT_SINGLE}
══════════════════════════════════════════════════════════
❌ FORBIDDEN — these break the "fresh shoot" feel
══════════════════════════════════════════════════════════

- "Pasted-on" look: subject lit differently from environment
- Subject still studio-bright while scene is night/dim/golden
- Sharp cut-out silhouette against scene
- Concept art / painted look / 3D render aesthetic
- Modifying garment color, fabric, or design details
- Swapping the model's identity (must stay the same person)
- Adding people, props, or decorations not in IMAGE 2
- Modifying scene structure beyond what's needed for subject placement
- Returning IMAGE 1 unchanged
${userHintBlock}
══════════════════════════════════════════════════════════
OUTPUT
══════════════════════════════════════════════════════════

Output ONE photograph at high resolution. The result should look like
the model was actually on location at IMAGE 2's venue — fresh shoot,
not composite.
`;
}

/* ───────── edit 模式（兜底） ───────── */

function buildBackgroundSwapPromptEdit(scenePlateName?: string): string {
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

${FRAMING_TIGHT_SINGLE}
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

${FRAMING_MEDIUM_GROUP}${userHintBlock}
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
// 子功能 4：仿图（参考图驱动的多人合成）
// 流程分两步：
//   1. analyze —— 用 Gemini 2.5 Flash vision 解析参考图里的模特数量 + 每个人的位置/姿势/视角，
//      返回结构化 JSON，UI 拿到就能渲染 A/B/C/D/E 编号 + 上传槽
//   2. compose —— 用 Pro Image 4K 把参考图 + N 张产品图融合：
//      参考图给场景/光线/构图/姿势布局，产品图给身份+服装，按编号一一对应
// ─────────────────────────────────────────────────────────

/** 仿图 analyze prompt：让 Gemini 2.5 Flash 解析参考图里的人物 */
export const REPLICATE_ANALYZE_PROMPT = `You are analyzing a fashion editorial / wedding / lookbook photograph.

Identify EVERY visible human model in the photo (1 to 5 people max). For each person,
return a structured description.

Output STRICT JSON only — no markdown, no commentary, no code fences.

Schema:
{
  "count": <integer 1-5>,
  "models": [
    {
      "label": "A" | "B" | "C" | "D" | "E",   // assigned LEFT-TO-RIGHT order in the frame
      "position": "leftmost" | "center-left" | "center" | "center-right" | "rightmost" | "front" | "back" | etc.,
      "role": "bride" | "bridesmaid" | "groom" | "groomsman" | "guest" | "model" | etc.,
      "pose": "<one short Chinese sentence describing what she/he is doing, e.g. '侧身倚靠柱子，左手撩头发'>",
      "view": "frontal" | "three-quarter" | "profile" | "back",
      "framing": "full-body" | "three-quarter" | "waist-up" | "headshot"
    }
  ]
}

Rules:
- Labels MUST go LEFT-TO-RIGHT in screen order (A is leftmost). If two people overlap
  horizontally, the closer one (foreground) gets the earlier label.
- If you see fewer than 1 or more than 5 people, clip to [1, 5].
- "pose" field MUST be in Chinese, one short sentence (≤25 chars).
- ALL other fields are English enum values from the schema above.
- Return ONLY the JSON object. No prose.`;

/**
 * 仿图 compose prompt：多图融合
 *
 * IMAGE 1 = 参考图（场景 + 模特排布 + 光线 + 构图）
 * IMAGES 2..N+1 = N 张产品图，按 A/B/C/D/E 顺序对应参考图里的模特位
 *
 * @param models analyze 返回的 models 数组（已经 1-N 张产品图各对应一位）
 * @param userHint 可选追加（"模特们更靠近一点"）
 */
export function buildReplicatePrompt(
  models: Array<{
    label: string;
    position: string;
    role: string;
    pose: string;
    view: string;
    framing: string;
  }>,
  userHint?: string,
): string {
  const n = models.length;
  const refLabel = "IMAGE 1";
  const sourceRange =
    n === 1 ? "IMAGE 2" : `IMAGES 2-${n + 1}`;

  const slotMappingLines = models
    .map((m, idx) => {
      const imgIdx = idx + 2;
      return `▸ Slot ${m.label} → IMAGE ${imgIdx}
   • Position in ${refLabel}: ${m.position}
   • Role: ${m.role}
   • Original pose in ${refLabel} (use as guide, may relax): ${m.pose}
   • View: ${m.view} · Framing: ${m.framing}
   • Replace this person's face/identity AND clothing using IMAGE ${imgIdx}.
     Keep IMAGE ${imgIdx}'s model face & garment; ignore IMAGE ${imgIdx}'s background.`;
    })
    .join("\n\n");

  const userHintBlock = userHint?.trim()
    ? `\n══════════════════════════════════════════════════════════
👤 USER ADDITIONAL HINT (creative direction)
══════════════════════════════════════════════════════════

${userHint.trim()}\n`
    : "";

  return `You will receive ${n + 1} images:

▸ ${refLabel} — A REFERENCE photograph. Use it as the SCENE / LIGHTING /
   COMPOSITION / GROUP-LAYOUT template. We will REPLACE the people in this
   reference photo with people from the source photos.
▸ ${sourceRange} — ${n} source photo${n > 1 ? "s" : ""} of model${n > 1 ? "s" : ""}
   wearing clothing. Each shows one person + their garment in some prior
   background (background to be ignored).

══════════════════════════════════════════════════════════
🚨 TASK — Re-shoot ${refLabel} with the source models
══════════════════════════════════════════════════════════

Generate ONE new photograph that LOOKS LIKE ${refLabel}'s scene + lighting +
group composition, but with the people swapped: each labeled position in
${refLabel} is filled by the corresponding source model & garment.

══════════════════════════════════════════════════════════
✅ TAKE FROM ${refLabel} (REFERENCE)
══════════════════════════════════════════════════════════

- The ENTIRE scene / location / background
- Lighting direction, color temperature, time of day, atmosphere
- Camera angle, focal length feel, depth of field
- Group composition: where each person stands relative to the other(s)
  AND relative to the scene
- Approximate poses (use as guide; allow natural variation)

══════════════════════════════════════════════════════════
🔄 SLOT MAPPING (replace each labeled position with the source model)
══════════════════════════════════════════════════════════

${slotMappingLines}

══════════════════════════════════════════════════════════
✅ TAKE FROM EACH SOURCE IMAGE
══════════════════════════════════════════════════════════

- Face / identity / hair color / skin tone of that source's model
- Garment: every detail — color, fabric, fit, length, neckline, sleeves,
  patterns, embroidery, beads, lace, hems, accessories, shoes
- DO NOT change the source model's face or garment

❌ DO NOT borrow source images' backgrounds — they are discarded.
❌ DO NOT swap face identity between slots — slot A keeps IMAGE 2's face,
   slot B keeps IMAGE 3's face, etc.

══════════════════════════════════════════════════════════
🎬 POSE FREEDOM
══════════════════════════════════════════════════════════

Pose is NOT strictly locked. Each replaced model may NATURALLY relax /
adjust her pose to fit her body and the scene — slight repositioning,
hand placement variation, gaze shift are all allowed and encouraged.
The goal is "looks natural in the scene", not "robot-perfect copy of
the original pose".

══════════════════════════════════════════════════════════
☀️ LIGHTING UNIFICATION
══════════════════════════════════════════════════════════

Critical: every replaced model must be re-lit by ${refLabel}'s light:
- Light direction (key/fill from same direction as in ${refLabel})
- Color temperature (warm golden / cool overcast / etc. matching ${refLabel})
- Shadow density and ground shadows on the floor of ${refLabel}'s scene
- Ambient bounce from ${refLabel}'s nearby surfaces
- Atmospheric haze / glow if present in ${refLabel}

If source photos had different lighting originally, RE-LIGHT them so the
final image looks like one cohesive moment shot at ${refLabel}'s location.

══════════════════════════════════════════════════════════
🧍 SCALE & PROPORTION
══════════════════════════════════════════════════════════

- All replaced models share consistent realistic body height (no doll vs
  giant mismatches)
- Body height reads as a real human relative to ${refLabel}'s reference
  objects (column / wall / door / window etc.)
- Heads at roughly same vertical level unless ${refLabel}'s composition
  shows otherwise (e.g., one sitting)
${userHintBlock}
══════════════════════════════════════════════════════════
❌ FORBIDDEN
══════════════════════════════════════════════════════════

- Mismatched lighting (subject lit differently from scene)
- Tangled limbs between subjects
- Subject identity swap between slots
- Studio-bright subject in dim/golden scene
- "Pasted-on" cut-out look
- Adding/removing people not in ${refLabel}
- Modifying ${refLabel}'s scene or layout beyond people-swap
- Modifying source garments or faces
- Concept art / painted look / 3D render aesthetic
- Watermarks, text, logos

══════════════════════════════════════════════════════════
OUTPUT
══════════════════════════════════════════════════════════

ONE photograph at high resolution. Looks like ${refLabel}'s photoshoot
re-cast with the source models, all in unified lighting and natural pose.
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

${FRAMING_PHONE_TIGHT}
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

