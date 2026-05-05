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

// 占位：子功能 2 / 3 后续添加
// export function buildPosterPrompt(...) { ... }
// export function buildSocialSnapPrompt(...) { ... }
