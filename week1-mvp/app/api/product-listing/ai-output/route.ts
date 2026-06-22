import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { resolveModelId } from "@/lib/ai-models";
import { buildGenaiClient } from "@/lib/genai-client";
import { estimateImageCostUSD, generateImage } from "@/lib/image-gen";
import { assertWithinBudget } from "@/lib/pricing";
import { recordUsage } from "@/lib/usage";
import { DATA_DIR_PATH } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

const CALL_TIMEOUT_MS = 55_000;
const IMAGE_GEN_TIMEOUT_MS = 240_000;
const MAX_PRODUCT_LISTING_IMAGE_GENERATIONS = 6;

type ProductListingImageInput = {
  buffer: Buffer;
  mimeType: string;
};

type MediaInput = {
  url?: string;
  alt?: string | null;
  role?: string | null;
};

type ProductMetafieldDefinitionInput = {
  id: string;
  name: string;
  namespace: string;
  key: string;
  type: string;
};

type CategoryMetafieldCandidateKey =
  | "categoryColor"
  | "categorySize"
  | "categoryFabric"
  | "categoryAgeGroup"
  | "categoryOccasion"
  | "categoryDressStyle"
  | "categoryNeckline"
  | "categoryDressLengthType"
  | "categorySleeveLengthType"
  | "categoryTargetGender";

type CategoryMetafieldCandidates = Partial<
  Record<CategoryMetafieldCandidateKey, string[]>
>;

type ProductOrganizationCandidateKey =
  | "productTypes"
  | "vendors"
  | "collections"
  | "commonTags"
  | "tags";

type ProductOrganizationCandidates = Partial<
  Record<ProductOrganizationCandidateKey, string[]>
>;

type CustomsCandidates = {
  countries: string[];
  currentCountryCode: string;
  harmonizedSystemCode: string;
};

const CATEGORY_METAFIELD_CANDIDATE_LABELS: Array<{
  key: CategoryMetafieldCandidateKey;
  outputLabel: string;
  displayLabel: string;
}> = [
  {
    key: "categoryColor",
    outputLabel: "类别元字段颜色",
    displayLabel: "颜色",
  },
  {
    key: "categorySize",
    outputLabel: "类别元字段尺寸",
    displayLabel: "尺寸",
  },
  {
    key: "categoryFabric",
    outputLabel: "类别元字段织物",
    displayLabel: "织物",
  },
  {
    key: "categoryAgeGroup",
    outputLabel: "类别元字段年龄段",
    displayLabel: "年龄段",
  },
  {
    key: "categoryOccasion",
    outputLabel: "类别元字段穿着场合",
    displayLabel: "穿着场合",
  },
  {
    key: "categoryDressStyle",
    outputLabel: "类别元字段裙子风格",
    displayLabel: "裙子风格",
  },
  {
    key: "categoryNeckline",
    outputLabel: "类别元字段领口",
    displayLabel: "领口",
  },
  {
    key: "categoryDressLengthType",
    outputLabel: "类别元字段裙子/连衣裙长度类型",
    displayLabel: "裙子/连衣裙长度类型",
  },
  {
    key: "categorySleeveLengthType",
    outputLabel: "类别元字段袖长类型",
    displayLabel: "袖长类型",
  },
  {
    key: "categoryTargetGender",
    outputLabel: "类别元字段目标性别",
    displayLabel: "目标性别",
  },
];

const PRODUCT_ORGANIZATION_CANDIDATE_LABELS: Array<{
  key: ProductOrganizationCandidateKey;
  outputLabel: string;
  displayLabel: string;
}> = [
  { key: "productTypes", outputLabel: "产品类型", displayLabel: "产品类型" },
  { key: "vendors", outputLabel: "厂商/供应商", displayLabel: "厂商" },
  { key: "collections", outputLabel: "产品系列", displayLabel: "产品系列" },
  { key: "commonTags", outputLabel: "常用标记", displayLabel: "常用标记" },
  { key: "tags", outputLabel: "标记", displayLabel: "标记" },
];

const REQUIRED_OUTPUT_FIELD_ALIASES: Array<{
  label: string;
  aliases: string[];
}> = [
  { label: "商品标题", aliases: ["商品标题", "标题", "title"] },
  { label: "商品描述", aliases: ["商品描述", "描述", "description"] },
  { label: "产品类型", aliases: ["产品类型", "商品类型", "product type", "product_type"] },
  { label: "厂商", aliases: ["厂商", "供应商", "vendor"] },
  { label: "产品系列", aliases: ["产品系列", "商品系列", "系列", "collection", "collections"] },
  { label: "标记", aliases: ["标记", "标签", "tags", "tag"] },
  { label: "主色调", aliases: ["主色调", "颜色", "color"] },
  { label: "面料材质", aliases: ["面料材质", "材质", "material", "fabric"] },
  { label: "领口设计", aliases: ["领口设计", "领口", "neckline"] },
  { label: "整体版型", aliases: ["整体版型", "版型", "silhouette"] },
  { label: "SKU", aliases: ["sku"] },
  { label: "原价", aliases: ["原价", "划线价", "compare at price", "compare_at_price"] },
  { label: "售价", aliases: ["售价", "销售价", "价格", "price", "sale price"] },
  { label: "库存", aliases: ["库存", "inventory"] },
  { label: "产品重量", aliases: ["产品重量", "重量", "weight", "product weight"] },
  { label: "原产国家/地区", aliases: ["原产国家/地区", "原产国家", "原产地", "country of origin"] },
  { label: "HS 编码", aliases: ["HS 编码", "HS编码", "协调制度", "harmonized system", "harmonizedSystemCode"] },
  { label: "SEO标题", aliases: ["SEO标题", "SEO 标题", "seo title", "seoTitle"] },
  { label: "SEO描述", aliases: ["SEO描述", "SEO 描述", "seo description", "seoDescription"] },
];

const FULL_PRODUCT_OUTPUT_FIELDS = [
  "商品标题",
  "商品描述",
  "产品类型",
  "厂商",
  "产品系列",
  "标记",
  "主色调",
  "面料材质",
  "领口设计",
  "整体版型",
  "SKU",
  "原价",
  "售价",
  "库存",
  "SEO标题",
  "SEO描述",
];

const PRODUCT_LISTING_SYSTEM_PROMPT = `你是专业的 Shopify 礼服商品上架助手。
请根据用户提示词和商品图片，生成可直接用于 Shopify 商品页的信息。

输出要求：
- 必须以用户提供的商品图片为主要依据，优先识别图片中的颜色、面料、版型、领口、细节和商品风格。
- 只输出字段内容，不要 Markdown、代码块、解释、寒暄。
- 使用 key: value 格式，每个字段单独一行。
- 字段建议包含：商品标题、商品描述、产品类型、供应商、产品系列、标签、主色调、面料材质、领口设计、整体版型、SKU、原价、售价、库存、SEO标题、SEO描述。
- 用户提示词明确点名要求输出的字段必须逐项输出，不得省略；即使无法确定，也要保留字段名，值可以留空或使用保守值。
- 不要主动输出 Shopify 类别元字段；只有用户提示词明确要求输出类别元字段、元字段，或明确写出“类别元字段颜色/类别元字段尺寸”等完整类别元字段名时，才输出对应字段。
- 如果系统提供了 Shopify 产品自定义元字段定义，必须按定义名称逐项输出；这些字段与类别元字段相互独立。
- 如果用户提示词要求生成图片，不要在文字输出中编造图片 URL、/assets/outputs 路径、文件名或占位图；图片生成由系统另行处理。
- 字段名使用中文，字段值可按用户要求使用英文或中文；如果用户没有指定，商品标题、描述、标签和 SEO 信息优先使用英文。
- SEO描述必须控制在 150-160 个字符以内，字符数包含空格和标点符号。
- 不要编造图片中看不到的强细节；不确定的字段保持稳妥、商品化表达。
- 内容保持干净，去掉多余空格、乱码、无效控制字符。`;

export async function POST(req: NextRequest) {
  let user: { id: number; role: string } | null = null;
  let model = "unknown";
  try {
    user = await requireUser();
    assertWithinBudget(user.id, user.role);

    const body = (await req.json()) as {
      prompt?: string;
      media?: MediaInput[];
      shopifyCategory?: {
        id?: string;
        name?: string;
      };
      categoryMetafieldCandidates?: unknown;
      productMetafieldDefinitions?: unknown;
      productOrganizationCandidates?: unknown;
      customsCandidates?: unknown;
    };
    const prompt = sanitizeText(body.prompt || "");
    if (!prompt) {
      return NextResponse.json(
        { error: "请输入大模型提示词" },
        { status: 400 },
      );
    }

    model = resolveModelId("vision");
    const media = Array.isArray(body.media) ? body.media.slice(0, 8) : [];
    const warnings: string[] = [];
    const images = [];
    for (const item of media) {
      const loaded = await loadLocalAssetImage(item, warnings);
      if (loaded) images.push(loaded);
    }
    if (media.length === 0) {
      return NextResponse.json(
        { error: "请先在媒体 Media 中添加商品图片，再开始解析。" },
        { status: 400 },
      );
    }
    if (images.length === 0) {
      return NextResponse.json(
        {
          error:
            warnings[0] ||
            "媒体 Media 中没有可读取的本地图片，请重新上传或从历史记录加入图片。",
          warnings,
        },
        { status: 400 },
      );
    }

    const mediaSummary =
      media.length > 0
        ? media
            .map((item, index) => {
              const role = item.role ? ` / ${item.role}` : "";
              const alt = item.alt ? ` / ${item.alt}` : "";
              return `${index + 1}. ${item.url || "无 URL"}${role}${alt}`;
            })
            .join("\n")
        : "当前没有媒体图片，请只根据用户提示词整理可上架内容。";
    const categoryMetafieldCandidates = normalizeCategoryMetafieldCandidates(
      body.categoryMetafieldCandidates,
    );
    const productMetafieldDefinitions = normalizeProductMetafieldDefinitions(
      body.productMetafieldDefinitions,
    );
    const productOrganizationCandidates =
      normalizeProductOrganizationCandidates(
        body.productOrganizationCandidates,
      );
    const customsCandidates = normalizeCustomsCandidates(
      body.customsCandidates,
    );
    const shopifyCategoryName = sanitizeText(body.shopifyCategory?.name || "");
    const shopifyCategoryId = sanitizeText(body.shopifyCategory?.id || "");
    const shopifyCategorySummary =
      shopifyCategoryName || shopifyCategoryId
        ? `当前手动选择的 Shopify 类别：${shopifyCategoryName || "未命名"}${
            shopifyCategoryId ? `（${shopifyCategoryId}）` : ""
          }`
        : "当前未提供手动选择的 Shopify 类别。";
    const wantsCategoryMetafields = shouldGenerateCategoryMetafields(prompt);
    const categoryMetafieldCandidateSummary =
      wantsCategoryMetafields
        ? formatCategoryMetafieldCandidateSummary(categoryMetafieldCandidates)
        : "";
    const productOrganizationCandidateSummary =
      formatProductOrganizationCandidateSummary(productOrganizationCandidates);
    const customsCandidateSummary = formatCustomsCandidateSummary(
      customsCandidates,
    );
    const requiredOutputFieldInstruction =
      formatRequiredOutputFieldInstruction(prompt);
    const shouldGenerateImages = shouldGenerateProductListingImages(prompt);
    const productMetafieldInstruction = productMetafieldDefinitions.length
      ? `Shopify 产品自定义元字段（必须逐项生成，字段名必须原样输出）：
${productMetafieldDefinitions
  .map(
    (definition) =>
      `- ${definition.name}（${definition.namespace}.${definition.key}，类型 ${definition.type}）`,
  )
  .join("\n")}

产品自定义元字段生成规则：
- FAQ 开头的字段：生成一条买家最可能询问、且与当前商品直接相关的简洁问题。
- Answer 开头的字段：生成与对应 FAQ 序号匹配的清晰答案；只能依据图片、提示词和已生成商品信息，不确定的信息不要编造。
- 富文本字段仍输出普通纯文本，由系统在同步 Shopify 时转换为富文本结构。
- 每个字段单独一行，严格使用“定义名称: 内容”格式。`
      : "当前没有需要生成的 Shopify 产品自定义元字段。";

    const client = buildGenaiClient();
    const result = await withTimeout(
      client.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `用户提示词：
${prompt}

媒体 Media：
${mediaSummary}

${shopifyCategorySummary}

${productMetafieldInstruction}

Shopify 后台已有产品组织候选条目（按当前类别读取）：
${productOrganizationCandidateSummary}

Shopify 海关信息候选与当前值：
${customsCandidateSummary}

必填字段要求：
${requiredOutputFieldInstruction}

产品组织与海关信息生成规则：
- 产品类型、厂商/供应商、产品系列、标记：优先从上面的 Shopify 后台已有候选条目中选择最匹配的原文；明显不适合商品图片时，再根据商品内容保守生成。
- 标记可以输出多个，用逗号分隔；不要输出与商品无关的热门标记。
- 原产国家/地区：优先输出 Shopify CountryCode 两位代码，例如 CN、US；如果当前已有值且图片/提示词没有冲突，优先保留当前值。
- HS 编码：不要读取后台候选；根据商品类别、材质和用途生成纯数字 harmonizedSystemCode，至少 6 位；不确定时保持为空，不要编造解释文本。
- 如果输出这些字段，请使用字段名：产品类型、厂商、产品系列、标记、原产国家/地区、HS 编码。

${wantsCategoryMetafields ? `用户明确要求生成类别元字段。

当前手动选择类别下可用的 Shopify 类别元字段候选条目（仅包含 Shopify 官方/后台已读取条目）：
${categoryMetafieldCandidateSummary}

类别元字段生成规则：
- 只输出用户提示词要求的类别元字段；不要额外补充用户没有要求的类别元字段。
- 上面有候选条目的字段：先根据图片判断真实特征，再从该字段候选条目里选择最相似的一项，并尽量按候选条目的原文输出。
- 候选条目来自当前手动选择的 Shopify 类别，优先参考这些后台已有官方/自定义条目，不要自行更换商品类别。
- 上面没有候选条目的字段：直接根据图片生成。
- 候选条目明显都不适合图片时，可以输出图片判断值，但不要脱离图片。` : `用户没有要求生成类别元字段。
不要输出任何“类别元字段...”字段；只按用户提示词生成商品上架内容。`}

请严格根据以上 ${images.length} 张商品图片生成，不要脱离图片内容。`,
              },
              ...(shouldGenerateImages
                ? [
                    {
                      text: "用户提示词包含图片生成要求。文字解析阶段不要输出、编造或占位任何图片路径、图片 URL、/assets/outputs 文件名；只输出商品文字字段，真实图片由系统的图片生成模型单独生成。",
                    },
                  ]
                : []),
              ...images.map((image) => ({
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.buffer.toString("base64"),
                },
              })),
            ],
          },
        ],
        config: {
          systemInstruction: PRODUCT_LISTING_SYSTEM_PROMPT,
          temperature: 0.25,
        },
      }),
      CALL_TIMEOUT_MS,
    );

    const text = sanitizeText(result.text || "");
    if (!text) {
      throw new Error("大模型没有返回可用内容，请调整提示词后重试。");
    }

    const generatedImageUrls = shouldGenerateImages
      ? await generateProductListingImages({
          prompt,
          images,
          userId: user.id,
          warnings,
        })
      : [];
    const finalText = appendGeneratedImageUrls(text, generatedImageUrls);

    recordUsage({
      userId: user.id,
      model,
      feature: "other",
      usageMetadata: {
        promptTokenCount: result.usageMetadata?.promptTokenCount ?? 0,
        candidatesTokenCount: result.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokenCount: result.usageMetadata?.totalTokenCount ?? 0,
      },
      success: true,
      notes: {
        kind: "product-listing-ai-output",
        provider: "gemini",
        media_count: images.length,
        skipped_media_count: Math.max(0, media.length - images.length),
        category_metafields_requested: wantsCategoryMetafields,
        category_candidate_fields: wantsCategoryMetafields
          ? Object.keys(categoryMetafieldCandidates).length
          : 0,
        product_metafield_definition_count: productMetafieldDefinitions.length,
        image_generation_requested: shouldGenerateImages,
        generated_image_count: generatedImageUrls.length,
      },
    });

    return NextResponse.json({
      ok: true,
      text: finalText,
      cleanedText: finalText,
      model,
      imageCount: images.length,
      generatedImageCount: generatedImageUrls.length,
      warnings,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/product-listing/ai-output] 失败:", msg);
    if (user && status !== 429) {
      recordUsage({
        userId: user.id,
        model,
        feature: "other",
        success: false,
        error: msg,
        notes: { kind: "product-listing-ai-output", provider: "gemini" },
      });
    }
    return NextResponse.json({ error: msg }, { status });
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Gemini 解析超时，请稍后重试。")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withTimeoutMessage<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadLocalAssetImage(
  item: MediaInput,
  warnings: string[],
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const url = (item.url || "").trim();
  if (!url.startsWith("/assets/")) {
    if (url) warnings.push(`已跳过非本地媒体：${url}`);
    return null;
  }

  const cleanPath = decodeURIComponent(url.split("?")[0].slice("/assets/".length));
  const absPath = path.resolve(DATA_DIR_PATH, cleanPath);
  const dataRoot = path.resolve(DATA_DIR_PATH);
  if (!absPath.startsWith(dataRoot + path.sep)) {
    warnings.push(`已跳过非法媒体路径：${url}`);
    return null;
  }

  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) {
      warnings.push(`媒体不是文件：${url}`);
      return null;
    }
    return {
      buffer: await fs.readFile(absPath),
      mimeType: mimeFromPath(absPath),
    };
  } catch {
    warnings.push(`媒体文件不存在：${url}`);
    return null;
  }
}

function mimeFromPath(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function shouldGenerateProductListingImages(prompt: string): boolean {
  const text = prompt.toLowerCase();
  return (
    /(?:生成|制作|创建|输出|新增|补充)\s*(?:\d+|[一二两三四五六七八九十])?\s*张?\s*[^，。；;\n]{0,20}(?:图片|图像|照片|配图|主图|背景图|场景图|商品图|产品图)/.test(
      text,
    ) ||
    /(?:出图|作图|生图|生成图|生成照片|生成主图|生成背景图|生成场景图|生成商品图|生成产品图)/.test(
      text,
    ) ||
    /(?:图片|图像)生成(?:模型|功能)?(?:\s*(?:出|生成|制作|创建|新增|补充)?\s*(?:图片|图像|照片|配图|主图|背景图|场景图|商品图|产品图))/.test(
      text,
    ) ||
    /generate\s*(?:\d+\s*)?(?:images?|photos?|pictures?|renders?)/i.test(text)
  );
}

function parseRequestedImageCount(prompt: string): number {
  const normalized = prompt
    .replace(/一/g, "1")
    .replace(/二/g, "2")
    .replace(/两/g, "2")
    .replace(/三/g, "3")
    .replace(/四/g, "4")
    .replace(/五/g, "5")
    .replace(/六/g, "6")
    .replace(/七/g, "7")
    .replace(/八/g, "8")
    .replace(/九/g, "9")
    .replace(/十/g, "10");
  const match =
    normalized.match(/(\d+)\s*张\s*[^，。；;\n]{0,20}(?:图片|图像|照片|配图|主图|背景图|场景图|商品图|产品图)/) ||
    normalized.match(/(?:图片|图像|照片|配图|主图|背景图|场景图|商品图|产品图)\s*(\d+)\s*张/);
  const count = match ? Number(match[1]) : 1;
  if (!Number.isFinite(count)) return 1;
  return Math.min(MAX_PRODUCT_LISTING_IMAGE_GENERATIONS, Math.max(1, Math.floor(count)));
}

async function generateProductListingImages({
  prompt,
  images,
  userId,
  warnings,
}: {
  prompt: string;
  images: ProductListingImageInput[];
  userId: number;
  warnings: string[];
}): Promise<string[]> {
  const modelId = resolveModelId("image_gen");
  const count = parseRequestedImageCount(prompt);
  const outputsDir = path.join(DATA_DIR_PATH, "outputs");
  await fs.mkdir(outputsDir, { recursive: true });
  const urls: string[] = [];
  const seriesSeed = Math.floor(Math.random() * 1_000_000_000);
  let seriesReference: ProductListingImageInput | null = null;
  let consecutiveFailures = 0;

  for (let i = 0; i < count; i++) {
    try {
      const inputs: ProductListingImageInput[] = seriesReference
        ? [...images, seriesReference]
        : images;
      const result: Awaited<ReturnType<typeof generateImage>> =
        await withTimeoutMessage(
        generateImage({
          inputs,
          prompt: buildProductListingImagePrompt(
            prompt,
            i + 1,
            count,
            Boolean(seriesReference),
          ),
          modelId,
          aspectRatio: "3:4",
          imageSize: "1K",
          seed: seriesSeed,
          temperature: 0.18,
        }),
        IMAGE_GEN_TIMEOUT_MS,
        "图片生成超时，请减少生成数量或稍后重试。",
      );
      const ext = result.mimeType.includes("png")
        ? "png"
        : result.mimeType.includes("webp")
          ? "webp"
          : "jpg";
      const filename = `product_listing_${userId}_${Date.now()}_${i + 1}_${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      await fs.writeFile(path.join(outputsDir, filename), result.data);
      urls.push(`/assets/outputs/${filename}`);
      consecutiveFailures = 0;

      if (!seriesReference) {
        seriesReference = {
          buffer: result.data,
          mimeType: result.mimeType,
        };
      }

      recordUsage({
        userId,
        model: result.model || modelId,
        feature: "other",
        usageMetadata: {
          promptTokenCount: result.usage.inputTokens ?? 0,
          candidatesTokenCount: result.usage.outputTokens ?? 0,
          totalTokenCount: result.usage.totalTokens ?? 0,
        },
        costOverrideUsd:
          result.provider === "openai"
            ? estimateImageCostUSD({
                modelId,
                aspectRatio: "3:4",
                imageSize: "1K",
              })
            : undefined,
        success: true,
        notes: {
          kind: "product-listing-image-output",
          provider: result.provider,
          image_index: i + 1,
          image_count: count,
        },
      });
    } catch (e) {
      warnings.push(
        `图片生成失败（第 ${i + 1}/${count} 张）：${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      consecutiveFailures += 1;
      if (consecutiveFailures >= 2) break;
    }
  }

  return urls;
}

function buildProductListingImagePrompt(
  prompt: string,
  index: number,
  total: number,
  hasSeriesReference: boolean,
): string {
  return `你是专业的 Shopify 礼服商品摄影生成模型。
请根据用户提示词和输入的商品媒体参考图生成商品上架图片。

用户提示词：
${prompt}

生成要求：
- 这是第 ${index}/${total} 张图片，请保持商品服装与参考图一致。
- 本张拍摄角度：${getProductListingAngleInstruction(index, total)}
- 同一批次所有图片必须使用同一个背景、同一场景、同一光线、同一色调和同一摄影风格；只改变拍摄角度、模特姿势或构图距离。
- 如果用户提示词同时出现“不同背景”和“背景一致/场景一致”，以背景一致、场景一致为最高优先级。
- ${
    hasSeriesReference
      ? "最后一张输入图是本批次第一张已生成图片，请严格参考它的背景、空间、光线和色调，后续图片不要换成纯灰底、纯色棚拍或其他场景。"
      : "先确定一个适合整批图片复用的干净商品摄影背景，后续图片会以这张图作为背景参考。"
  }
- 只根据商品媒体图提取服装颜色、面料、版型、领口、长度、装饰和细节。
- 不要复制参考图里的原始模特姿势、原始背景或水印。
- 输出适合 Shopify 商品上架的干净、高级、真实摄影风格图片。
- 主体完整、构图居中、服装细节清晰，不要裁切头部、手臂、脚或裙摆。`;
}

function getProductListingAngleInstruction(index: number, total: number): string {
  if (total <= 1) return "正面全身商品照";
  const angles = [
    "正面全身商品照，清楚展示整体版型",
    "背面全身商品照，清楚展示后背和裙摆",
    "45 度侧身商品照，展示侧面轮廓和垂坠",
    "近景细节商品照，展示领口、面料和装饰",
    "另一侧 45 度商品照，展示不同侧面轮廓",
    "半身或三分之二构图，展示上身细节和腰线",
  ];
  return angles[(index - 1) % angles.length];
}

function appendGeneratedImageUrls(text: string, urls: string[]): string {
  if (!urls.length) return text;
  return `${text.trim()}\n\n大模型生成图片：\n${urls.join("\n")}`;
}

function normalizeProductMetafieldDefinitions(
  value: unknown,
): ProductMetafieldDefinitionInput[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const definitions: ProductMetafieldDefinitionInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const id = sanitizeText(String(source.id || ""));
    const name = sanitizeText(String(source.name || source.key || ""));
    const namespace = sanitizeText(String(source.namespace || ""));
    const key = sanitizeText(String(source.key || ""));
    const type = sanitizeText(
      String(source.type || "single_line_text_field"),
    );
    const identity = `${namespace}.${key}`;
    if (!name || !namespace || !key || seen.has(identity)) continue;
    seen.add(identity);
    definitions.push({ id, name, namespace, key, type });
  }
  return definitions.slice(0, 20);
}

function normalizeCandidateList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const items: string[] = [];
  for (const rawItem of value) {
    const rawValue =
      typeof rawItem === "string"
        ? rawItem
        : rawItem && typeof rawItem === "object"
          ? String(
              (rawItem as { label?: unknown; value?: unknown }).label ||
                (rawItem as { label?: unknown; value?: unknown }).value ||
                "",
            )
          : "";
    const item = sanitizeCategoryCandidateValue(rawValue);
    if (!item) continue;
    const normalized = item.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}

function normalizeProductOrganizationCandidates(
  value: unknown,
): ProductOrganizationCandidates {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const source = value as Partial<Record<ProductOrganizationCandidateKey, unknown>>;
  const limits: Record<ProductOrganizationCandidateKey, number> = {
    productTypes: 60,
    vendors: 60,
    collections: 120,
    commonTags: 60,
    tags: 160,
  };
  const result: ProductOrganizationCandidates = {};
  for (const { key } of PRODUCT_ORGANIZATION_CANDIDATE_LABELS) {
    const items = normalizeCandidateList(source[key], limits[key]);
    if (items.length) result[key] = items;
  }
  return result;
}

function normalizeCustomsCandidates(value: unknown): CustomsCandidates {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { countries: [], currentCountryCode: "", harmonizedSystemCode: "" };
  }
  const source = value as Partial<{
    countries: unknown;
    currentCountryCode: unknown;
    harmonizedSystemCode: unknown;
  }>;
  return {
    countries: normalizeCandidateList(source.countries, 260),
    currentCountryCode: sanitizeCategoryCandidateValue(
      typeof source.currentCountryCode === "string"
        ? source.currentCountryCode
        : "",
    )
      .toUpperCase()
      .slice(0, 2),
    harmonizedSystemCode: sanitizeCategoryCandidateValue(
      typeof source.harmonizedSystemCode === "string"
        ? source.harmonizedSystemCode
        : "",
    )
      .replace(/\D/g, "")
      .slice(0, 13),
  };
}

function formatProductOrganizationCandidateSummary(
  candidates: ProductOrganizationCandidates,
): string {
  const lines = PRODUCT_ORGANIZATION_CANDIDATE_LABELS.flatMap((field) => {
    const items = candidates[field.key] || [];
    if (!items.length) return [];
    return [`${field.outputLabel}（${field.displayLabel}）：${items.join("、")}`];
  });
  return lines.length
    ? lines.join("\n")
    : "无。当前未读取到 Shopify 后台产品组织候选条目。";
}

function formatCustomsCandidateSummary(candidates: CustomsCandidates): string {
  const lines = [
    candidates.currentCountryCode
      ? `当前原产国家/地区：${candidates.currentCountryCode}`
      : "",
    candidates.countries.length
      ? `Shopify 官方国家/地区候选：${candidates.countries.join("、")}`
      : "Shopify 官方国家/地区候选：无",
    candidates.harmonizedSystemCode
      ? `当前 HS 编码：${candidates.harmonizedSystemCode}`
      : "当前 HS 编码：空",
  ].filter(Boolean);
  return lines.join("\n");
}

function normalizeCategoryMetafieldCandidates(
  value: unknown,
): CategoryMetafieldCandidates {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const source = value as Partial<Record<CategoryMetafieldCandidateKey, unknown>>;
  const result: CategoryMetafieldCandidates = {};
  for (const { key } of CATEGORY_METAFIELD_CANDIDATE_LABELS) {
    const rawItems = source[key];
    if (!Array.isArray(rawItems)) continue;

    const seen = new Set<string>();
    const items: string[] = [];
    for (const rawItem of rawItems) {
      if (typeof rawItem !== "string") continue;
      const item = sanitizeCategoryCandidateValue(rawItem);
      if (!item) continue;
      const normalized = item.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      items.push(item);
      if (items.length >= 30) break;
    }
    if (items.length) result[key] = items;
  }
  return result;
}

function formatCategoryMetafieldCandidateSummary(
  candidates: CategoryMetafieldCandidates,
): string {
  const lines = CATEGORY_METAFIELD_CANDIDATE_LABELS.flatMap((field) => {
    const items = candidates[field.key] || [];
    if (!items.length) return [];
    return [`${field.outputLabel}（${field.displayLabel}）：${items.join("、")}`];
  });
  return lines.length
    ? lines.join("\n")
    : "无。当前类别没有可用候选条目；类别元字段按商品图片自由判断。";
}

function shouldGenerateCategoryMetafields(prompt: string): boolean {
  const text = prompt.toLowerCase();
  return (
    /类别\s*元字段|类目\s*元字段|分类\s*元字段|category\s*metafields?|metafields?/.test(
      text,
    ) ||
    CATEGORY_METAFIELD_CANDIDATE_LABELS.some((field) => {
      const outputLabel = field.outputLabel.toLowerCase();
      const key = field.key.toLowerCase();
      return text.includes(outputLabel) || text.includes(key);
    })
  );
}

function getRequiredOutputFields(prompt: string): string[] {
  const normalizedPrompt = prompt.toLowerCase();
  const required = new Set<string>();
  if (
    /完整|全部|所有字段|全字段|完整内容|完整信息|全套|complete|full|all fields/i.test(
      prompt,
    )
  ) {
    FULL_PRODUCT_OUTPUT_FIELDS.forEach((field) => required.add(field));
  }
  for (const field of REQUIRED_OUTPUT_FIELD_ALIASES) {
    if (
      field.aliases.some((alias) =>
        normalizedPrompt.includes(alias.toLowerCase()),
      )
    ) {
      required.add(field.label);
    }
  }
  for (const field of CATEGORY_METAFIELD_CANDIDATE_LABELS) {
    const outputLabel = field.outputLabel;
    const displayLabel = field.displayLabel;
    const key = field.key;
    if (
      normalizedPrompt.includes(outputLabel.toLowerCase()) ||
      normalizedPrompt.includes(displayLabel.toLowerCase()) ||
      normalizedPrompt.includes(key.toLowerCase()) ||
      normalizedPrompt.includes(`类别元字段${displayLabel}`.toLowerCase())
    ) {
      required.add(outputLabel);
    }
  }
  return Array.from(required);
}

function formatRequiredOutputFieldInstruction(prompt: string): string {
  const fields = getRequiredOutputFields(prompt);
  if (!fields.length) {
    return "本次用户提示词没有点名固定必填字段；按系统建议字段生成即可。";
  }
  return [
    `本次用户提示词明确要求输出的字段（必须逐项输出，不得省略）：${fields.join("、")}`,
    "强制规则：上面每个字段都必须以 key: value 单独一行出现在最终输出里；无法确定时也保留字段名，值可以为空或保守值。",
  ].join("\n");
}

function sanitizeCategoryCandidateValue(value: string): string {
  return sanitizeText(value)
    .replace(/[|]/g, " ")
    .replace(/\s{2,}/g, " ")
    .slice(0, 80)
    .trim();
}

function sanitizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
