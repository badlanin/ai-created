/**
 * Scene Tools — 服饰场景图（统一工具）· v2 简化版
 *
 * 替代了之前的 5 个 scene-tools 子工具（background-swap / poster /
 * social-snap / replicate / text-shoot），收敛为单一工作流：
 *
 *   产品图（含模特+服装）+ 场景描述 → 把模特放到该场景里重新拍
 *
 * 场景有两种描述方式：
 *   1. 文字场景（free text）—— 模型自由发挥取景 / 光线 / 构图
 *   2. 图片场景（plate）—— 模型把 plate 当氛围参考
 *
 * 出图按 N（产品图）× M（场景）笛卡尔积；每个 (i, j) item 是一张图。
 *
 * v2（2026-05）：根据用户反馈把姿势 / 镜头 / 景深的硬约束全删了，
 * 只保留"保身份 / 保服装 / 换背景 / 用场景光线"四条核心。模型按场景
 * 自己理解怎么摆姿势 + 取景。FRAMING_TIGHT_SINGLE 也已 v2 化（见
 * lib/scene-tools-prompt.ts）。
 */

import { FRAMING_TIGHT_SINGLE } from "./scene-tools-prompt";

/**
 * 文字场景模式 prompt
 *
 * Inputs to model:
 *   IMAGE 1 = 产品图（含模特+服装+原背景）
 *   （无 IMAGE 2，文字模式不带 plate）
 *
 * @param sceneText 中文/英文场景描述
 * @param userHint 可选追加创意指令
 */
export function buildSceneShootText(
  sceneText: string,
  userHint?: string,
): string {
  const sceneClean = sceneText.trim();
  const userHintBlock = userHint?.trim()
    ? `\n══════════════════════════════════════════════════════════
👤 USER ADDITIONAL HINT
══════════════════════════════════════════════════════════

${userHint.trim()}\n`
    : "";

  return `You will receive ONE image:

▸ IMAGE 1 — A photograph of a model wearing a specific garment in some
   prior background. THAT BACKGROUND WILL BE COMPLETELY DISCARDED.

══════════════════════════════════════════════════════════
🚨 TASK — Re-shoot the same model + same garment at a new scene
══════════════════════════════════════════════════════════

This is NOT pixel-edit. This is a brand-new photograph captured ON
LOCATION at the scene described below, using IMAGE 1 only as
"this is the model and her dress" reference.

══════════════════════════════════════════════════════════
🎬 THE SCENE (describe what to photograph)
══════════════════════════════════════════════════════════

${sceneClean}

══════════════════════════════════════════════════════════
✅ KEEP FROM IMAGE 1
══════════════════════════════════════════════════════════

- Model's face: identity, features, hair color & style, skin tone
- Garment: color, fabric, fit, length, neckline, sleeves, patterns,
  embroidery, beads, lace, hems, ALL visible details
- Accessories on subject (jewelry, shoes)

══════════════════════════════════════════════════════════
🎬 RENDER FRESH FOR THE NEW SCENE
══════════════════════════════════════════════════════════

- Background: 100% the described scene
- Lighting: 100% from the scene description (match temperature,
  direction, time-of-day)
- Pose / framing / camera distance / lens / depth of field: choose
  what feels natural for this scene. A real photographer would adapt
  per location — open scenes get wider natural standing, intimate
  corners get tighter editorial framing.
- Body proportions must read as a real human at correct scale to
  anything visible in the scene.
- Edges of the subject lit organically by the scene's light, never
  a "cut-out / pasted-on" composite feel.

══════════════════════════════════════════════════════════
❌ FORBIDDEN
══════════════════════════════════════════════════════════

- Modifying garment color, fabric, design, or details
- Swapping model's identity / face
- "Pasted-on" composite look (subject lit differently from scene)
- Concept art / painted look / 3D render aesthetic
- Watermarks, text, logos
- Returning IMAGE 1 with only minor edits
${userHintBlock}
══════════════════════════════════════════════════════════
OUTPUT
══════════════════════════════════════════════════════════

Output ONE photograph. Looks like a real fashion editorial shot
taken on location at the described scene.
`;
}

/**
 * 图片场景模式 prompt
 *
 * Inputs to model:
 *   IMAGE 1 = 产品图（含模特+服装+原背景）
 *   IMAGE 2 = scene plate（这就是要把模特放进去的场景）
 *
 * @param scenePlateName 场景中文名（写进 prompt 让模型理解上下文）
 * @param userHint 可选追加创意指令
 */
export function buildSceneShootImage(
  scenePlateName?: string,
  userHint?: string,
): string {
  const sceneHint = scenePlateName
    ? `\n  Scene location name: "${scenePlateName}"`
    : "";
  const userHintBlock = userHint?.trim()
    ? `\n══════════════════════════════════════════════════════════
👤 USER ADDITIONAL HINT
══════════════════════════════════════════════════════════

${userHint.trim()}\n`
    : "";

  return `You will receive TWO images:

▸ IMAGE 1 — A photograph of a model wearing a specific garment
   (her face / hair / dress are what we keep; the original background
   is to be DISCARDED).
▸ IMAGE 2 — The new location / scene where to put her.${sceneHint}

══════════════════════════════════════════════════════════
🚨 TASK — Place the model from IMAGE 1 into IMAGE 2's location,
              LIVING in that space (not standing in it)
══════════════════════════════════════════════════════════

This is NOT pixel-paste editing, and it's NOT just "put a person in
front of this background". This is a brand-new photograph where the
model NATURALLY INTERACTS with the furniture / architecture / props
visible in IMAGE 2 — sitting on the chair, leaning on the door frame,
hand resting on the table, holding a cup from the surface, sitting
on the stairs, etc. The pose must arise from what's actually in
IMAGE 2.

══════════════════════════════════════════════════════════
✅ KEEP FROM IMAGE 1
══════════════════════════════════════════════════════════

- Model's face: identity, features, hair color & style, skin tone
- Garment: color, fabric, fit, length, neckline, sleeves, patterns,
  embroidery, beads, lace, hems, ALL visible details
- Accessories on subject (jewelry, shoes)

══════════════════════════════════════════════════════════
🎬 USE IMAGE 2 AS THE LOCATION
══════════════════════════════════════════════════════════

- Background: 100% IMAGE 2's setting (architecture, props, materials,
  palette all come from IMAGE 2)
- Lighting: 100% from IMAGE 2's natural light — match color temperature,
  direction, time-of-day; re-light skin and garment accordingly
- Pose: ACTIVELY interact with IMAGE 2's objects (see next block for
  the full interaction directive)
- Framing / camera distance / lens / depth of field: choose whatever
  a real on-location fashion photographer would for THIS specific
  scene + interaction.

${FRAMING_TIGHT_SINGLE}

══════════════════════════════════════════════════════════
❌ FORBIDDEN
══════════════════════════════════════════════════════════

- Modifying garment color, fabric, design, or details
- Swapping model's identity / face
- "Pasted-on" composite look (subject lit differently from scene)
- Adding people, props, or major decorations not in IMAGE 2
- Concept art / painted look / 3D render aesthetic
- Watermarks, text, logos
${userHintBlock}
══════════════════════════════════════════════════════════
OUTPUT
══════════════════════════════════════════════════════════

Output ONE photograph. Looks like the model was actually photographed
on location at IMAGE 2's venue.
`;
}
