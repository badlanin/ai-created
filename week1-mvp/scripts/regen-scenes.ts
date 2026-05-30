/**
 * scripts/regen-scenes.ts
 *
 * 一次性脚本：用 Gemini Pro Image 4K 重新生成 25 张场景 plate（10 single + 15 poster），
 * 输出到 seed-assets/scenes-v4-output/{single|poster}/{slug}.png（不直接覆盖原文件）。
 *
 * 用法（在 week1-mvp/ 下跑）：
 *   1. 确保 GCP_PROJECT_ID 已设置（用 Vertex），或 GEMINI_API_KEY 已设置（用 Gemini API）
 *      Vertex 还需要 ADC：gcloud auth application-default login（一次即可）
 *   2. 把 .env.example 复制成 .env 并填好（脚本会自动读取）
 *   3. 跑：npx tsx scripts/regen-scenes.ts
 *      - 默认并发 3
 *      - 已存在的输出会跳过（删掉某张可触发重跑该张）
 *      - 单张生成约 30-60 秒，全部跑完 5-10 分钟
 *      - 成本：25 × ¥1.7 ≈ ¥42.5
 *   4. 完成后人工 review seed-assets/scenes-v4-output/，
 *      不满意的删掉再 npx tsx scripts/regen-scenes.ts 自动补
 */

import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";

// ─────────────────────────────────────────────────────────
// 代理（GFW 兜底）—— Node 自带 fetch 用的是内置 undici，
// 跟 npm 装的 undici 不是同一个实例，setGlobalDispatcher 无效
// 直接把 globalThis.fetch 替换为 undici.fetch + ProxyAgent
// ─────────────────────────────────────────────────────────
async function setupProxy() {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (!proxyUrl) {
    console.log("[proxy] 未检测到 HTTPS_PROXY / HTTP_PROXY，直连");
    return;
  }
  try {
    const undici = await import("undici");
    const dispatcher = new undici.ProxyAgent(proxyUrl);
    // 强行替换 globalThis.fetch
    const origFetch = undici.fetch;
    (globalThis as unknown as { fetch: typeof origFetch }).fetch = ((
      input: Parameters<typeof origFetch>[0],
      init?: Parameters<typeof origFetch>[1],
    ) => origFetch(input, { ...(init || {}), dispatcher })) as typeof origFetch;
    // 同时 setGlobalDispatcher（给可能直接用 undici 的库用）
    undici.setGlobalDispatcher(dispatcher);
    console.log(`[proxy] 走代理: ${proxyUrl}（已替换 globalThis.fetch）`);

    // 自检：试一下能不能通
    try {
      const res = await (globalThis.fetch as typeof origFetch)(
        "https://generativelanguage.googleapis.com/v1beta/models",
      );
      console.log(`[proxy] 自检 → HTTP ${res.status}（200/403/401 都算通）`);
    } catch (e) {
      console.error(
        "[proxy] 自检失败：",
        e instanceof Error ? `${e.message} | cause: ${(e as Error & { cause?: unknown }).cause}` : e,
      );
    }
  } catch (e) {
    console.warn(
      "[proxy] 想走代理但加载 undici 失败：",
      e instanceof Error ? e.message : e,
    );
  }
}

// ─────────────────────────────────────────────────────────
// 0. 加载 .env / .env.local（无 dotenv 依赖，简单 parser）
// ─────────────────────────────────────────────────────────
function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv(path.resolve(process.cwd(), ".env"));
loadEnv(path.resolve(process.cwd(), ".env.local"));

// ─────────────────────────────────────────────────────────
// 1. 客户端
// ─────────────────────────────────────────────────────────
function buildClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (apiKey) {
    console.log("[client] 用 Gemini API key 模式");
    return new GoogleGenAI({ apiKey });
  }
  const project = process.env.GCP_PROJECT_ID?.trim();
  const location = process.env.GCP_LOCATION?.trim() || "asia-southeast1";
  if (!project) {
    throw new Error(
      "需要 GEMINI_API_KEY 或 GCP_PROJECT_ID 之一。\n" +
        "用 Vertex 还需要先跑：gcloud auth application-default login",
    );
  }
  console.log(`[client] 用 Vertex AI: project=${project} location=${location}`);
  return new GoogleGenAI({ vertexai: true, project, location });
}

// ─────────────────────────────────────────────────────────
// 2. Prompt 模板
// ─────────────────────────────────────────────────────────
const COMMON_RULES = `
PHOTOGRAPHY GOAL
This image will later have AI-composited fashion models placed inside it.
You are generating an EMPTY scene plate — NO people, NO models, NO human figures of any kind.
The plate must be photorealistic and look like a still frame from a high-end fashion editorial location scout.

ABSOLUTE EXCLUSIONS — never include any of these:
- People, models, mannequins, human silhouettes, body parts
- Text, signs, brand identifiers, modern logos, license plates
- Cars, electronics, screens, contemporary clutter
- Watermarks
- Strong harsh midday sunlight, hard contrast shadows
- Wide-angle lens distortion, fisheye effects, panoramic stitching look
- Sweeping vistas, full architectural establishing shots, full-building views

VISUAL QUALITY
- Photorealistic, magazine-editorial quality
- Natural color grading
- Subtle natural film grain acceptable
- Tack-sharp on the anchor zone, soft cream bokeh elsewhere
- 4K resolution, ready for print
`;

const SINGLE_RULES = `
FRAMING (this is for a single-person shot)
- Vertical 3:4 composition
- Show ONLY a small local section of the location — a tight intimate fragment
- Behind a hypothetical standing figure: no panorama, no full corridor view, no full building view
- 85mm portrait telephoto lens feel, NOT wide-angle
- Eye-level perspective
- Leave a clear "anchor zone" in the lower-third where ONE adult can stand naturally
- The anchor zone should contain a tangible object (a column base, a railing, a wall corner,
  a planter, a stool, a doorway) that suggests a leaning / standing pose

DEPTH OF FIELD
- Shallow DOF (f/2.0–f/2.8 feel)
- Anchor zone tack-sharp
- Background recedes into smooth creamy bokeh, color blocks not crisp detail
`;

const POSTER_RULES = `
FRAMING (this is for a 3-4 person group shot)
- Show only a defined SECTION of the location — enough comfortable room for 3-4 adults
  to stand naturally side by side, NOT 6-7
- NOT a full establishing shot, NOT a sweeping vista
- 50mm "natural" lens feel, NOT ultra-wide
- Eye-level or very slightly elevated
- Leave a clear "anchor zone" in the lower half: a defined patch of ground / floor /
  path / stone / lawn where 3-4 figures can be arranged naturally (not in rigid line)

DEPTH OF FIELD
- Moderate shallow DOF (f/3.5–f/5.6 feel)
- The group plane (anchor zone depth) stays sharp
- Background details soften but remain recognizable
- No extreme bokeh
`;

function buildPrompt(args: {
  rules: string;
  environment: string;
  anchor: string;
  lighting: string;
}): string {
  return [
    COMMON_RULES,
    args.rules,
    `\nENVIRONMENT\n${args.environment}`,
    `\nANCHOR\n${args.anchor}`,
    `\nLIGHTING\n${args.lighting}`,
    `\nFINAL\nGenerate the empty scene plate now. Photorealistic, magazine-editorial quality. NO people.`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────
// 3. 25 张 plate 定义
// ─────────────────────────────────────────────────────────
type Entry = {
  slug: string; // 输出文件名（无扩展名）
  usage: "single" | "poster";
  name: string; // 中文名（对照 manifest）
  aspectRatio: "3:4" | "4:3";
  environment: string;
  anchor: string;
  lighting: string;
};

const ENTRIES: Entry[] = [
  // ===== SINGLE 10 张 =====
  {
    slug: "scene_single_studio_arch_window_01",
    usage: "single",
    name: "拱窗白棚",
    aspectRatio: "3:4",
    environment:
      "An indoor studio set: a single tall arched gothic window built into a soft chalky-white wall with subtle paint texture. The window has slim black mullions in a delicate Y-tracery pattern. Just a portion of the wall around the window — no full studio reveal.",
    anchor:
      "The base of the arched window with a slim black wrought-iron stool placed slightly off-center, suggesting a place to sit or lean.",
    lighting:
      "Soft cool morning daylight diffusing through the window, slightly silvery, indirect, like an overcast sky bouncing in. Gentle shadow gradients on the wall.",
  },
  {
    slug: "scene_single_indoor_wood_ivy_01",
    usage: "single",
    name: "暖木板墙",
    aspectRatio: "3:4",
    environment:
      "A close section of a vertical-plank honey-toned wood wall, lightly weathered with visible grain. A single strand of fresh green ivy trails down from the upper-right corner. A narrow vintage console table sits against the wall on one side.",
    anchor:
      "The vintage console table at the edge of frame with a small ceramic vase, suggesting a place to lean or stand near.",
    lighting:
      "Warm late-afternoon golden sunlight from an unseen window at frame edge, casting a soft directional glow across the wood grain.",
  },
  {
    slug: "scene_single_indoor_studio_window_01",
    usage: "single",
    name: "木屋画室",
    aspectRatio: "3:4",
    environment:
      "Inside a wooden cabin painter's studio: a corner showing a portion of a tall industrial-style window with thin black grids letting cool light in, a wooden easel with a blank canvas partially visible at frame edge, raw timber wall panels.",
    anchor:
      "The easel and canvas edge, with bare wooden floor in front, suggesting a place to stand beside it.",
    lighting:
      "Cool diffuse north-facing artist's light from the window, soft silver, with neutral indoor shadows.",
  },
  {
    slug: "scene_single_indoor_vintage_drape_01",
    usage: "single",
    name: "复古叶纹墙",
    aspectRatio: "3:4",
    environment:
      "A tight section of a vintage interior wall covered in muted celadon-and-cream botanical leaf-pattern wallpaper. A peach silk drape softly frames the right edge of the frame, gathered loosely. A small antique side table with a brass lamp sits near the wall.",
    anchor:
      "The antique side table and brass lamp area in the lower-right, with the drape edge nearby for leaning.",
    lighting:
      "Warm tungsten lamp glow mixing with cool soft window light from out of frame, creating a rich vintage mood with gentle gradient.",
  },
  {
    slug: "scene_single_outdoor_colonnade_01",
    usage: "single",
    name: "古典柱廊",
    aspectRatio: "3:4",
    environment:
      "A close-up of ONE single weathered Doric limestone column shaft and its base, photographed from a tight side angle. A few stone floor tiles visible at base. Hint of one more column far behind, completely soft and out of focus.",
    anchor:
      "The column base itself, large and substantial in the lower portion of the frame, perfect for leaning against.",
    lighting:
      "Warm late afternoon golden hour light grazing the column from one side, long soft shadows on the floor tile, golden patina on the stone.",
  },
  {
    slug: "scene_single_outdoor_italian_steps_01",
    usage: "single",
    name: "意式石阶",
    aspectRatio: "3:4",
    environment:
      "A small section of an Italian-style stone staircase: a few warm-ochre travertine steps, a baluster railing on one side with classical urn-shaped balusters, a terracotta planter with a Mediterranean shrub at one corner.",
    anchor:
      "The baluster railing and the terracotta planter together, suggesting a leaning or seated pose by the steps.",
    lighting:
      "Tuscan golden hour, warm honey light directional from the side, soft but distinct shadows on the stone.",
  },
  {
    slug: "scene_single_outdoor_oakfence_01",
    usage: "single",
    name: "木栅栏树荫",
    aspectRatio: "3:4",
    environment:
      "A weathered country wooden picket fence section under tree shade, soft grass at base, a flowering shrub partially visible at one edge. Trees and meadow far behind, completely soft.",
    anchor:
      "The fence post itself, with wildflowers (cosmos, daisies) clustered at its base, suggesting a leaning pose.",
    lighting:
      "Late afternoon dappled golden sunlight through unseen leaves overhead, soft warm-tinted highlights, mottled shade.",
  },
  {
    slug: "scene_single_outdoor_manor_01",
    usage: "single",
    name: "英式庄园前庭",
    aspectRatio: "3:4",
    environment:
      "A tight section of a stone manor wall heavily covered in climbing ivy, with ONE shutter window visible (closed, dark forest-green shutters), a stone planter with herbs at the wall base. NOT the whole manor — just a single wall corner. A bit of gravel path visible at bottom.",
    anchor:
      "The stone planter and the wall corner area near the shutter window, suggesting a place to lean by the wall.",
    lighting:
      "Soft warm evening sun grazing the ivy, golden Mediterranean glow, gentle directional shadows.",
  },
  {
    slug: "scene_single_outdoor_barn_boho_01",
    usage: "single",
    name: "谷仓波西米亚",
    aspectRatio: "3:4",
    environment:
      "A weathered grey-brown barn wall section with rough-hewn vertical wood planks, an old metal latch on a closed barn door visible. A galvanized metal bucket holds sprays of wildflowers (cosmos, daisies, eucalyptus) beside the door.",
    anchor:
      "The barn door with metal latch and the bucket of wildflowers, suggesting a leaning or standing pose by the door.",
    lighting:
      "Late afternoon golden sun, dusty warm tones, slight haze in the air, gentle long shadows from the wood planks.",
  },
  {
    slug: "scene_single_outdoor_ceremony_night_01",
    usage: "single",
    name: "仪式光廊",
    aspectRatio: "3:4",
    environment:
      "An intimate close-up of an outdoor twilight wedding venue: warm bistro string-lights overhead in soft focus bokeh dots, a single elegant wooden post or chair in the lower frame, edge of a draped chiffon panel at one side. Background goes into deep dusk-blue softness.",
    anchor:
      "The wooden post or chair in lower-third, with the draped fabric panel edge nearby, suggesting a place to stand or lean.",
    lighting:
      "Twilight blue ambient + warm tungsten glow from the string lights, romantic dreamy mood, slight magical haze.",
  },

  // ===== POSTER 15 张 =====
  {
    slug: "scene_poster_outdoor_tropical_01",
    usage: "poster",
    name: "热带花园",
    aspectRatio: "3:4",
    environment:
      "A small clearing in a tropical garden: large banana and palm leaves arching at the upper frame edges (forming a natural canopy frame), a defined patch of grass/stone path at the lower portion. Tropical foliage continues into soft focus behind. A glimpse of warm sky barely visible through leaves at the top.",
    anchor:
      "The grass/stone path patch in the lower-center area, big enough for 3-4 adults to stand naturally.",
    lighting:
      "Bright tropical light filtered through overhead leaves, warm but soft, dappled glints on foliage.",
  },
  {
    slug: "scene_poster_garden_hydrangea_01",
    usage: "poster",
    name: "绣球花园",
    aspectRatio: "3:4",
    environment:
      "A defined corner of a hydrangea garden: a hedge wall of full hydrangea blooms in soft powder-blue and pale-pink fills the upper background. A narrow stone bench or path edge runs across the lower portion. No wider garden visible.",
    anchor:
      "The path or bench area in the lower portion, hosting 3-4 figures.",
    lighting:
      "Soft diffuse summer overcast light, dreamy and even, no harsh shadows.",
  },
  {
    slug: "scene_poster_studio_cottage_01",
    usage: "poster",
    name: "童话小屋",
    aspectRatio: "3:4",
    environment:
      "A studio set styled like a fairytale cottage exterior: ONE mustard-yellow stucco wall section with a small arched window with pale blue trim, a small flower box with daisies under the window, a simple wreath hanging beside (without any text). Painted backdrop suggesting more cottage softly out of frame.",
    anchor:
      "The space directly in front of the wall, on a soft simulated grass or stone surface, hosting 3-4 figures.",
    lighting:
      "Studio key light mimicking warm afternoon sun, soft fill, slightly storybook in mood.",
  },
  {
    slug: "scene_poster_outdoor_chateau_01",
    usage: "poster",
    name: "常春藤古堡",
    aspectRatio: "3:4",
    environment:
      "A section of a French chateau wall: weathered limestone with extensive ivy coverage on one wall portion, ONE tall shuttered window with pale blue-grey shutters visible. A gravel terrace with a few potted boxwood at the base. Not the whole chateau — just a wall corner.",
    anchor:
      "The gravel terrace area in front of the wall, hosting 3-4 figures.",
    lighting:
      "Late afternoon golden hour, warm light grazing the ivy, gentle long shadows.",
  },
  {
    slug: "scene_poster_outdoor_lakeshore_01",
    usage: "poster",
    name: "湖滨礁石",
    aspectRatio: "4:3",
    environment:
      "A small intimate lakeshore vignette: large smooth rounded boulders at the water's edge, a strip of pebbled shore in the foreground, calm water reflecting the sky beyond, a distant tree line softened. Sky just visible at the top edge in pale dawn or morning blue.",
    anchor:
      "The pebbled shore strip in the lower foreground, hosting 3-4 figures.",
    lighting:
      "Soft early-morning natural light, calm reflections on water, slightly hazy.",
  },
  {
    slug: "scene_poster_garden_fountain_01",
    usage: "poster",
    name: "意式庭院",
    aspectRatio: "3:4",
    environment:
      "A defined section of an Italian formal garden: ONE tier of a stone fountain at a corner of the frame, two slim cypress columns flanking, a gravel path with low boxwood hedges. Not the whole garden, just a corner.",
    anchor:
      "The gravel path beside the fountain, hosting 3-4 figures.",
    lighting:
      "Tuscan golden hour, warm Mediterranean light, soft long shadows.",
  },
  {
    slug: "scene_poster_indoor_palazzo_01",
    usage: "poster",
    name: "文艺复兴宫殿厅",
    aspectRatio: "3:4",
    environment:
      "A defined corner inside a Renaissance palazzo: ONE wall section with a fragment of Renaissance fresco, a portion of patterned marble floor, an ornate carved console table with a soft floral arrangement, edge of a heavy velvet drape framing one side.",
    anchor:
      "The marble floor area in front of the fresco fragment, hosting 3-4 figures.",
    lighting:
      "Warm interior, soft window light from frame edge, candlelight glow accents on the table, rich painterly mood.",
  },
  {
    slug: "scene_poster_outdoor_cocktail_01",
    usage: "poster",
    name: "草坪鸡尾酒会",
    aspectRatio: "4:3",
    environment:
      "A defined area of an outdoor cocktail reception lawn: a section of manicured grass, a few hanging lanterns or string lights overhead in soft bokeh, edge of a high cocktail table with floral centerpiece, dusk sky behind. Garden softness in distance.",
    anchor:
      "The lawn space around and beside the cocktail table, hosting 3-4 figures.",
    lighting:
      "Late afternoon golden hour fading into early dusk, warm overall, lanterns just starting to glow.",
  },
  {
    slug: "scene_poster_outdoor_civic_01",
    usage: "poster",
    name: "古典石质拱门",
    aspectRatio: "3:4",
    environment:
      "A single classical stone archway centered in the frame, weathered limestone with warm patina, soft greenery and out-of-focus garden visible through the arch, stone tile floor below.",
    anchor:
      "The space framed by the archway on the stone floor, hosting 3-4 figures.",
    lighting:
      "Soft natural daylight, gently warm, balanced soft shadows.",
  },
  {
    slug: "scene_poster_outdoor_victorian_01",
    usage: "poster",
    name: "南方维多利亚住宅",
    aspectRatio: "3:4",
    environment:
      "A section of a white Victorian Southern-style porch: 2-3 fluted white columns, white painted wooden railing, a fern in a wicker pot, fragment of a paneled front door visible. Just the porch corner, not the whole house.",
    anchor:
      "The porch floor between the columns, hosting 3-4 figures.",
    lighting:
      "Warm late afternoon, dappled with porch shade, southern golden tones.",
  },
  {
    slug: "scene_poster_garden_arch_01",
    usage: "poster",
    name: "白玫瑰仪式拱门",
    aspectRatio: "3:4",
    environment:
      "A wedding ceremony arch overflowing with white roses, eucalyptus, and pale greenery, set on a soft grass aisle. Just the arch and immediate aisle. No wider ceremony grounds visible.",
    anchor:
      "The aisle on the grass beneath and just in front of the arch, hosting 3-4 figures.",
    lighting:
      "Soft golden hour, romantic dreamy quality, gentle warmth on the white roses.",
  },
  {
    slug: "scene_poster_garden_bougainvillea_01",
    usage: "poster",
    name: "三角梅花墙",
    aspectRatio: "3:4",
    environment:
      "A wall draped in cascading bougainvillea blossoms in fuchsia pink and magenta against a warm-cream stucco wall, a strip of cobblestone or terracotta path at the base.",
    anchor:
      "The path strip in front of the wall, hosting 3-4 figures.",
    lighting:
      "Mediterranean afternoon sun, vibrant warm light, soft shadows.",
  },
  {
    slug: "scene_poster_garden_dinner_01",
    usage: "poster",
    name: "花园晚宴长桌",
    aspectRatio: "4:3",
    environment:
      "A defined section of a long outdoor dinner table set up in a garden at dusk: linen runner, soft floral arrangements, votive candles lit, glasses, the backs of a few chairs hinted at edges. Garden softness behind.",
    anchor:
      "The space alongside or behind the table, hosting 3-4 figures.",
    lighting:
      "Magic hour with warm candle glow accents, romantic dusk mood, deep blue sky just starting.",
  },
  {
    slug: "scene_poster_indoor_fireplace_01",
    usage: "poster",
    name: "法式乡村壁炉",
    aspectRatio: "3:4",
    environment:
      "A defined area in a French country interior: a stone fireplace with a flickering fire, the mantle decorated with simple foliage and candles, an exposed wooden ceiling beam visible, a rustic wood-plank floor in front.",
    anchor:
      "The wood-plank floor area directly in front of the fireplace, hosting 3-4 figures.",
    lighting:
      "Warm firelight + candle glow + soft window light from out of frame, deep cozy interior mood.",
  },
  {
    slug: "scene_poster_garden_stepping_01",
    usage: "poster",
    name: "石板小径花园",
    aspectRatio: "3:4",
    environment:
      "A defined section of a garden with a stone-slab path leading toward a small wrought-iron tea table with two empty chairs (no people), surrounded by low planted borders and lavender. Garden softness in background.",
    anchor:
      "The space around the tea table on the stone-slab path, hosting 3-4 figures.",
    lighting:
      "Soft afternoon sun, dappled, English-garden light quality.",
  },
];

// 自检：必须 25 张
if (ENTRIES.length !== 25) {
  console.error(`[entries] 期望 25 张，实际 ${ENTRIES.length} 张`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────
// 4. 调 Gemini Pro Image 4K
// ─────────────────────────────────────────────────────────
const MODEL = "gemini-3-pro-image-preview";
const CALL_TIMEOUT_MS = 580_000;

async function generateOne(
  ai: GoogleGenAI,
  entry: Entry,
): Promise<Buffer> {
  const rules = entry.usage === "single" ? SINGLE_RULES : POSTER_RULES;
  const prompt = buildPrompt({
    rules,
    environment: entry.environment,
    anchor: entry.anchor,
    lighting: entry.lighting,
  });

  const callPromise = ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: ["IMAGE", "TEXT"],
      temperature: 0.5,
      thinkingConfig: { thinkingBudget: 2048 },
      imageConfig: {
        aspectRatio: entry.aspectRatio,
        imageSize: "4K",
      },
    } as Record<string, unknown>,
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`生成 ${entry.slug} 超时`)), CALL_TIMEOUT_MS);
  });

  const response = await Promise.race([callPromise, timeoutPromise]);

  const candidates = response.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("无候选返回，可能被安全策略拦截");
  }
  for (const cand of candidates) {
    const parts = cand.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return Buffer.from(part.inlineData.data, "base64");
      }
    }
  }
  throw new Error("候选里无 inlineData 图片");
}

// ─────────────────────────────────────────────────────────
// 5. 主流程
// ─────────────────────────────────────────────────────────
const OUTPUT_DIR = path.resolve(
  process.cwd(),
  "seed-assets/scenes-v4-output",
);

async function processEntry(
  ai: GoogleGenAI,
  entry: Entry,
  idx: number,
): Promise<{ ok: boolean; skipped?: boolean; err?: string }> {
  const subDir = path.join(OUTPUT_DIR, entry.usage);
  fs.mkdirSync(subDir, { recursive: true });
  const outPath = path.join(subDir, `${entry.slug}.png`);

  if (fs.existsSync(outPath)) {
    console.log(`[${idx + 1}/25] SKIP（已存在）${entry.slug}`);
    return { ok: true, skipped: true };
  }

  console.log(`[${idx + 1}/25] START ${entry.slug} (${entry.usage}, ${entry.aspectRatio})`);
  const t0 = Date.now();
  try {
    const buf = await generateOne(ai, entry);
    fs.writeFileSync(outPath, buf);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `[${idx + 1}/25] OK ${entry.slug} → ${(buf.length / 1024).toFixed(0)} KB · ${dt}s`,
    );
    return { ok: true };
  } catch (e) {
    const err = e as Error & { cause?: unknown };
    const msg = err?.message || String(e);
    const cause = err?.cause
      ? ` | cause: ${(err.cause as Error)?.message ?? err.cause}`
      : "";
    console.error(`[${idx + 1}/25] FAIL ${entry.slug} → ${msg}${cause}`);
    return { ok: false, err: msg + cause };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    next(),
  );
  await Promise.all(runners);
  return results;
}

async function main() {
  console.log("===== regen-scenes 启动 =====");
  console.log(`输出目录: ${OUTPUT_DIR}`);
  console.log(`计划生成 ${ENTRIES.length} 张（${ENTRIES.filter(e => e.usage === "single").length} single + ${ENTRIES.filter(e => e.usage === "poster").length} poster）`);
  console.log(`模型: ${MODEL} · 4K`);

  await setupProxy();
  console.log("");

  const ai = buildClient();

  const t0 = Date.now();
  const results = await runWithConcurrency(ENTRIES, 3, (e, i) =>
    processEntry(ai, e, i),
  );
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  const okCount = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok);

  console.log(`\n===== 完成 ${dt}s =====`);
  console.log(`新生成: ${okCount}`);
  console.log(`跳过（已存在）: ${skipped}`);
  console.log(`失败: ${failed.length}`);
  if (failed.length) {
    console.log("\n失败列表（重跑会自动补这些）：");
    for (const r of failed) {
      console.log(`  - ${r.err}`);
    }
  }
  console.log(`\n请去 ${OUTPUT_DIR} 一张张 review，不满意的删掉再 npx tsx scripts/regen-scenes.ts。`);
}

main().catch((err) => {
  console.error("脚本崩溃：", err);
  process.exit(1);
});
