/**
 * Scene Tools — 服饰场景图（统一工具）
 *
 * 替代了之前的 5 个 scene-tools 子工具（background-swap / poster /
 * social-snap / replicate / text-shoot），收敛为单一工作流：
 *
 *   产品图（含模特+服装）+ 场景描述 → 把模特放到该场景里重新拍
 *
 * 场景有两种描述方式：
 *   1. 文字场景（free text）—— 模型自由发挥取景 / 光线 / 构图
 *   2. 图片场景（plate）—— 模型把 plate 当氛围参考，结合 FRAMING 段
 *
 * 出图按 N（产品图）× M（场景）笛卡尔积；每个 (i, j) item 是一张图。
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
🎬 THE SCENE (use this description; freedom in framing/light/composition)
══════════════════════════════════════════════════════════

${sceneClean}

══════════════════════════════════════════════════════════
✅ EXTRACT FROM IMAGE 1 (preserve identity, NOT pixel data)
══════════════════════════════════════════════════════════

KEEP exactly:
- Model's face: identity, features, hair color & style, skin tone, expression baseline
- Garment: color, fabric, fit, length, neckline, sleeves, patterns,
  embroidery, beads, lace, hems, ALL visible details
- Accessories visible on subject (jewelry, shoes)

❌ DO NOT preserve from IMAGE 1:
- Original background — completely gone
- Original lighting on subject — fully redone for the new scene
- Original pose — allowed to shift naturally for the new scene
- Original camera distance / framing — set fresh

══════════════════════════════════════════════════════════
🎬 RENDER FRESH
══════════════════════════════════════════════════════════

▸ POSE: natural for the described scene; small adjustments allowed
▸ LENS: 50-85mm portrait telephoto feel; NOT wide-angle distortion
▸ DEPTH OF FIELD: shallow-to-moderate (f/2.0–f/4.0); subject sharp,
  environment receding into atmospheric softness
▸ LIGHTING: 100% from the scene description — match color temperature,
  direction, time-of-day, mood. Re-light skin, garment, and shadows.
  Realistic ground/contact shadow at feet.
▸ BODY-TO-OBJECT SCALE: subject's body must read as a real human
  relative to anything in the scene. Avoid "tiny doll in giant scene".
▸ INTEGRATION: edges organically lit by scene's light; no "cut-out"
  silhouette feel.

══════════════════════════════════════════════════════════
❌ FORBIDDEN
══════════════════════════════════════════════════════════

- "Pasted-on" composite look
- Subject still studio-bright while scene is night/dim/golden
- Mechanical center-stage placement
- Modifying garment color, fabric, design, or details
- Swapping model's identity
- Concept art / painted look / 3D render aesthetic
- Watermarks, text, logos
- Returning IMAGE 1 with only minor edits
${userHintBlock}
══════════════════════════════════════════════════════════
OUTPUT
══════════════════════════════════════════════════════════

Output ONE photograph. Looks like a real fashion editorial shot taken
on location at the described scene.
`;
}

/**
 * 图片场景模式 prompt
 *
 * Inputs to model:
 *   IMAGE 1 = 产品图（含模特+服装+原背景）
 *   IMAGE 2 = scene plate（只作氛围/光线参考）
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
   (in some prior background — that background is to be DISCARDED).
▸ IMAGE 2 — A new venue / location scene plate.${sceneHint}

══════════════════════════════════════════════════════════
🚨 TASK — Generate a FRESH SHOOT at IMAGE 2's location
══════════════════════════════════════════════════════════

This is NOT pixel-paste editing. This is a brand-new photograph captured
on location at IMAGE 2's venue, using IMAGE 1 as "this is the model and
her dress" reference.

══════════════════════════════════════════════════════════
✅ EXTRACT FROM IMAGE 1 (preserve identity, NOT pixel data)
══════════════════════════════════════════════════════════

KEEP exactly:
- Model's face: identity, features, hair color & style, skin tone
- Garment: color, fabric, fit, length, neckline, sleeves, patterns,
  embroidery, beads, lace, hems, ALL visible details
- Accessories on subject (jewelry, shoes)

❌ DO NOT preserve from IMAGE 1:
- Original background — completely gone
- Original lighting — fully redone for IMAGE 2
- Original pose — allowed to shift naturally
- Original camera distance — set fresh

══════════════════════════════════════════════════════════
🎬 RENDER FRESH AT IMAGE 2
══════════════════════════════════════════════════════════

▸ POSE: natural for IMAGE 2's setting (lean / walk / stand)
▸ CAMERA: eye-level fashion editorial framing
▸ LIGHTING: 100% from IMAGE 2's natural light — match color temperature,
  direction, time-of-day. Re-light skin, garment, shadows.
▸ INTEGRATION: subject stands in IMAGE 2's natural ground area; soft
  anchored shadows at feet; edges organically lit by scene.

${FRAMING_TIGHT_SINGLE}

══════════════════════════════════════════════════════════
❌ FORBIDDEN
══════════════════════════════════════════════════════════

- "Pasted-on" composite look
- Subject lit differently from environment
- Mechanical center-stage placement
- Modifying garment color, fabric, design, or details
- Swapping model's identity
- Adding people, props, or decorations not in IMAGE 2
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
