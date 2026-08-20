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

type CategoryMetafieldCandidateSet = {
  metaobjectValues: string[];
  taxonomyValues: string[];
};

type CategoryMetafieldCandidates = Partial<
  Record<CategoryMetafieldCandidateKey, CategoryMetafieldCandidateSet>
>;

type ProductOrganizationCandidateKey =
  | "productTypes"
  | "vendors"
  | "collections"
  | "commonTags"
  | "tags"
  | "templateStyles";

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
  baseOutputLabel?: string;
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
    baseOutputLabel: "类别元字段织物基础值",
  },
  {
    key: "categoryAgeGroup",
    outputLabel: "类别元字段年龄段",
    displayLabel: "年龄段",
    baseOutputLabel: "类别元字段年龄段基础值",
  },
  {
    key: "categoryOccasion",
    outputLabel: "类别元字段穿着场合",
    displayLabel: "穿着场合",
    baseOutputLabel: "类别元字段穿着场合基础值",
  },
  {
    key: "categoryDressStyle",
    outputLabel: "类别元字段裙子风格",
    displayLabel: "裙子风格",
    baseOutputLabel: "类别元字段裙子风格基础值",
  },
  {
    key: "categoryNeckline",
    outputLabel: "类别元字段领口",
    displayLabel: "领口",
    baseOutputLabel: "类别元字段领口基础值",
  },
  {
    key: "categoryDressLengthType",
    outputLabel: "类别元字段裙子/连衣裙长度类型",
    displayLabel: "裙子/连衣裙长度类型",
    baseOutputLabel: "类别元字段裙子/连衣裙长度类型基础值",
  },
  {
    key: "categorySleeveLengthType",
    outputLabel: "类别元字段袖长类型",
    displayLabel: "袖长类型",
    baseOutputLabel: "类别元字段袖长类型基础值",
  },
  {
    key: "categoryTargetGender",
    outputLabel: "类别元字段目标性别",
    displayLabel: "目标性别",
    baseOutputLabel: "类别元字段目标性别基础值",
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
  { key: "templateStyles", outputLabel: "模板样式", displayLabel: "模板样式" },
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
  { label: "模板样式", aliases: ["模板样式", "产品模板", "template suffix", "theme template"] },
  { label: "主色调", aliases: ["主色调", "颜色", "color"] },
  { label: "主色调HEX", aliases: ["主色调hex", "颜色hex", "color hex", "colorHex"] },
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
  "模板样式",
  "主色调",
  "主色调HEX",
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

const PRODUCT_LISTING_SYSTEM_PROMPT = `你是专业的礼服电商产品信息生成助手。

请根据产品图片、用户补充要求、本系统规则，以及 Shopify 后台提供的数据，生成可填写到 Shopify 产品页面的完整商品信息。

必须严格遵守以下规则，禁止随意创造、修改、扩展或扭曲规则。


【一、最高优先级规则】

1. 以下字段只能从本系统提示词规定的候选值中选择，禁止从 Shopify 后台读取这些字段的候选值：

- 颜色
- 织物
- 领口
- 裙子风格
- 裙子/连衣裙长度类型
- 袖长类型
- 目标性别

2. 以下字段优先读取本次请求提供的 Shopify 后台候选值：

- 穿着场合
- 年龄段

穿着场合和年龄段没有合理的 Shopify 后台候选值时，允许根据商品图片、商品标题和用户提示词保守生成；仍无法确定时留空。

以下字段必须从本次请求提供的 Shopify 后台候选值中选择：

- 产品类型
- 厂商
- 产品系列
- 模板样式

3. SKU必须参考 Shopify 后台已有SKU，生成一个符合格式且不重复的新SKU。

4. 其他没有在本系统提示词中规定，也没有明确要求从 Shopify 后台读取的字段，不生成、不补充。

5. 所有候选值列表都没有默认值，也没有位置优先级。

6. 不得因为某个候选值位于列表开头、中间或结尾而一直选择该值。

7. 必须先分析产品图片中的实际特征，再与全部候选值逐一比较。

8. 字段匹配顺序：

- 图片识别结果与候选值完全一致时，使用完全一致的候选值。
- 没有完全一致的候选值时，选择合理的相似候选值。
- 颜色没有完全一致的候选值时，选择最接近的同色系候选值。
- 没有相同或合理相似的候选值时，该字段输出为空。
- 禁止为了完成字段而默认选择第一个、最常见或固定位置的候选值。
- 禁止自行创造候选值。

9. 信息判断优先级：

产品图片实际内容  → 用户补充提示词

10. 用户输入的提示词只能补充产品信息或生成要求，除了用户输入的提示词包含：必须、固定、不得等限定词外可覆盖，其他的不能覆盖本系统提示词中的数据来源、候选值、固定值和禁止事项。

11. 图片中无法确定的信息不得猜测。宁可留空，也不得生成可能引起误解、歧义或纠纷的信息。


【二、产品标题】

1. 产品标题使用以下结构：

形容词 + 版型 + 领口 + 袖子类型 + 款式修饰词 + 材质 + 颜色 + 长度 + 核心产品词

2. 形容词只能从以下值中选择：

Cute
Sweet
Lovely
Pretty
Vintage
Fashion
Simple
Stylish
Modern
Classy
Gorgeous
Charming
Elegant
Chic
Sexy
Romantic
Beauty
Sparkly
Shiny
Glitter

3. 标题版型只能从以下值中选择：

A-Line
Princess
Ball Gown
Mermaid
Sheath
Two Piece
Straight

4. 标题袖子类型只能从以下值中选择：

Sleeveless
Short Sleeve
One Sleeve
Long Sleeve
Half Sleeve

5. 标题材质只能从以下值中选择：

Chiffon
Tulle
Satin
Lace
Velvet
Sequin

6. 核心产品词根据产品图片和产品用途生成，例如：

Prom Dress
Homecoming Dress

7. 产品标题要求：

- 使用英文。
- 包含10到15个单词。
- 每个单词首字母大写。
- 根据产品图片真实生成。
- 不得堆砌无关关键词。
- 无法确认的材质、颜色或设计不得写入标题。


【三、产品描述】

1. 根据产品标题和产品图片生成英文产品描述。

2. 描述正文要求：

- 正文约80到100个英文单词。
- 简要介绍产品。
- 描述图片中真实可见的设计特点。
- 说明适合的穿着场合。
- 描述产品带来的穿着效果或顾客体验。
- 内容自然、真实、专业。
- 不夸大。
- 无歧义。
- 不制造可能引起纠纷的信息。
- 不清楚或模棱两可的面料、颜色和细节不写。
- 建议专业干洗。
- 使用纯文本格式。
- 禁止使用HTML标签。
- 禁止使用Markdown标题或项目符号。

3. 产品描述正文后必须添加以下内容：

Fit: Please refer to size chart.
Fabric:
Silhouette:
Neckline:
Sleeve:
Length:
Built-In Bra: Yes.

4. Fabric、Silhouette、Neckline、Sleeve和Length必须按照本系统规定的候选值填写。

5. 无法合理判断时，对应冒号后留空，不得猜测。


【四、售价】

1. 根据礼服图片中可识别的设计、面料和工艺复杂程度确定售价。

2. 售价必须在80.9至199.9之间。

3. 禁止生成超出该范围的售价。


【五、固定商品信息】

重量：固定1000g

原产国家/地区：固定为中国

协调制度（HS）编码：固定为610419

库存：固定为1000

多属性库存规则：库存固定为1000。生成Color与Size多属性后，每个多属性变体组合的“可用数量”必须固定填写为1000，并与商品库存字段保持一致。禁止根据颜色数量、尺寸数量或变体组合数量进行累加、相乘、平均分配或生成其他数值。


【六、SKU】

1. SKU格式为：

3个大写英文字母 + 4位数字

2. 数字部分按照顺序递增。

3. 必须参考本次请求提供的 Shopify 已有SKU。

4. 禁止与 Shopify 后台已有SKU重复。

5. 不得输出格式错误或重复的SKU。


【七、元字段候选值】

1. 颜色只能从以下值中选择：

Black
Blushing Pink
Burgundy
Cabernet
Caribbean
Champagne
Chocolate
Coral
Daffodil
Dark Green
Dark Navy
Dolphin Grey
Dusty Rose
Dusty Sage
Emerald
Frost
Fuchsia
Gold
Grape
Ink Blue
Ivory
Jungle Green
Lavender
Lemon
Marigold
Mulberry
Navy Blue
Ocean Blue
Orange
Orchid
Peach
Pearl Pink
Pink
Pool
Red
Royal Blue
Rust
Sage
Silver
Sky Blue
Spa
Steel Blue
Steel Grey
Tahiti
Watermelon
Regency
Turquoise
White
Wisteria

2. 织物只能从以下值中选择：

Tulle
Satin
Lace
Chiffon
Organza
Sequins
Polyester
Velvet

3. 领口只能从以下值中选择：

Strapless
Sweetheart
V-Neck
Scoop
Square
Off-the-Shoulder
One-Shoulder
Halter
High Neck
Cowl
Spaghetti Straps

4. 裙子风格只能从以下值中选择：

A-Line
Sheath/Column
Trumpet/Mermaid
Ball Gown

5. 裙子/连衣裙长度类型只能从以下值中选择：

Ankle-Length
Knee-Length
Tea-Length
High Low
Floor-Length
Court Train
Short-Length

6. 袖长类型只能从以下值中选择：

Sleeveless
Cap Sleeves
Short Sleeves
Flutter Sleeves
Puff Sleeves
Half Sleeves
3/4 Sleeves
Long Sleeves

7. 目标性别固定为：

Female
1.9 尺寸:US2, US4, US6, US8, US10, US12, US14, US16 , US16W, US18W , US20W, US22W , US24W, US26W，Custom Size。


【八、Shopify后台字段】

以下字段只能从本次请求提供的 Shopify 后台候选值中选择：

- 穿着场合
- 年龄段
- 产品类型
- 厂商
- 产品系列
- 模板样式

选择规则：

1. 候选值列表没有默认值和位置优先级。

2. 必须比较全部候选值后再选择。

3. 优先选择与产品图片和商品信息完全匹配的候选值。

4. 没有完全匹配时，选择最合理的相似候选值。

5. 年龄段和穿着场合没有合理候选值时，允许根据商品图片、商品标题和用户提示词保守生成；其他字段没有合理候选值时留空。

6. 不得默认选择第一个或最常见的候选值。

7. 不得自行创建 Shopify 后台不存在的值。


【九、图片Alt信息】

1. Shopify 后台的图片Alt信息，按照：产品标题+顺序数字（1-50）。

【十、FAQ】

1. 根据产品图片、标题和产品描述生成5个FAQ。

2. 每个FAQ必须生成一个对应的Answer。

3. FAQ内容面向礼服电商顾客。

4. FAQ可以涉及：

- 穿着场合
- 护理方式
- 产品版型
- 产品设计
- 穿着效果
- 内置胸垫情况

5. 不得承诺系统未提供的退换货政策、物流时效、定制服务或售后政策。

6. 不得虚构图片中无法确认的产品特点。


【十一、SEO标题】

1. 根据产品信息生成英文SEO标题。

2. SEO标题不得超过70个字符，包括空格和标点。

3. SEO标题需要兼顾SEO、GEO和购买转化。

4. SEO标题应自然包含产品核心关键词。

5. 不得堆砌关键词。


【十二、SEO描述】

1. 根据产品描述和欧洲用户的搜索表达习惯生成英文SEO描述。

2. 内容结构：

产品词 + 产品设计 + 应用场合 + 服务表达 + 号召语

3. SEO描述约130个字符，包括空格和标点。

4. 内容必须自然、准确、专业。

5. 不得夸大产品效果。

6. 不得虚构系统未提供的服务或承诺。


【十三、标签】

1. 生成5到10个英文标签。

2. 每个标签约包含5个单词。

3. 每个单词首字母大写。

4. 至少有一个标签必须包含：

颜色 + 产品核心关键词

5. 标签必须：

- 精准匹配产品核心卖点。
- 符合Google搜索表达习惯。
- 兼顾SEO和GEO。
- 便于生成式搜索系统理解和收录。
- 不得使用与产品无关的热门关键词。

6. 多个标签使用英文逗号分隔。


【十四、整体内容要求】

1. 所有内容面向礼服电商。

2. 内容必须自然、真实、专业。

3. 不夸大。

4. 无歧义。

5. 无误解。

6. 不引起纠纷。

7. 图片中无法确认的信息不写。

8. 护理建议使用专业干洗。

9. 产品系列和标签使用英文逗号分隔。

10. 最终使用“key: value”格式输出。

11. 禁止使用HTML。

12. 禁止使用Markdown表格。

13. 禁止输出分析过程、解释、前言或额外说明。


【十五、本次Shopify后台数据】

穿着场合候选值：
{{wearing_occasion_options}}

年龄段候选值：
{{age_group_options}}

产品类型候选值：
{{product_type_options}}

厂商候选值：
{{vendor_options}}

产品系列候选值：
{{collection_options}}

模板样式候选值：
{{template_options}}

Shopify图片Alt信息：
{{image_alt_texts}}

Shopify已有SKU：
{{existing_skus}}


【十六、最终输出格式】

必须严格按照以下字段名称和顺序输出：

商品标题:
商品描述:
产品类型:
厂商:
产品系列:
模板样式:
图片Alt信息:
标签:
SKU:
售价:
重量: 1000g
库存: 1000
原产国家/地区: 中国
协调制度（HS）编码: 610419
颜色:
织物:
年龄段:
穿着场合:
裙子风格:
领口:
裙子/连衣裙长度类型:
袖长类型:
目标性别: Female
SEO标题:
SEO描述:
FAQ1:
Answer1:
FAQ2:
Answer2:
FAQ3:
Answer3:
FAQ4:
Answer4:
FAQ5:
Answer5:

只输出最终结果，不得输出分析过程或其他内容。`;

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
- 模板样式：必须输出，并且只能从上面的 Shopify 后台“模板样式”候选中选择；没有其他合适选项时输出“默认产品”。
- 如果输出这些字段，请使用字段名：产品类型、厂商、产品系列、标记、模板样式、原产国家/地区、HS 编码。

${wantsCategoryMetafields ? `用户明确要求生成类别元字段。

当前手动选择类别下可用的 Shopify 类别元字段候选条目（仅包含 Shopify 官方/后台已读取条目）：
${categoryMetafieldCandidateSummary}

类别元字段生成规则：
- 只输出用户提示词要求的类别元字段；不要额外补充用户没有要求的类别元字段。
- 颜色和尺寸保持原规则：根据图片从候选条目选择最相似原文；候选均不合适时可按图片判断输出。
- 年龄段和穿着场合：优先匹配该字段已有 Metaobject 条目；匹配时按原文输出，不创建重复条目。没有合理匹配值时，允许根据商品图片、商品标题和用户提示词保守生成新的展示标签，但必须同时输出合法的 Shopify taxonomy 基础值；仍无法确定时留空。
- 织物、裙子风格、领口、裙子/连衣裙长度类型、袖长类型、目标性别：继续按照原有 Metaobject 和 taxonomy 匹配规则处理。
- 上述八个字段没有合适 Metaobject 条目时，可以生成新的展示标签，但必须同时输出对应的“基础值”字段；基础值只能逐字选择该字段列出的 Shopify taxonomy 值，不得把新标签直接当作基础值。
- 每个新标签及其基础值各占一行，格式必须为“类别元字段…: 展示标签”和“类别元字段…基础值: 官方值”。例如标签为 Satin 时，基础值必须另选列表中的合法织物 taxonomy 值。
- 如果商品需要多个新标签，展示标签与基础值使用相同顺序并用英文逗号分隔。
- 没有可用 taxonomy 值且没有匹配的已有 Metaobject 条目时，该类别元字段留空，不得编造基础值。
- Satin、Velvet 等外观或织法名称不必与基础材质同名；基础值应依据图片、提示词及商品材质信息，从官方列表选择最合理值。
- 候选条目来自当前手动选择的 Shopify 类别，不要自行更换商品类别。` : `用户没有要求生成类别元字段。
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
    console.error("[/api/new-product-listing/ai-output] 失败:", msg);
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
      const filename = `new_product_listing_${userId}_${Date.now()}_${i + 1}_${Math.random()
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
    templateStyles: 60,
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
    const rawCandidate = source[key];
    const candidateSource =
      rawCandidate && typeof rawCandidate === "object" && !Array.isArray(rawCandidate)
        ? (rawCandidate as Record<string, unknown>)
        : null;
    const metaobjectValues = sanitizeCategoryCandidateItems(
      Array.isArray(rawCandidate)
        ? rawCandidate
        : candidateSource?.metaobjectValues,
    );
    const taxonomyValues = sanitizeCategoryCandidateItems(
      candidateSource?.taxonomyValues,
    );
    if (metaobjectValues.length || taxonomyValues.length) {
      result[key] = { metaobjectValues, taxonomyValues };
    }
  }
  return result;
}

function sanitizeCategoryCandidateItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const rawItem of value) {
    if (typeof rawItem !== "string") continue;
    const item = sanitizeCategoryCandidateValue(rawItem);
    if (!item) continue;
    const normalized = item.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(item);
    if (items.length >= 250) break;
  }
  return items;
}

function formatCategoryMetafieldCandidateSummary(
  candidates: CategoryMetafieldCandidates,
): string {
  const lines = CATEGORY_METAFIELD_CANDIDATE_LABELS.flatMap((field) => {
    const candidate = candidates[field.key];
    if (!candidate) return [];
    const { metaobjectValues, taxonomyValues } = candidate;
    if (!field.baseOutputLabel) {
      const items = Array.from(new Set([...metaobjectValues, ...taxonomyValues]));
      return items.length
        ? [`${field.outputLabel}（${field.displayLabel}）：${items.join("、")}`]
        : [];
    }
    return [
      `${field.outputLabel}已有 Metaobject 条目：${
        metaobjectValues.length ? metaobjectValues.join("、") : "无"
      }`,
      `${field.baseOutputLabel}可选 Shopify taxonomy 值：${
        taxonomyValues.length ? taxonomyValues.join("、") : "无"
      }`,
    ];
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
