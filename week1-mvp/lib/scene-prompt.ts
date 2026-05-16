/**
 * Scene Tools — 服饰场景图（统一工具）· v3 加焦点开关 + 特写 + 材质词库
 *
 *   产品图（含模特+服装）+ 场景描述 → 把模特放到该场景里重新拍
 *
 * 场景有两种描述方式：
 *   1. 文字场景（free text）—— 模型自由发挥取景 / 光线 / 构图
 *   2. 图片场景（plate）—— 模型把 plate 当氛围参考
 *
 * v3（2026-05）：
 *   - 接 FocusMode 开关（model_first 默认，balanced，environmental）
 *   - 接 closeup 镜头预设（5 套）
 *   - 接材质词库（lib/materials.ts → formatMaterialDetails）
 *   - 加"同一场景多变体背景一致"约束
 */

import {
  buildFramingBlock,
  type FocusMode,
  type CloseupKey,
} from "./scene-tools-prompt";

export interface SceneShootOpts {
  sceneText?: string;
  userHint?: string;
  focusMode?: FocusMode;
  kind?: "regular" | "closeup";
  variantIdx?: number;
  variantTotal?: number;
  closeupKey?: CloseupKey;
  materialDetailsText?: string;
  sceneTotalItems?: number;
}

export function buildSceneShootText(
  sceneText: string,
  userHint?: string,
  opts: Omit<SceneShootOpts, "sceneText" | "userHint"> = {},
): string {
  const sceneClean = sceneText.trim();
  const userHintBlock = userHint?.trim()
    ? `\n══════════════════════════════════════════════════════════
👤 USER ADDITIONAL HINT
══════════════════════════════════════════════════════════

${userHint.trim()}\n`
    : "";

  const framingBlock = buildFramingBlock({
    focusMode: opts.focusMode ?? "model_first",
    kind: opts.kind ?? "regular",
    variantIdx: opts.variantIdx,
    variantTotal: opts.variantTotal,
    closeupKey: opts.closeupKey,
    materialDetailsText: opts.materialDetailsText,
  });

  const sceneConsistencyBlock =
    (opts.sceneTotalItems ?? 1) > 1
      ? `\n══════════════════════════════════════════════════════════
🎬 同场景多变体背景一致
══════════════════════════════════════════════════════════

本次提交在该场景下要出 ${opts.sceneTotalItems} 张图（含常规变体 + 特写镜头）。
这 ${opts.sceneTotalItems} 张必须是"同一地点、同一时段、同一光线方向"——
都来自同一次拍摄，不允许换日时段、换天气、换背景。\n`
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
- Body proportions must read as a real human at correct scale to
  anything visible in the scene.
- Edges of the subject lit organically by the scene's light, never
  a "cut-out / pasted-on" composite feel.

${framingBlock}
${sceneConsistencyBlock}
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

export function buildSceneShootImage(
  scenePlateName?: string,
  userHint?: string,
  opts: Omit<SceneShootOpts, "sceneText" | "userHint"> = {},
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

  const framingBlock = buildFramingBlock({
    focusMode: opts.focusMode ?? "model_first",
    kind: opts.kind ?? "regular",
    variantIdx: opts.variantIdx,
    variantTotal: opts.variantTotal,
    closeupKey: opts.closeupKey,
    materialDetailsText: opts.materialDetailsText,
  });

  const sceneConsistencyBlock =
    (opts.sceneTotalItems ?? 1) > 1
      ? `\n══════════════════════════════════════════════════════════
🎬 同场景多变体背景一致
══════════════════════════════════════════════════════════

本次提交在该场景下要出 ${opts.sceneTotalItems} 张图（含常规变体 + 特写镜头）。
这 ${opts.sceneTotalItems} 张必须是"同一地点、同一时段、同一光线方向"——
都来自 IMAGE 2 那个空间，常规变体取宽景，特写仅是镜头拉近 + 大光圈虚化背景，
绝不允许换天气、换日时段、换不同的房间。\n`
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

⚠️ IMPORTANT: Use IMAGE 2 only as "atmosphere / lighting / palette /
materials" reference. Do NOT replicate IMAGE 2's framing or subject
scale — even if IMAGE 2 shows a huge wide environment with tiny figures
or no figure at all, your output must follow the framing block below
(not IMAGE 2's framing).

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

${framingBlock}
${sceneConsistencyBlock}
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
