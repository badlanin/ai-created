# Identity Generation Prompt — v4

项目级标准：用 Gemini 3 Pro Image 生成"模特身份参考图"（identity）的 prompt 模板。

供 `lib/identity-prompt.ts` 拼装、`/api/identities/generate` 调用、admin
后台 `/admin/identity-generator` 页面驱动。

## 设计原则

经过 4 轮迭代（2026-05-04）调出来的版本，4 个分层优先级：

1. **PRIORITY 0 · 构图 / 衣物 / 背景**（硬约束，最高）
   - 全身入镜，头身比 1:7.5，无遮挡
   - 仅穿 nude bodysuit，无外衣 / 配饰 / 鞋
   - 纯白 seamless 背景（RGB 248,248,248）
2. **PRIORITY 1 · 解剖比例**
   - 头占图高 12-13%，腿占身高 47-50%
   - 反向语言抵消模型 runway 偏差
3. **PRIORITY 2 · 主体规格**（参数化部分）
   - ethnicity / age / hair color / hair style / body shape
4. **PRIORITY 3 · 皮肤微纹理**（100% 放大才看得到）
   - 颗粒、毛孔、T 区光泽 vs 哑光区
   - 卡粉沉淀（fine lines / 法令纹 / 嘴角）
   - ≤8 颗 0.3-0.8mm 微雀斑，无显眼斑点 / 痣

**关键反例语言**（为什么 prompt 这样写）：
- 删除所有 "Editorial / Vogue / Lookbook" → 防止模型做时装大片
- "If wearing anything besides bodysuit: WRONG, regenerate" → 硬规则比软描述强
- "Skin texture visible at 100% pixel zoom, NOT at primary view" → 防止特写

## 参数枚举

| 字段 | 取值 | 注入 prompt 时的描述（英文）|
|---|---|---|
| `ethnicity` | `east-asian` | East Asian (Chinese / Korean / Japanese mix), warm yellow-undertone medium skin |
| | `southeast-asian` | Southeast Asian (Filipino / Thai / Vietnamese mix), warm tan skin |
| | `south-asian` | South Asian (Indian / Pakistani / Bengali mix), warm medium-deep skin |
| | `european-fair` | Northern European (Scandinavian / British / German mix), fair skin with cool pink undertone |
| | `european-mediterranean` | Mediterranean European (Italian / Spanish / Greek mix), warm olive skin |
| | `african` | African / African American, deep tan-to-dark skin |
| | `latin-american` | Latin American (Mexican / Brazilian / Colombian mix), warm tan skin |
| | `middle-eastern` | Middle Eastern (Persian / Arab / Turkish mix), warm medium skin |
| | `mixed` | Mixed ethnic background, warm medium skin |
| `age` | `20-25` | 20-25 years old (young adult, fresh skin) |
| | `25-30` | 25-30 years old (young adult, mature features) |
| | `30-35` | 30-35 years old (visible expression lines, real skin texture) |
| | `35-40` | 35-40 years old (early signs of aging, more pronounced lines) |
| `hairColor` | `black` | jet black |
| | `dark-brown` | dark chestnut brown |
| | `brown` | medium brown |
| | `blonde-light` | light golden blonde |
| | `blonde-medium` | medium honey blonde |
| | `red` | natural auburn red |
| | `gray-silver` | natural salt-and-pepper gray |
| `hairStyle` | `long-straight` | long straight (mid-back length), parted center |
| | `long-wavy` | long natural waves (mid-back length), parted center, visible flyaways |
| | `medium-shoulder` | shoulder-length, slight inward curl |
| | `short-bob` | chin-length bob, sleek |
| | `updo-bun` | low bun at nape, hair pulled back smoothly |
| `bodyShape` | `slim` | slim athletic build (BMI ~19), narrow shoulders, slim hips |
| | `standard` | average healthy build (BMI ~22), balanced proportions |
| | `athletic` | athletic toned build (BMI ~22), defined shoulders and waist |
| | `curvy` | curvy hourglass build (BMI ~24), wider hips and bust |
| | `plus` | plus-size build (BMI ~28-30), full figure with proportional curves |
| | `maternity` | pregnancy 6-7 months, visible baby bump, otherwise standard build |
| | `teen` | teen build (15-17 yo equivalent), youthful proportions, smaller frame |

## 完整 Prompt 模板

下面是 `buildIdentityPrompt(params)` 的输出形态。变量用 `{{}}` 占位，
TS 函数里替换。

```text
═══════════════════════════════════════════════════════
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
- Subject wears ONLY a seamless nude/beige form-fitting bodysuit (Skims/Wolford
  basic style, scoop neck, high-cut leg, no patterns, no decorative stitching)
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
- Age: {{AGE_DESC}}
- Ethnicity: {{ETHNICITY_DESC}}
- Hair: {{HAIR_COLOR_DESC}}, {{HAIR_STYLE_DESC}}
- Eyes: {{EYE_COLOR_DESC}}, calm direct gaze, slight under-eye depth
  (real eye structure, not "dark circles")
- Face: oval shape with subtle natural asymmetry (1-2mm acceptable),
  natural eyebrows, medium-full lips
- Body: {{BODY_SHAPE_DESC}}

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
  - Sparse light freckles 0.3-0.8mm equivalent across nose bridge, cheekbones,
    shoulders — like dust scattered, easy to miss at first glance
  - Maximum 5-8 freckles total, ALL very small, NEVER clustered
  - NO single dark spot larger than 1mm
  - NO moles, NO beauty marks, NO distinct dark spots

▸ Hair:
  - Individual strands at all edges, visible flyaways
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
```

## 用法

### 在代码里

```ts
import { buildIdentityPrompt } from "@/lib/identity-prompt";
import { generateImage } from "@/lib/gemini-image";

const prompt = buildIdentityPrompt({
  ethnicity: "east-asian",
  age: "25-30",
  hairColor: "black",
  hairStyle: "long-straight",
  bodyShape: "standard",
});

const result = await generateImage(
  [], // 无参考图，纯文生图
  prompt,
  "gemini-3-pro-image-preview",
  { aspectRatio: "3:4", imageSize: "4K", temperature: 0.3 },
);
// result.data 是 Buffer，写盘即可
```

### 在 admin 页

`/admin/identity-generator` 页面驱动 → POST `/api/identities/generate`
（生成 + 暂存）→ 用户预览 → 满意 POST `/api/identities/commit`
（搬到 uploads/，写库）。

## 后续迭代点

- 如果某些 ethnicity 模型生成偏弱，单独给该 ethnicity 加额外锚词
- 如果 body shape 比例还是飘，考虑后续加 reference 图（few-shot）
- 不同 hair style 的"飞发量"可以单独控制（updo 不能有飞发；waves 应有大量）

## 版本

- v1（2026-05-04 初版）：含痣、未控构图，模型把脸弄得脏 → 弃
- v2（2026-05-04 中版）：去 Editorial 描述，加 PRIORITY 0 构图 → 衣物背景仍跑偏
- v3（2026-05-04 中版）：加硬规则 wardrobe + background → 出图能用
- v4（当前）：把 v3 工程化、参数化为 TS 函数
