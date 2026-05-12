/**
 * Scene Tools — Shared FRAMING block（v4 主图导向 + 镜头多样化 + 强一致性）
 *
 * 版本演进：
 *   v1: 强 anchor 倚靠 + 85mm 锁定（开放场景翻车）
 *   v2: 全放权（模型偏向"站中间不互动"的保守姿势）
 *   v3: 主动指令读场景物件互动（但多变体之间镜头 / 角度 / 焦距重复）
 *   v4 (2026-05)：实测多变体出图正面同焦距同角度太重复。
 *
 * v4 改造三件事：
 *   1. 一致性最高优先级提到顶部（脸 / 服装 / 光线在多变体间必须一致）
 *   2. 显式声明"这是商品主图"——主体是服装，要全身或 3/4 身，不要局部特写
 *   3. 多变体场景下强制镜头多样化：角度 / 朝向 / 距离 / 构图 / 动态状态都要变
 *
 * 变量名 FRAMING_TIGHT_SINGLE 历史遗留不动，避免到处改 import。
 */

export const FRAMING_TIGHT_SINGLE = `══════════════════════════════════════════════════════════
🔒 PRIORITY #1 — IDENTITY & GARMENT CONSISTENCY
══════════════════════════════════════════════════════════

These must NEVER change, regardless of pose / angle / variant:
- Model's face: identity, features, skin tone, makeup baseline
- Model's hair: color, length, style
- Garment: color, fabric, fit, length, neckline, sleeves, ALL details
  (the dress in IMAGE 1 is final — do NOT redesign to fit the scene)
- Lighting mood across variants (so multiple variants look like one
  cohesive photo shoot, not random unrelated photos)

══════════════════════════════════════════════════════════
📐 PRIORITY #2 — THIS IS A FASHION PRODUCT MAIN IMAGE
══════════════════════════════════════════════════════════

The output is a clothing product photo. The DRESS is the protagonist;
the scene is the backdrop. Therefore:

✅ ALWAYS frame to show the garment clearly:
   - Full-body shots OR 3/4-length shots (waist + dress visible)
   - Garment must occupy at least 50% of the vertical frame
   - Hem of the dress visible in most variants (not always cropped)

❌ AVOID main-image-killer crops:
   - NO extreme close-ups of face only / hand only / fabric detail only
   - NO crops above the waist that hide the silhouette of the dress
   - NO behind-the-back shots that hide the front of the garment
   - NO super-tight 50mm-macro detail shots

It is OK to have ONE variant that's a 3/4-body or "torso + waist + part
of skirt" shot, but the rest must show the full silhouette.

══════════════════════════════════════════════════════════
🎬 PRIORITY #3 — READ THE SCENE, INTERACT NATURALLY
══════════════════════════════════════════════════════════

Read IMAGE 2 (the scene). Mentally list the interactive objects visible:
furniture (chairs, sofas, benches, stairs, ottomans), surfaces (tables,
mantels, windowsills), architecture (doorframes, archways, columns,
railings, banisters, wall corners), props (cups, books, flowers, plants,
curtains).

For each generated variant, the model should naturally interact with
ONE or TWO of these objects — sitting / leaning / hand-on / mid-step /
holding — to break the "standing dead center" default.

══════════════════════════════════════════════════════════
🎥 PRIORITY #4 — MULTI-VARIANT CAMERA & POSE DIVERSITY
══════════════════════════════════════════════════════════

When the user requests MULTIPLE variants of the same scene
(variant N of M), each variant MUST differ across MULTIPLE dimensions,
not just "different interaction object". Pick a combination of:

▸ CAMERA ANGLE:
   - eye-level (default)
   - slight low-angle (camera at chest height, looking up)
   - slight high-angle (camera slightly above, looking down)
   - dynamic angle (35° tilt, dutch / casual editorial)

▸ BODY ORIENTATION (relative to camera):
   - frontal facing the lens
   - 3/4 turn (one shoulder forward)
   - full profile / side view
   - back with glance over shoulder
   - walking-by / moving away

▸ CAMERA DISTANCE:
   - full body (head to feet, with floor)
   - long full body (head to floor with some space above/below)
   - 3/4 body (knees up)
   - waist-up editorial (mid-thigh up, but ONLY for 1 of M variants)

▸ FRAMING POSITION (subject in frame):
   - centered
   - rule-of-thirds right
   - rule-of-thirds left
   - off-center with environment context

▸ DYNAMIC STATE:
   - still standing
   - mid-step / walking
   - turning / pivoting
   - sitting / leaning / resting

▸ FOCAL LENGTH FEEL:
   - 50mm natural perspective
   - 85mm portrait compression
   - 35mm slight wide for editorial environment context

For variant N out of M total, pick a combination that is OBVIOUSLY
DIFFERENT from a "1/M standing centered frontal eye-level full body
85mm" baseline. Across M variants, span at least 3 different camera
angles and 3 different body orientations.

══════════════════════════════════════════════════════════
🔒 HARD CONSTRAINTS
══════════════════════════════════════════════════════════

- Body proportions read as real human at correct scale (chair ~85cm
  tall, doorway ~210cm, table ~75cm — body must agree)
- Lighting on subject matches scene's color temperature & direction
  (no "studio-lit subject pasted into dim scene")
- Subject is the SAME PERSON from IMAGE 1, garment is IDENTICAL
- Contact points must be physically believable (hand on table = real
  weight on the surface; sitting = body weight sunk into the seat)
`;

/**
 * 多变体镜头预设（5 套），按 variant idx 循环分配。
 *
 * 实测如果只让模型自己选"跟前一张不同的角度"，它出图还是偏向重复（同焦距同正面）。
 * 显式给每张变体钉死一个镜头基础设定，再让模型在该设定下自由发挥具体姿势 / 互动，
 * 出图差异性立刻拉开。
 *
 * 用法（route 里）：
 *   const cameraHint = getVariantCameraHint(variantIdx, variantTotal);
 *   const composedHint = [userHint, cameraHint, otherHint].filter(Boolean).join("\n");
 */
const VARIANT_CAMERA_PRESETS: string[] = [
  "镜头预设：眼平视角 · 正面朝向 · 居中构图 · 全身站姿（基准版）",
  "镜头预设：3/4 侧转身（一肩前倾） · 偏右三分构图 · 全身 · 一手倚靠场景里的物件（栏杆 / 门框 / 桌沿）",
  "镜头预设：侧面 profile · 偏左三分构图 · 长全身（含地面留白） · 走动中或刚停下的瞬间",
  "镜头预设：略低位仰拍（相机在胸口高度） · 居中 · 3/4 身（膝盖以上） · 半坐或斜倚",
  "镜头预设：略高位俯拍（相机微微高于人头） · 偏右 · 全身 · 转身回眸或背身侧首",
];

/**
 * 按 variant idx（1-based）拿对应的镜头预设描述。
 * 当 total <= 1 时返回空（单张不需要分镜头）。
 */
export function getVariantCameraHint(
  variantIdx: number,
  variantTotal: number,
): string {
  if (variantTotal <= 1) return "";
  const preset = VARIANT_CAMERA_PRESETS[
    (variantIdx - 1) % VARIANT_CAMERA_PRESETS.length
  ];
  return `本张是第 ${variantIdx}/${variantTotal} 张变体。${preset}。在这个镜头基础上让模特按场景物件自由互动（坐 / 倚 / 撑 / 拿 / 走），但镜头角度 / 朝向 / 距离 / 构图必须严格按上面预设走，不要回退到"正面眼平居中全身"基准。`;
}

