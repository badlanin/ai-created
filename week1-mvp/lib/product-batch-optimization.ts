import { promises as fs } from "fs";
import crypto from "crypto";
import path from "path";
import { resolveModelId } from "./ai-models";
import type { User } from "./auth";
import { DATA_DIR_PATH } from "./db";
import { buildGenaiClient } from "./genai-client";
import { assertWithinBudget } from "./pricing";
import { acquireToken } from "./rate-limiter";
import { retryWithBackoff } from "./retry";
import { recordUsage } from "./usage";
import {
  getShopifyCategoryMetafieldOptions,
  syncShopifyProductCategoryMetafields,
  type ShopifyCategoryMetafieldOptionsResult,
  type ShopifyProductCategoryMetafieldsSyncInput,
} from "./shopify";

const SHOPIFY_API_VERSION =
  process.env.SHOPIFY_API_VERSION?.trim() || "2026-04";
const APPLIED_TAG = "ai-seo-geo-applied";
const MAX_PREVIEW_LIMIT = 50;
const SHOPIFY_PRODUCT_FETCH_BATCH_SIZE = 10;
const RUNS_DIR_NAME = "product-batch-optimization";
const JSON_FAILURES_DIR_NAME = "json-failures";
const PRODUCT_BATCH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

type PreviewJobState = {
  id: string;
  userId: number;
  deviceId: string;
  cancelled: boolean;
  controller: AbortController;
  createdAt: number;
  reason: string | null;
  progress: ProductBatchPreviewProgress;
};

const previewJobs = new Map<string, PreviewJobState>();

const PRODUCT_BATCH_RULES = {
  rulesVersion: "2026-06-12",
  geoMeaning:
    "GEO means Generative Engine Optimization / AI answer engine optimization, not only geographic targeting.",
  contentRules: {
    productTitleMaxChars: 120,
    seoTitleMaxChars: 70,
    metaDescriptionMaxChars: 160,
    imageAltTextMaxChars: 125,
    maxTags: 30,
    descriptionHtmlAllowedTags: ["p", "strong", "em", "br"],
  },
  seoRules: [
    "Keep titles readable for humans first; avoid keyword stuffing.",
    "Put the main product keyword early when it naturally fits.",
    "Use clear buying-intent language based only on known product facts.",
    "Meta descriptions should explain what the product is, who it is for, and one or two concrete benefits.",
    "Do not invent materials, certifications, guarantees, discounts, medical claims, shipping promises, or compatibility claims.",
  ],
  geoRules: [
    "Write in a way that AI answer engines can quote: concise, fact-rich, and specific.",
    "Include product type, use case, audience, differentiators, and common buyer questions when supported.",
    "Avoid vague superlatives such as best, perfect, premium, or ultimate unless the source product data proves them.",
    "Write the product description body using natural paragraphs only. Do not use bullet lists, numbered lists, or attribute-summary blocks.",
    "Use the store language and market terminology consistently.",
  ],
  preserveExistingTags: {
    exact: [] as string[],
    prefixes: [
      "sync:",
      "feed:",
      "hidden:",
      "internal:",
      "google_",
      "meta:",
      "collection:",
    ],
    contains: ["do-not-edit", "do_not_edit"],
  },
  imageRules: [
    "Generate concise image alt text for product media when image information is available.",
    "Alt text should describe the visible product and useful attributes, not repeat 'image of' or stuff keywords.",
    "If the image cannot be confidently interpreted, write conservative alt text based on product title and existing alt text.",
  ],
};

export const PRODUCT_BATCH_DEFAULT_PROMPT =
  "请根据现有商品资料优化 Shopify 商品标题、描述、SEO 标题、Meta 描述、标签、图片 Alt 和 FAQ。保持事实准确，不要编造材质、认证、折扣、物流或售后承诺。除类别元字段尺寸外，标题、描述、SEO 标题、Meta 描述、标签、图片 Alt 和 FAQ 必须统一使用英文；涉及数字时使用阿拉伯数字。适合礼服/婚纱独立站自然搜索和 AI 问答引用。";

const PRODUCT_BATCH_SYSTEM_PROMPT = `
你是专业的 Shopify 商品 SEO/GEO 内容编辑。你会基于输入的商品资料，优化商品标题、商品描述、页面标题、元描述、标签、图片 Alt 文本和 FAQ。

任务范围规则：
1. 你必须严格服从 targetFields 和 forbiddenFields。只有 targetFields 中列出的字段允许改写。
2. forbiddenFields 中列出的字段必须逐字复制 currentProduct/currentSnapshot 中的原值，不得优化、润色、翻译、补全或重新排序。
3. customInstructions 只用于指导 targetFields，不得把用户没有点名的字段也一起优化。
4. 即使 schema 要求返回完整 JSON，也不代表所有字段都可以改；完整 JSON 中非目标字段只能作为原值占位。
5. 如果 customInstructions 和 targetFields 冲突，以 targetFields 为准。

错误示例：
用户只要求“优化标题和 FAQ”时，同时改写 descriptionHtml、seoTitle、metaDescription、tags、imageAltTexts 是错误的。
正确做法：只改 title 和 faq；其他字段完全复制原值。

事实规则：
1. 只能使用输入资料中明确提供，或图片 URL/既有 alt/商品标题能合理支持的商品事实。
2. 不得虚构材质、功能、认证、保证、折扣、医疗功效、兼容性、库存、物流时效、退换政策或其他未经证实的信息。
3. 当资料不足或无法确认时，省略相关内容，不要为了完整而补充未经证实的信息。
4. 不得改变品牌名称、产品型号和其他关键商品信息。

文案规则：
1. 除 categorySize、rationale 和 warnings 外，标题、描述、页面标题、Meta 描述、标签、图片 Alt 和 FAQ 问答必须统一使用英文；中文输入只能作为理解资料，不得直接输出到这些字段；涉及数字时使用阿拉伯数字，并保持目标市场用语和品牌语气。
2. 标题必须重新优化，不得与原标题完全相同。
3. 描述正文只使用自然段，不要生成项目符号、编号列表、参数表或属性清单。
4. 描述 HTML 只能使用 p、strong、em、br 标签，不要把 FAQ 写进描述正文。
5. SEO 标题控制在 70 字符以内；Meta 描述控制在 160 字符以内。SEO 标题和Meta 描述在限定字数内都必须保证句子的完整。SEO 标题必须同时输出 seoTitlePhrases 候选短语，Meta 描述必须同时输出 metaDescriptionSentences 候选短句；候选内容要短、完整、可由代码组合，不要依赖截断。
6. 图片 Alt 简洁描述可见商品，不要重复 "image of"，不要堆砌关键词。
7. categorySize 表示 Shopify 类别元字段中的尺寸，只能输出阿拉伯数字尺寸列表，例如 "2, 4, 6, 8"；不要输出中文数字、英文单词或说明文字；不要写固定默认值，只能根据用户输入、现有商品资料或可确认的商品信息生成。
8. 如果 customInstructions 明确列出 categorySize/类别元字段尺寸的固定尺寸，categorySize 必须逐项复制其中的阿拉伯数字，不得新增、猜测或扩展未列出的尺寸。

输出规则：
1. 只返回合法 JSON，不要 Markdown、代码块、解释或 JSON 之外的文字。
2. JSON 必须匹配 schema。warnings 用来提示资料不足、疑似风险或需要人工确认的点。
3. rationale 必须使用中文，简洁说明本次优化了哪些内容以及为什么这样改。
4. 所有商品标题、商品描述、页面标题、Meta 描述、标签、FAQ 问答、图片 Alt 等自然语言写回字段必须是英文完整句子或英文完整短语，不得以介词、连词、逗号、冒号、破折号或半截短语结尾；字符限制不足时必须改写成更短的完整表达，不得直接截断。categorySize 例外，只能使用阿拉伯数字尺寸列表。
`.trim();

const PRODUCT_BATCH_REPAIR_SYSTEM_PROMPT = `
你是 Shopify 商品文案完整性与英文质量修复器。你只修复不完整、被截断、残缺、非英文或类别尺寸格式错误的字段，不做新的营销创作。
规则：
1. 只返回合法 JSON，必须匹配 schema。
2. 不新增未经输入支持的商品事实，不新增材质、认证、折扣、物流、售后、库存、SKU、价格或变体信息。
3. 保持 URL handle、模板样式尽量不变；修复商品标题、标签和类别尺寸时只处理质量问题，不新增事实。
4. 修复 title、descriptionHtml、seoTitle、seoTitlePhrases、metaDescription、metaDescriptionSentences、tags、FAQ、imageAltTexts、categoryMetafields 等自然语言字段，使每个句子或短语为英文且完整，不得以介词、连词、逗号、冒号、破折号或半截短语结尾。
5. 如果字符限制不够，必须改写成更短的完整句子，不得直接截断。
6. categorySize 只能保留阿拉伯数字尺寸列表，例如 "2, 4, 6, 8"；不得输出中文数字、英文单词或说明文字。
7. 只修复 targetFields 中列出的字段；forbiddenFields 中的字段必须逐字复制 currentSnapshot/currentProduct 原值，不得借修复机会改写。
`.trim();

const PRODUCT_BATCH_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    handle: { type: "string" },
    descriptionHtml: { type: "string" },
    seoTitle: { type: "string" },
    seoTitlePhrases: { type: "array", items: { type: "string" } },
    metaDescription: { type: "string" },
    metaDescriptionSentences: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    imageAltTexts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          mediaId: { type: "string" },
          altText: { type: "string" },
        },
        required: ["mediaId", "altText"],
      },
    },
    categorySize: { type: "string" },
    categoryMetafields: {
      type: "object",
      properties: {
        size: { type: "string" },
        fabric: { type: "string" },
        fabricBaseValue: { type: "string" },
        ageGroup: { type: "string" },
        ageGroupBaseValue: { type: "string" },
        occasion: { type: "string" },
        occasionBaseValue: { type: "string" },
        dressStyle: { type: "string" },
        dressStyleBaseValue: { type: "string" },
        neckline: { type: "string" },
        necklineBaseValue: { type: "string" },
        dressLengthType: { type: "string" },
        dressLengthTypeBaseValue: { type: "string" },
        sleeveLengthType: { type: "string" },
        sleeveLengthTypeBaseValue: { type: "string" },
        targetGender: { type: "string" },
        targetGenderBaseValue: { type: "string" },
      },
    },
    templateStyle: { type: "string" },
    faq: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
        required: ["question", "answer"],
      },
    },
    rationale: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [
    "title",
    "handle",
    "descriptionHtml",
    "seoTitle",
    "seoTitlePhrases",
    "metaDescription",
    "metaDescriptionSentences",
    "tags",
    "imageAltTexts",
    "categorySize",
    "categoryMetafields",
    "templateStyle",
    "faq",
    "rationale",
    "warnings",
  ],
};

export type ProductBatchImageSnapshot = {
  mediaId: string;
  altText: string;
  filename?: string;
  url: string;
  width?: number | null;
  height?: number | null;
};

export type ProductBatchImageUpdate = {
  mediaId: string;
  altText: string;
  filename?: string;
};

export type ProductBatchFaqItem = {
  question: string;
  answer: string;
};

export type ProductBatchCategoryMetafieldKey =
  | "size"
  | "fabric"
  | "ageGroup"
  | "occasion"
  | "dressStyle"
  | "neckline"
  | "dressLengthType"
  | "sleeveLengthType"
  | "targetGender";

type ProductBatchCategoryMetafieldBaseValueKey =
  | "fabricBaseValue"
  | "ageGroupBaseValue"
  | "occasionBaseValue"
  | "dressStyleBaseValue"
  | "necklineBaseValue"
  | "dressLengthTypeBaseValue"
  | "sleeveLengthTypeBaseValue"
  | "targetGenderBaseValue";

type ProductBatchCategoryMetafieldValueKey =
  | ProductBatchCategoryMetafieldKey
  | ProductBatchCategoryMetafieldBaseValueKey;

export type ProductBatchCategoryMetafields = Partial<
  Record<ProductBatchCategoryMetafieldValueKey, string>
>;

type ProductBatchCategoryMetafieldCandidateSet = {
  label: string;
  source: "store" | "official" | "mixed" | "none";
  metaobjectValues: string[];
  taxonomyValues: string[];
};

type ProductBatchCategoryMetafieldCandidates = Partial<
  Record<ProductBatchCategoryMetafieldKey, ProductBatchCategoryMetafieldCandidateSet>
>;

const PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS: Array<{
  key: ProductBatchCategoryMetafieldKey;
  label: string;
  shopifyField: keyof ShopifyProductCategoryMetafieldsSyncInput;
  baseKey?: ProductBatchCategoryMetafieldBaseValueKey;
  shopifyBaseValueField?: keyof ShopifyProductCategoryMetafieldsSyncInput;
  hints: string[];
}> = [
  {
    key: "size",
    label: "尺寸",
    shopifyField: "categorySize",
    hints: ["size", "clothing-size", "尺寸"],
  },
  {
    key: "fabric",
    label: "织物",
    shopifyField: "categoryFabric",
    baseKey: "fabricBaseValue",
    shopifyBaseValueField: "categoryFabricBaseValue",
    hints: ["categoryfabric", "category fabric", "fabric", "织物"],
  },
  {
    key: "ageGroup",
    label: "年龄段",
    shopifyField: "categoryAgeGroup",
    baseKey: "ageGroupBaseValue",
    shopifyBaseValueField: "categoryAgeGroupBaseValue",
    hints: ["age-group", "age group", "年龄段"],
  },
  {
    key: "occasion",
    label: "穿着场合",
    shopifyField: "categoryOccasion",
    baseKey: "occasionBaseValue",
    shopifyBaseValueField: "categoryOccasionBaseValue",
    hints: ["occasion", "dress-occasion", "穿着场合", "场合"],
  },
  {
    key: "dressStyle",
    label: "裙子风格",
    shopifyField: "categoryDressStyle",
    baseKey: "dressStyleBaseValue",
    shopifyBaseValueField: "categoryDressStyleBaseValue",
    hints: ["dress-style", "dress style", "裙子风格", "裙型"],
  },
  {
    key: "neckline",
    label: "领口",
    shopifyField: "categoryNeckline",
    baseKey: "necklineBaseValue",
    shopifyBaseValueField: "categoryNecklineBaseValue",
    hints: ["neckline", "领口"],
  },
  {
    key: "dressLengthType",
    label: "裙子/连衣裙长度类型",
    shopifyField: "categoryDressLengthType",
    baseKey: "dressLengthTypeBaseValue",
    shopifyBaseValueField: "categoryDressLengthTypeBaseValue",
    hints: ["skirt-dress-length-type", "dress-length-type", "dress length", "裙长", "长度类型"],
  },
  {
    key: "sleeveLengthType",
    label: "袖长类型",
    shopifyField: "categorySleeveLengthType",
    baseKey: "sleeveLengthTypeBaseValue",
    shopifyBaseValueField: "categorySleeveLengthTypeBaseValue",
    hints: ["sleeve-length-type", "sleeve length", "袖长", "袖长类型"],
  },
  {
    key: "targetGender",
    label: "目标性别",
    shopifyField: "categoryTargetGender",
    baseKey: "targetGenderBaseValue",
    shopifyBaseValueField: "categoryTargetGenderBaseValue",
    hints: ["target-gender", "target gender", "目标性别"],
  },
];

export type ProductBatchTargetField =
  | "title"
  | "descriptionHtml"
  | "seoTitle"
  | "metaDescription"
  | "tags"
  | "templateStyle"
  | "categorySize"
  | "categoryMetafields"
  | "imageAltTexts"
  | "faq";

export type ProductBatchSortOrder = "newest" | "oldest";

const PRODUCT_BATCH_TARGET_FIELDS: ProductBatchTargetField[] = [
  "title",
  "descriptionHtml",
  "seoTitle",
  "metaDescription",
  "tags",
  "templateStyle",
  "categorySize",
  "categoryMetafields",
  "imageAltTexts",
  "faq",
];

function getForbiddenTargetFields(
  targetFields: ProductBatchTargetField[],
): ProductBatchTargetField[] {
  const targets = new Set(targetFields);
  return PRODUCT_BATCH_TARGET_FIELDS.filter((field) => !targets.has(field));
}

export type ProductBatchSnapshot = {
  title: string;
  handle: string;
  descriptionHtml: string;
  seoTitle: string;
  metaDescription: string;
  categorySize: string;
  categoryMetafields: ProductBatchCategoryMetafields;
  templateStyle: string;
  tags: string[];
  faq: ProductBatchFaqItem[];
  imageAltTexts: ProductBatchImageSnapshot[];
};

export type ProductBatchProposed = {
  title: string;
  handle: string;
  descriptionHtml: string;
  seoTitle: string;
  metaDescription: string;
  categorySize: string;
  categoryMetafields: ProductBatchCategoryMetafields;
  templateStyle: string;
  tags: string[];
  imageAltTexts: ProductBatchImageUpdate[];
  faq: ProductBatchFaqItem[];
};

type ProductBatchCompletenessIssue = {
  field: string;
  message: string;
  value?: string;
};

export type ProductBatchProposal = {
  store: {
    key: string;
    name: string | null;
    shopDomain: string;
    language: string;
    market: string;
  };
  product: {
    id: string;
    legacyResourceId: string;
    handle: string;
    title: string;
    status: string;
    categoryId?: string;
  };
  current: ProductBatchSnapshot;
  proposed: ProductBatchProposed;
  targetFields?: ProductBatchTargetField[];
  targetCategoryMetafieldKeys?: ProductBatchCategoryMetafieldKey[];
  changeSummary: Record<string, boolean | number>;
  rationale: string;
  warnings: string[];
};

export type ProductBatchRunSummary = {
  id: string;
  userId?: number;
  deviceId?: string;
  createdAt: number;
  updatedAt: number;
  shopDomain: string;
  shopName: string | null;
  storeKeys: string[];
  stores: Array<{ key: string; name: string | null; shopDomain: string }>;
  proposalStores?: Array<{ key: string; name: string | null; shopDomain: string }>;
  start: number;
  query: string;
  sortOrder?: ProductBatchSortOrder;
  prompt: string;
  limit: number;
  model: string;
  targetFields?: ProductBatchTargetField[];
  proposalCount: number;
  failureCount: number;
  stopped?: boolean;
  stopReason?: string | null;
  lastApplyAt?: number | null;
};

export type ProductBatchApplyResult = {
  storeKey?: string;
  productId: string;
  title: string;
  ok: boolean;
  productUpdate?: unknown;
  faqUpdate?: unknown;
  imageAltUpdate?: unknown;
  categorySizeUpdate?: unknown;
  categoryMetafieldsUpdate?: unknown;
  draftUpdate?: unknown;
  appliedTagUpdate?: unknown;
  error?: string;
};

export type ProductBatchRunDocument = ProductBatchRunSummary & {
  rulesVersion: string;
  includeImages: boolean;
  includeApplied: boolean;
  proposals: ProductBatchProposal[];
  failures: Array<{ productId?: string; title?: string; error: string }>;
  applyResults?: ProductBatchApplyResult[];
};

export type ProductBatchPreviewProgress = {
  jobId: string;
  phase:
    | "idle"
    | "starting"
    | "fetching"
    | "waiting"
    | "generating"
    | "stopping"
    | "stopped"
    | "completed"
    | "failed"
    | "finished"
    | "lost";
  percent: number;
  completed: number;
  total: number;
  message: string;
  currentStore?: string | null;
  currentProduct?: string | null;
  done: boolean;
  cancelled: boolean;
  createdAt: number;
  updatedAt: number;
  runId?: string | null;
  error?: string | null;
  shopifyThrottle?: ProductBatchShopifyThrottleProgress | null;
};

export type ProductBatchShopifyThrottleProgress = {
  retryAt: number;
  retryAfterMs: number;
  attempt: number;
  maxAttempts: number;
  currentlyAvailable?: number;
  restoreRate?: number;
  maximumAvailable?: number;
  requestedQueryCost?: number;
  source: "shopify" | "fallback";
};

type ShopifyToken = {
  key: string;
  name: string | null;
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  language: string;
  market: string;
  brandVoice: string;
};

export type ProductBatchStoreSafe = {
  key: string;
  name: string;
  shopDomain: string;
  apiVersion: string;
  language: string;
  market: string;
  tokenPresent: boolean;
  tokenIssuedAt: string | null;
  tokenExpiresAt: string | null;
  tokenExpired: boolean;
  tokenRemainingMs: number;
  defaultProductQuery: string;
};

type ProductBatchStoreRecord = {
  key: string;
  userId?: number;
  deviceId?: string;
  name: string;
  shopDomain: string;
  accessTokenEnc: string;
  apiVersion: string;
  language: string;
  market: string;
  brandVoice: string;
  defaultProductQuery: string;
  tokenIssuedAt: string;
  tokenExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProductBatchStoresDocument = {
  stores: ProductBatchStoreRecord[];
};

type ProductBatchScope = {
  userId: number;
  deviceId: string;
};

type ShopifyMetafieldNode = {
  namespace?: string | null;
  key?: string | null;
  type?: string | null;
  value?: string | null;
  definition?: { name?: string | null; key?: string | null } | null;
  reference?: ShopifyMetaobjectNode | null;
  references?: { nodes?: ShopifyMetaobjectNode[] | null } | null;
};

type ShopifyMetaobjectNode = {
  id?: string | null;
  handle?: string | null;
  displayName?: string | null;
  fields?: Array<{ key?: string | null; value?: string | null }> | null;
};

type ShopifyMediaNode = {
  id?: string | null;
  alt?: string | null;
  mediaContentType?: string | null;
  preview?: { image?: { url?: string | null } | null } | null;
  image?: {
    url?: string | null;
    altText?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
};

type ShopifyProductNode = {
  id: string;
  legacyResourceId?: string | number | null;
  title?: string | null;
  handle?: string | null;
  vendor?: string | null;
  productType?: string | null;
  templateSuffix?: string | null;
  status?: string | null;
  category?: { id?: string | null } | null;
  tags?: string[] | null;
  descriptionHtml?: string | null;
  seo?: { title?: string | null; description?: string | null } | null;
  metafields?: { nodes?: ShopifyMetafieldNode[] | null } | null;
  media?: { edges?: Array<{ node?: ShopifyMediaNode | null }> | null } | null;
};

type ShopifyGraphqlError = { message?: string; [key: string]: unknown };
type ShopifyGraphqlErrorPayload = ShopifyGraphqlError[] | ShopifyGraphqlError | string | null;

type ShopifyGraphqlEnvelope<T> = {
  data?: T;
  errors?: ShopifyGraphqlErrorPayload;
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      actualQueryCost?: number;
      throttleStatus?: {
        maximumAvailable?: number;
        currentlyAvailable?: number;
        restoreRate?: number;
      };
    };
  };
};

type ShopifyProductsQueryData = {
  products: {
    edges: Array<{ cursor: string; node: ShopifyProductNode }>;
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  };
};

type ShopifyShopQueryData = {
  shop?: {
    name?: string | null;
    myshopifyDomain?: string | null;
    primaryDomain?: { host?: string | null } | null;
  } | null;
};

const PRODUCTS_QUERY = `
query Products($first: Int!, $after: String, $query: String, $reverse: Boolean!) {
  products(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: $reverse) {
    edges {
      cursor
      node {
        id
        legacyResourceId
        title
        handle
        vendor
        productType
        templateSuffix
        status
        category {
          id
        }
        tags
        descriptionHtml
        seo {
          title
          description
        }
        metafields(first: 100) {
          nodes {
            namespace
            key
            type
            value
            definition {
              name
              key
            }
            reference {
              ... on Metaobject {
                id
                handle
                displayName
                fields {
                  key
                  value
                }
              }
            }
            references(first: 50) {
              nodes {
                ... on Metaobject {
                  id
                  handle
                  displayName
                  fields {
                    key
                    value
                  }
                }
              }
            }
          }
        }
        media(first: 10) {
          edges {
            node {
              id
              alt
              mediaContentType
              preview {
                image {
                  url
                }
              }
              ... on MediaImage {
                image {
                  url
                  altText
                  width
                  height
                }
              }
            }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

const PRODUCT_UPDATE_MUTATION = `
mutation ProductBatchUpdate($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product {
      id
      title
      handle
      tags
      status
      templateSuffix
      seo {
        title
        description
      }
    }
    userErrors {
      field
      message
    }
  }
}
`;

const PRODUCT_TAGS_QUERY = `
query ProductTags($id: ID!) {
  product(id: $id) {
    id
    tags
  }
}
`;

const FILE_UPDATE_MUTATION = `
mutation ProductBatchFileUpdate($files: [FileUpdateInput!]!) {
  fileUpdate(files: $files) {
    files {
      id
      alt
    }
    userErrors {
      field
      message
    }
  }
}
`;

const METAFIELD_DEFINITIONS_QUERY = `
query ProductBatchMetafieldDefinitions {
  metafieldDefinitions(first: 100, ownerType: PRODUCT) {
    nodes {
      name
      namespace
      key
      type {
        name
      }
    }
  }
}
`;

const METAFIELDS_SET_MUTATION = `
mutation ProductBatchMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields {
      id
      namespace
      key
      value
    }
    userErrors {
      field
      message
      code
    }
  }
}
`;

export async function getProductBatchStatus(scope: ProductBatchScope) {
  const stores = await listProductBatchStores(scope);
  const runs = await listProductBatchRuns(scope);
  return {
    stores,
    runs,
    appliedTag: APPLIED_TAG,
    rulesVersion: PRODUCT_BATCH_RULES.rulesVersion,
    defaultPrompt: PRODUCT_BATCH_DEFAULT_PROMPT,
  };
}

export async function listProductBatchStores(
  scope: ProductBatchScope,
): Promise<ProductBatchStoreSafe[]> {
  const doc = await readStoresDocument();
  await refreshProductBatchStoreNames(doc, scope);
  return getScopedStores(doc, scope).map(toSafeStore);
}

export async function exchangeAndSaveProductBatchStore(input: {
  userId: number;
  deviceId: string;
  shopDomain?: string;
  clientId?: string;
  clientSecret?: string;
}) {
  const shopDomain = normalizeShopDomainInput(input.shopDomain);
  const clientId = validateCredential(input.clientId, "SHOPIFY_CLIENT_ID");
  const clientSecret = validateCredential(
    input.clientSecret,
    "SHOPIFY_CLIENT_SECRET",
  );
  const doc = await readStoresDocument();
  const scopedStores = getScopedStores(doc, input);
  if (
    scopedStores.some(
      (store) => store.shopDomain.toLowerCase() === shopDomain.toLowerCase(),
    )
  ) {
    throw new Error(`店铺 ${shopDomain} 已存在。`);
  }

  const token = await requestShopifyAccessToken({
    shopDomain,
    clientId,
    clientSecret,
  });
  const shopName =
    (await fetchShopifyShopName({
      key: "new",
      name: null,
      shopDomain,
      accessToken: token.accessToken,
      apiVersion: SHOPIFY_API_VERSION,
      language: "en",
      market: "",
      brandVoice: "",
    }).catch(() => "")) || fallbackStoreName(shopDomain);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const expiresAt =
    token.expiresIn && token.expiresIn > 0
      ? new Date(nowMs + token.expiresIn * 1000).toISOString()
      : new Date(nowMs + PRODUCT_BATCH_TOKEN_TTL_MS).toISOString();
  const store: ProductBatchStoreRecord = {
    key: nextStoreKey(scopedStores),
    userId: input.userId,
    deviceId: input.deviceId,
    name: shopName,
    shopDomain,
    accessTokenEnc: encryptSecret(token.accessToken),
    apiVersion: SHOPIFY_API_VERSION,
    language: "en",
    market: "",
    brandVoice: "Clear, trustworthy, product-focused, and conversion-oriented.",
    defaultProductQuery: "status:active",
    tokenIssuedAt: now,
    tokenExpiresAt: expiresAt,
    createdAt: now,
    updatedAt: now,
  };
  doc.stores.push(store);
  await writeStoresDocument(doc);
  return { ok: true, store: toSafeStore(store) };
}

export async function deleteProductBatchStore(
  scope: ProductBatchScope,
  storeKey: string,
) {
  const key = normalizeStoreKey(storeKey);
  const doc = await readStoresDocument();
  const before = doc.stores.length;
  doc.stores = doc.stores.filter(
    (store) => !(isStoreInScope(store, scope) && store.key === key),
  );
  if (doc.stores.length === before) {
    throw new Error("店铺不存在或已被删除。");
  }
  await writeStoresDocument(doc);
  return { ok: true, deletedStoreKey: key };
}

export function cancelProductBatchPreview(jobId: string, scope: ProductBatchScope) {
  const id = cleanJobId(jobId);
  const job = previewJobs.get(id);
  if (!job) {
    return { ok: false, cancelled: false, reason: "任务不存在或已经结束。" };
  }
  assertPreviewJobInScope(job, scope);
  if (job.progress.done) {
    return { ok: false, cancelled: false, reason: "当前预览任务已经结束。" };
  }
  job.cancelled = true;
  job.reason = "用户强制停止";
  updatePreviewProgress(job, {
    phase: "stopping",
    cancelled: true,
    message: "已收到强制停止指令，正在结束当前任务...",
  });
  job.controller.abort(new Error(job.reason));
  return { ok: true, cancelled: true };
}

export function getProductBatchPreviewProgress(
  jobId: string,
  scope: ProductBatchScope,
): ProductBatchPreviewProgress {
  const id = cleanJobId(jobId);
  const job = previewJobs.get(id);
  if (!job) {
    const now = Date.now();
    return {
      jobId: id,
      phase: "lost",
      percent: 100,
      completed: 0,
      total: 0,
      message: "任务进度连接已丢失，请查看预览记录或重新生成。",
      currentStore: null,
      currentProduct: null,
      done: true,
      cancelled: false,
      createdAt: now,
      updatedAt: now,
      runId: null,
      error: null,
    };
  }
  assertPreviewJobInScope(job, scope);
  return { ...job.progress, cancelled: job.cancelled || job.progress.cancelled };
}

export function failProductBatchPreview(jobId: string, error: unknown) {
  const job = previewJobs.get(cleanJobId(jobId));
  if (!job || job.progress.done) return;
  const message = error instanceof Error ? error.message : String(error);
  updatePreviewProgress(job, {
    phase: "failed",
    done: true,
    message,
    error: message,
    currentStore: null,
    currentProduct: null,
  });
}

export async function listProductBatchRuns(
  scope: ProductBatchScope,
): Promise<ProductBatchRunSummary[]> {
  const root = getRunsRoot();
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const runs: ProductBatchRunSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const doc = await readProductBatchRun(entry.name);
        if (!isRunInScope(doc, scope)) continue;
        runs.push(toRunSummary(doc));
      } catch {
        // Ignore broken or partial run directories.
      }
    }
    return runs.sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function readProductBatchRun(
  runId: string,
  scope?: ProductBatchScope,
): Promise<ProductBatchRunDocument> {
  const filePath = getRunFilePath(runId);
  const raw = await fs.readFile(filePath, "utf8");
  const run = JSON.parse(raw) as ProductBatchRunDocument;
  if (scope) assertRunInScope(run, scope);
  return run;
}

export async function deleteProductBatchRun(
  scope: ProductBatchScope,
  runId: string,
) {
  await readProductBatchRun(runId, scope);
  const dir = getRunDir(runId);
  await fs.rm(dir, { recursive: true, force: true });
  return { ok: true };
}

export async function createProductBatchPreview(opts: {
  user: User;
  deviceId: string;
  jobId?: string;
  storeKeys?: string[];
  query?: string;
  productTitleKeyword?: string;
  sortOrder?: ProductBatchSortOrder;
  start?: number;
  limit?: number;
  prompt?: string;
  includeImages?: boolean;
  includeApplied?: boolean;
  model?: string | null;
}): Promise<ProductBatchRunDocument> {
  assertWithinBudget(opts.user.id, opts.user.role);

  const scope = { userId: opts.user.id, deviceId: opts.deviceId };
  const previewJob = createPreviewJob(opts.jobId, scope);
  const stores = await requireStoreTokens(scope, opts.storeKeys);
  const limit = clampInt(opts.limit ?? 10, 1, MAX_PREVIEW_LIMIT);
  const start = clampInt(opts.start ?? 0, 0, 100_000);
  const query = cleanText(opts.query || "status:active");
  const productTitleKeyword = normalizeTitleKeyword(opts.productTitleKeyword || "");
  const sortOrder: ProductBatchSortOrder =
    opts.sortOrder === "oldest" ? "oldest" : "newest";
  const prompt = cleanText(opts.prompt || PRODUCT_BATCH_DEFAULT_PROMPT);
  const targetFields = detectTargetFieldsFromPrompt(prompt);
  const includeImages = opts.includeImages !== false;
  const includeApplied = Boolean(opts.includeApplied);
  const model = resolveModelId("vision", opts.model || undefined);

  let fetchedCount = 0;
  let progressCompleted = 0;
  let progressTotal = Math.max(1, stores.length * limit);
  const proposals: ProductBatchProposal[] = [];
  const failures: ProductBatchRunDocument["failures"] = [];
  let stopped = false;
  let stopReason: string | null = null;

  updatePreviewProgress(previewJob, {
    phase: "starting",
    total: progressTotal,
    completed: 0,
    percent: 0,
    message: `准备处理 ${stores.length} 个店铺，预计最多 ${progressTotal} 个商品。`,
    currentStore: null,
    currentProduct: null,
  });

  for (let storeIndex = 0; storeIndex < stores.length; storeIndex += 1) {
    const store = stores[storeIndex];
    const storeLabel = store.name || store.shopDomain;
    let storeProcessed = 0;
    let storeAfter: string | null = null;
    let storeSkip = start;
    let storeHasNextPage = true;

    while (storeProcessed < limit && storeHasNextPage) {
      if (isPreviewJobCancelled(previewJob)) {
        stopped = true;
        stopReason = previewJob?.reason || "已强制停止";
        break;
      }

      const batchLimit = Math.min(
        SHOPIFY_PRODUCT_FETCH_BATCH_SIZE,
        limit - storeProcessed,
      );
      let products: ShopifyProductNode[] = [];
      updatePreviewProgress(previewJob, {
        phase: "fetching",
        message: `正在读取 ${storeLabel} 的 Shopify 商品 ${storeProcessed + 1}-${storeProcessed + batchLimit}...`,
        currentStore: storeLabel,
        currentProduct: null,
      });
      try {
        const batch = await fetchProducts({
          connection: store,
          query,
          productTitleKeyword,
          sortOrder,
          start: storeSkip,
          limit: batchLimit,
          after: storeAfter,
          includeApplied,
          signal: previewJob?.controller.signal,
          onThrottle: (throttle) => {
            const retrySeconds = Math.max(
              1,
              Math.ceil((throttle.retryAt - Date.now()) / 1000),
            );
            updatePreviewProgress(previewJob, {
              phase: "waiting",
              message: `${storeLabel}：Shopify GraphQL 限流，额度恢复中，预计 ${retrySeconds} 秒后重试。`,
              currentStore: storeLabel,
              currentProduct: null,
              shopifyThrottle: throttle,
            });
          },
          onCost: (throttle) => {
            updatePreviewProgress(previewJob, {
              shopifyThrottle: throttle,
            });
          },
        });
        products = batch.products;
        storeAfter = batch.endCursor;
        storeHasNextPage = batch.hasNextPage;
        storeSkip = 0;
      } catch (err) {
        if (isAbortLikeError(err) || isPreviewJobCancelled(previewJob)) {
          stopped = true;
          stopReason = previewJob?.reason || "已强制停止";
          break;
        }
        const remainingForStore = limit - storeProcessed;
        progressCompleted = Math.min(progressTotal, progressCompleted + remainingForStore);
        updatePreviewProgress(previewJob, {
          phase: "fetching",
          completed: progressCompleted,
          percent: getProgressPercent(progressCompleted, progressTotal),
          message: `${storeLabel} 商品拉取失败，继续处理后续店铺。`,
          currentStore: storeLabel,
          currentProduct: null,
        });
        failures.push({
          title: storeLabel,
          error: `拉取店铺商品失败：${err instanceof Error ? err.message : String(err)}`,
        });
        break;
      }

      fetchedCount += products.length;
      if (!products.length && !storeHasNextPage) {
        progressTotal = Math.max(
          1,
          progressCompleted + (stores.length - storeIndex - 1) * limit,
        );
        updatePreviewProgress(previewJob, {
          phase: "fetching",
          total: progressTotal,
          percent: getProgressPercent(progressCompleted, progressTotal),
          message: `${storeLabel} 没有更多可处理商品。`,
          currentStore: storeLabel,
          currentProduct: null,
        });
        break;
      }
      if (!products.length) continue;

      updatePreviewProgress(previewJob, {
        phase: "generating",
        total: progressTotal,
        percent: getProgressPercent(progressCompleted, progressTotal),
        message: `${storeLabel} 已读取 ${products.length} 个商品，开始生成预览。`,
        currentStore: storeLabel,
        currentProduct: null,
      });

      for (const product of products) {
        if (isPreviewJobCancelled(previewJob)) {
          stopped = true;
          stopReason = previewJob?.reason || "已强制停止";
          break;
        }
        updatePreviewProgress(previewJob, {
          phase: "generating",
          message: `正在生成 ${storeLabel} / ${product.title || product.id} 的优化预览...`,
          currentStore: storeLabel,
          currentProduct: product.title || product.id,
        });
        try {
          proposals.push(
            await generateProductProposal({
              user: opts.user,
              deviceId: opts.deviceId,
              connection: store,
              product,
              prompt,
              targetFields,
              includeImages,
              model,
              signal: previewJob?.controller.signal,
            }),
          );
        } catch (err) {
          if (isPreviewJobCancelled(previewJob)) {
            stopped = true;
            stopReason = previewJob?.reason || "已强制停止";
            break;
          }
          failures.push({
            productId: product.id,
            title: `${storeLabel} / ${product.title || ""}`,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        progressCompleted = Math.min(progressTotal, progressCompleted + 1);
        updatePreviewProgress(previewJob, {
          phase: "generating",
          completed: progressCompleted,
          percent: getProgressPercent(progressCompleted, progressTotal),
          message: `已处理 ${progressCompleted}/${progressTotal} 个商品。`,
          currentStore: storeLabel,
          currentProduct: null,
        });
      }
      storeProcessed += products.length;
      if (stopped) break;
      if (products.length < batchLimit && !storeHasNextPage) {
        progressTotal = Math.max(
          1,
          progressCompleted + (stores.length - storeIndex - 1) * limit,
        );
        updatePreviewProgress(previewJob, {
          total: progressTotal,
          completed: Math.min(progressCompleted, progressTotal),
          percent: getProgressPercent(progressCompleted, progressTotal),
        });
        break;
      }
    }
      if (stopped) break;
  }

  if (!fetchedCount && !stopped) {
    const fetchFailures = failures.filter((item) =>
      item.error.startsWith("拉取店铺商品失败："),
    );
    const message = fetchFailures.length
      ? fetchFailures
          .map((item) => `${item.title || "店铺"}：${item.error}`)
          .join("；")
      : "没有找到可优化的 Shopify 商品。可以调整查询条件或勾选已优化商品。";
    updatePreviewProgress(previewJob, {
      phase: "failed",
      done: true,
      message,
      error: message,
      currentStore: null,
      currentProduct: null,
    });
    throw new Error(message);
  }

  const now = Date.now();
  const runId = createRunId();
  const runStores = stores.map((store) => ({
    key: store.key,
    name: store.name,
    shopDomain: store.shopDomain,
  }));
  const run: ProductBatchRunDocument = {
    id: runId,
    userId: opts.user.id,
    deviceId: opts.deviceId,
    createdAt: now,
    updatedAt: now,
    shopDomain: runStores[0]?.shopDomain || "",
    shopName: runStores[0]?.name || null,
    storeKeys: runStores.map((store) => store.key),
    stores: runStores,
    start,
    query,
    sortOrder,
    prompt,
    limit,
    model,
    targetFields,
    proposalCount: proposals.length,
    failureCount: failures.length,
    stopped,
    stopReason,
    rulesVersion: PRODUCT_BATCH_RULES.rulesVersion,
    includeImages,
    includeApplied,
    proposals,
    failures,
    lastApplyAt: null,
  };
  await writeProductBatchRun(run);
  updatePreviewProgress(previewJob, {
    phase: stopped ? "stopped" : "completed",
    done: true,
    cancelled: stopped,
    completed: stopped ? progressCompleted : Math.max(progressCompleted, progressTotal),
    total: progressTotal,
    percent: stopped ? getProgressPercent(progressCompleted, progressTotal) : 100,
    runId: run.id,
    error: null,
    message: stopped
      ? `已强制停止，已生成 ${proposals.length} 条预览。`
      : `任务完成，已生成 ${proposals.length} 条预览。`,
    currentStore: null,
    currentProduct: null,
  });
  return run;
}

export async function applyProductBatchRun(opts: {
  user: User;
  deviceId: string;
  runId: string;
  selectedProductIds?: string[];
  selectedProposalKeys?: string[];
  selectedStoreKeys?: string[];
  skipImageAlt?: boolean;
  applyFaq?: boolean;
  setDraft?: boolean;
}): Promise<{ run: ProductBatchRunDocument; results: ProductBatchApplyResult[] }> {
  const scope = { userId: opts.user.id, deviceId: opts.deviceId };
  const run = await readProductBatchRun(opts.runId, scope);
  const selectedStoreKeys = normalizeOptionalStoreKeys(opts.selectedStoreKeys);
  const stores = await requireStoreTokens(
    scope,
    selectedStoreKeys.length
      ? selectedStoreKeys
      : run.storeKeys?.length
        ? run.storeKeys
        : undefined,
  );
  const storeByKey = new Map(stores.map((store) => [store.key, store]));
  const storeByDomain = new Map(
    stores.map((store) => [normalizeShopDomainInput(store.shopDomain), store] as const),
  );

  const selectedProposalKeys = new Set(opts.selectedProposalKeys || []);
  const selectedProductIds = new Set(opts.selectedProductIds || []);
  let proposals = selectedProposalKeys.size
    ? run.proposals.filter((item) => selectedProposalKeys.has(getProposalKey(item)))
    : selectedProductIds.size
      ? run.proposals.filter((item) => selectedProductIds.has(item.product.id))
      : run.proposals;
  if (selectedStoreKeys.length) {
    proposals = proposals.filter((proposal) =>
      resolveProposalStoreConnection(proposal, storeByKey, storeByDomain),
    );
  }
  if (!proposals.length) {
    throw new Error("没有选中当前勾选店铺下可应用的商品。");
  }

  const results: ProductBatchApplyResult[] = [];
  for (const proposal of proposals) {
    const result: ProductBatchApplyResult = {
      storeKey: proposal.store.key,
      productId: proposal.product.id,
      title: proposal.product.title,
      ok: false,
    };
    try {
      const connection = resolveProposalStoreConnection(
        proposal,
        storeByKey,
        storeByDomain,
      );
      if (!connection) {
        throw new Error(
          `店铺 ${proposal.store.key || proposal.store.shopDomain || "未知"} 未在当前勾选店铺中绑定或 token 不存在。`,
        );
      }
      const targetFields = getProposalTargetFields(proposal, run.targetFields);
      assertProposalQuality(
        proposal.proposed,
        validateProposalQualityForTargetFields(proposal.proposed, targetFields),
        "写回前内容质量校验失败",
      );
      result.productUpdate = await updateProduct(connection, proposal, targetFields);
      if (targetFields.includes("faq") && opts.applyFaq !== false) {
        result.faqUpdate = await updateFaqMetafields(
          connection,
          proposal.product.id,
          proposal.proposed.faq,
        );
      }
      if (
        targetFields.includes("imageAltTexts") &&
        opts.skipImageAlt === false &&
        proposal.proposed.imageAltTexts.length
      ) {
        result.imageAltUpdate = await updateImageAltTexts(
          connection,
          proposal.proposed.imageAltTexts,
        );
      }
      const categoryMetafields = buildChangedCategoryMetafieldsSyncInput(
        proposal,
        targetFields,
      );
      if (Object.keys(categoryMetafields).length) {
        result.categoryMetafieldsUpdate = await updateCategoryMetafields(
          connection,
          proposal,
          categoryMetafields,
        );
        if (Object.prototype.hasOwnProperty.call(categoryMetafields, "categorySize")) {
          result.categorySizeUpdate = result.categoryMetafieldsUpdate;
        }
      }
      if (opts.setDraft) {
        result.draftUpdate = await updateProductStatus(
          connection,
          proposal.product.id,
          "DRAFT",
        );
      }
      if (targetFields.includes("tags")) {
        result.appliedTagUpdate = await markProductApplied(
          connection,
          proposal.product.id,
        );
      }
      result.ok = true;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }
    results.push(result);
  }

  run.updatedAt = Date.now();
  run.lastApplyAt = run.updatedAt;
  run.applyResults = [...(run.applyResults || []), ...results];
  await writeProductBatchRun(run);
  return { run, results };
}

function normalizeOptionalStoreKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = String(item || "").trim();
    if (!text) continue;
    const key = normalizeStoreKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

function resolveProposalStoreConnection(
  proposal: ProductBatchProposal,
  storeByKey: Map<string, ShopifyToken>,
  storeByDomain: Map<string, ShopifyToken>,
) {
  const key = String(proposal.store.key || "").trim();
  if (key) {
    const byKey = storeByKey.get(key);
    if (byKey) return byKey;
  }
  const domain = normalizeShopDomainInput(proposal.store.shopDomain || "");
  return storeByDomain.get(domain) || null;
}

async function requireStoreTokens(
  scope: ProductBatchScope,
  storeKeys?: string[],
): Promise<ShopifyToken[]> {
  const doc = await readStoresDocument();
  await refreshProductBatchStoreNames(doc, scope);
  const stores = getScopedStores(doc, scope);
  if (!stores.length) {
    throw new Error("请先在产品批量优化里添加 Shopify 店铺。");
  }
  const wanted = new Set((storeKeys || []).map(normalizeStoreKey));
  const records = wanted.size
    ? stores.filter((store) => wanted.has(store.key))
    : stores;
  if (!records.length) {
    throw new Error("没有找到选中的产品批量优化店铺。");
  }
  return records.map((store) => ({
    key: store.key,
    name: store.name,
    shopDomain: store.shopDomain,
    accessToken: getValidStoreAccessToken(store),
    apiVersion: store.apiVersion || SHOPIFY_API_VERSION,
    language: store.language || "en",
    market: store.market || "",
    brandVoice:
      store.brandVoice ||
      "Clear, trustworthy, product-focused, and conversion-oriented.",
  }));
}

function getValidStoreAccessToken(store: ProductBatchStoreRecord) {
  const expiresAtMs = store.tokenExpiresAt
    ? new Date(store.tokenExpiresAt).getTime()
    : store.tokenIssuedAt
      ? new Date(store.tokenIssuedAt).getTime() + PRODUCT_BATCH_TOKEN_TTL_MS
      : 0;
  if (!expiresAtMs || expiresAtMs <= Date.now()) {
    throw new Error(
      `店铺 ${store.name || store.shopDomain} 的 Shopify Token 已过期，请重新兑换后再读取商品。`,
    );
  }
  return decryptSecret(store.accessTokenEnc);
}

async function fetchProducts(opts: {
  connection: ShopifyToken;
  query: string;
  productTitleKeyword?: string;
  sortOrder: ProductBatchSortOrder;
  start: number;
  limit: number;
  after?: string | null;
  includeApplied: boolean;
  signal?: AbortSignal;
  onThrottle?: (throttle: ProductBatchShopifyThrottleProgress) => void;
  onCost?: (throttle: ProductBatchShopifyThrottleProgress) => void;
}): Promise<{
  products: ShopifyProductNode[];
  endCursor: string | null;
  hasNextPage: boolean;
}> {
  const products: ShopifyProductNode[] = [];
  let skipped = 0;
  let after: string | null = opts.after || null;
  let page = 0;
  let hasNextPage = true;
  const maxPages = Math.max(
    12,
    Math.ceil((opts.start + opts.limit) / SHOPIFY_PRODUCT_FETCH_BATCH_SIZE) + 2,
  );
  while (products.length < opts.limit && page < maxPages) {
    if (opts.signal?.aborted) throw new Error("已强制停止");
    page += 1;
    const pageData: ShopifyProductsQueryData =
      await shopifyGraphql<ShopifyProductsQueryData>(opts.connection, PRODUCTS_QUERY, {
      first: opts.productTitleKeyword
        ? SHOPIFY_PRODUCT_FETCH_BATCH_SIZE
        : Math.min(
            SHOPIFY_PRODUCT_FETCH_BATCH_SIZE,
            Math.max(1, opts.limit - products.length),
          ),
      after,
      query: opts.query || null,
      reverse: opts.sortOrder !== "oldest",
    }, opts.signal, {
      onThrottle: opts.onThrottle,
      onCost: opts.onCost,
    });
    const productsConnection = pageData.products;
    for (const edge of productsConnection.edges || []) {
      const product = edge.node;
      if (!opts.includeApplied && hasAppliedTag(product)) continue;
      if (opts.productTitleKeyword && !productTitleMatchesKeyword(product.title, opts.productTitleKeyword)) continue;
      if (skipped < opts.start) {
        skipped += 1;
        continue;
      }
      products.push(product);
      if (products.length >= opts.limit) break;
    }
    after = productsConnection.pageInfo?.endCursor || null;
    hasNextPage = Boolean(productsConnection.pageInfo?.hasNextPage && after);
    if (!hasNextPage) break;
  }
  return {
    products,
    endCursor: after,
    hasNextPage,
  };
}

async function generateProductProposal(opts: {
  user: User;
  deviceId: string;
  connection: ShopifyToken;
  product: ShopifyProductNode;
  prompt: string;
  targetFields: ProductBatchTargetField[];
  includeImages: boolean;
  model: string;
  signal?: AbortSignal;
}): Promise<ProductBatchProposal> {
  if (opts.signal?.aborted) {
    throw new Error("已强制停止");
  }
  const images = getProductImages(opts.product).slice(0, 8);
  const current = getCurrentSnapshot(opts.product, images);
  const forbiddenFields = getForbiddenTargetFields(opts.targetFields);
  const targetCategoryMetafieldKeys = detectTargetCategoryMetafieldKeys(opts.prompt);
  const categoryMetafieldCandidateContext =
    await loadProductBatchCategoryMetafieldCandidates({
      user: opts.user,
      deviceId: opts.deviceId,
      connection: opts.connection,
      product: opts.product,
      targetKeys: targetCategoryMetafieldKeys,
      targetFields: opts.targetFields,
    });
  const categoryMetafieldCandidates = categoryMetafieldCandidateContext.candidates;
  const promptData = {
    store: {
      key: opts.connection.key,
      name: opts.connection.name || opts.connection.shopDomain,
      shopDomain: opts.connection.shopDomain,
      language: "English",
      market: opts.connection.market || "Global ecommerce",
      brandVoice:
        opts.connection.brandVoice ||
        "clean, factual, conversion-oriented",
    },
    currentProduct: {
      id: opts.product.id,
      title: opts.product.title,
      handle: opts.product.handle,
      vendor: opts.product.vendor,
      productType: opts.product.productType,
      status: opts.product.status,
      categoryId: opts.product.category?.id || "",
      tags: opts.product.tags || [],
      seo: opts.product.seo || {},
      faq: getProductFaq(opts.product),
      categoryMetafields: getProductCategoryMetafields(opts.product),
      templateStyle: opts.product.templateSuffix || "",
      descriptionHtml: truncate(opts.product.descriptionHtml || "", 7000),
      images: images.map((image) => ({
        mediaId: image.mediaId,
        url: opts.includeImages ? image.url : "",
        existingAltText: image.altText,
        width: image.width || null,
        height: image.height || null,
      })),
    },
    currentSnapshot: current,
    rules: PRODUCT_BATCH_RULES,
    targetFields: opts.targetFields,
    forbiddenFields,
    targetFieldInstruction:
      "Only optimize and change fields listed in targetFields. Fields listed in forbiddenFields must be copied exactly from currentSnapshot/currentProduct and must not be rewritten, translated, reordered, expanded, or polished.",
    categoryMetafieldInstruction: buildCategoryMetafieldPromptInstruction(
      opts.prompt,
      categoryMetafieldCandidates,
    ),
    complianceExamples: [
      {
        userInstruction: "优化标题和 FAQ",
        targetFields: ["title", "faq"],
        correct:
          "Rewrite only title and faq. Copy descriptionHtml, seoTitle, metaDescription, tags, templateStyle, categorySize, imageAltTexts, and handle from the original values.",
        wrong:
          "Changing descriptionHtml, seoTitle, metaDescription, tags, imageAltTexts, or any other field not listed in targetFields.",
      },
      {
        userInstruction: "只优化图片 Alt",
        targetFields: ["imageAltTexts"],
        correct:
          "Rewrite only imageAltTexts. Copy title, descriptionHtml, seoTitle, metaDescription, tags, templateStyle, categorySize, faq, and handle from the original values.",
        wrong:
          "Improving title, SEO title, Meta description, description, tags, or FAQ because they look related.",
      },
    ],
    customInstructions: opts.prompt,
    finalInstruction:
      "Return complete JSON for the schema, but only targetFields may differ from the original product. Repeat: forbiddenFields must be exact original-value placeholders.",
  };

  const client = buildGenaiClient();
  let response: Awaited<ReturnType<typeof client.models.generateContent>>;
  try {
    response = await abortable(
      retryWithBackoff(
        async () => {
          await acquireToken(opts.model);
          return client.models.generateContent({
            model: opts.model,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text:
                      "Rewrite this Shopify product for SEO and GEO. Return only JSON that matches the schema. Obey targetFields and forbiddenFields strictly.\n\n" +
                      JSON.stringify(promptData, null, 2) +
                      "\n\nFinal reminder: only targetFields may change; forbiddenFields must stay exactly as currentSnapshot/currentProduct.",
                  },
                ],
              },
            ],
            config: {
              systemInstruction: PRODUCT_BATCH_SYSTEM_PROMPT,
              responseMimeType: "application/json",
              responseSchema: PRODUCT_BATCH_OUTPUT_SCHEMA,
              temperature: 0.15,
            },
          });
        },
        {
          maxRetries: 3,
          initialDelayMs: 2500,
          maxDelayMs: 20_000,
          onRetry: (err, attempt, delayMs) => {
            console.warn(
              `[product-batch] model retry ${attempt} in ${Math.round(delayMs)}ms: ${formatModelError(err)}`,
            );
          },
        },
      ),
      opts.signal,
      "已强制停止",
    );
    if (opts.signal?.aborted) {
      throw new Error("已强制停止");
    }
    recordUsage({
      userId: opts.user.id,
      model: opts.model,
      feature: "other",
      usageMetadata: response.usageMetadata as never,
      success: true,
      notes: {
        kind: "product-batch-optimization",
        shopDomain: opts.connection.shopDomain,
        productId: opts.product.id,
      },
    });
  } catch (err) {
    recordUsage({
      userId: opts.user.id,
      model: opts.model,
      feature: "other",
      success: false,
      error: formatModelError(err),
      notes: {
        kind: "product-batch-optimization",
        shopDomain: opts.connection.shopDomain,
        productId: opts.product.id,
      },
    });
    throw new Error(formatModelError(err));
  }

  const rawText = response.text || "";
  let raw: Record<string, unknown>;
  try {
    raw = parseJsonObject(rawText);
  } catch (err) {
    const debugPath = await writeProductBatchJsonFailure({
      userId: opts.user.id,
      model: opts.model,
      shopDomain: opts.connection.shopDomain,
      productId: opts.product.id,
      productTitle: opts.product.title || "",
      rawText,
      error: err,
    });
    const suffix = debugPath ? `；完整返回已保存：${debugPath}` : "";
    throw new Error(`${err instanceof Error ? err.message : String(err)}${suffix}`);
  }
  const categoryResolutionWarnings: string[] = [];
  let proposed = constrainProposalToTargetFields(
    resolveCategoryMetafieldsAgainstBackendCandidates(
      normalizeGeneratedProposal(raw, opts.product, images, opts.prompt),
      opts.prompt,
      categoryMetafieldCandidates,
      current.categoryMetafields,
      categoryResolutionWarnings,
    ),
    current,
    opts.targetFields,
  );
  let qualityIssues = validateProposalQualityForTargetFields(
    proposed,
    opts.targetFields,
  );
  let repairedForQuality = false;
  if (qualityIssues.length) {
    proposed = constrainProposalToTargetFields(
      resolveCategoryMetafieldsAgainstBackendCandidates(
        await repairProposalCompleteness({
          user: opts.user,
          connection: opts.connection,
          product: opts.product,
          images,
          prompt: opts.prompt,
          model: opts.model,
          proposed,
          issues: qualityIssues,
          targetFields: opts.targetFields,
          signal: opts.signal,
        }),
        opts.prompt,
        categoryMetafieldCandidates,
        current.categoryMetafields,
        categoryResolutionWarnings,
      ),
      current,
      opts.targetFields,
    );
    repairedForQuality = true;
    qualityIssues = validateProposalQualityForTargetFields(
      proposed,
      opts.targetFields,
    );
  }
  assertProposalQuality(
    proposed,
    qualityIssues,
    "模型生成内容质量校验失败",
  );

  return {
    store: {
      key: opts.connection.key,
      name: opts.connection.name,
      shopDomain: opts.connection.shopDomain,
      language: "English",
      market: opts.connection.market || "Global ecommerce",
    },
    product: {
      id: opts.product.id,
      legacyResourceId: opts.product.legacyResourceId
        ? String(opts.product.legacyResourceId)
        : "",
      handle: opts.product.handle || "",
      title: opts.product.title || "",
      status: opts.product.status || "",
      categoryId: opts.product.category?.id || "",
    },
    current,
    proposed,
    targetFields: opts.targetFields,
    targetCategoryMetafieldKeys,
    changeSummary: summarizeChanges(current, proposed, opts.targetFields),
    rationale: cleanText(String(raw.rationale || "")),
    warnings: [
      ...normalizeStringArray(raw.warnings),
      ...categoryMetafieldCandidateContext.warnings,
      ...categoryResolutionWarnings,
      ...(repairedForQuality
        ? ["已自动修复生成内容中的残句、非英文内容或类别尺寸格式，写回前会再次校验。"]
        : []),
    ].slice(0, 8),
  };
}

async function repairProposalCompleteness(opts: {
  user: User;
  connection: ShopifyToken;
  product: ShopifyProductNode;
  images: ProductBatchImageSnapshot[];
  prompt: string;
  model: string;
  proposed: ProductBatchProposed;
  issues: ProductBatchCompletenessIssue[];
  targetFields: ProductBatchTargetField[];
  signal?: AbortSignal;
}): Promise<ProductBatchProposed> {
  if (opts.signal?.aborted) {
    throw new Error("已强制停止");
  }
  const currentSnapshot = getCurrentSnapshot(opts.product, opts.images);
  const forbiddenFields = getForbiddenTargetFields(opts.targetFields);
  const repairData = {
    store: {
      shopDomain: opts.connection.shopDomain,
      language: "English",
      market: opts.connection.market || "Global ecommerce",
      brandVoice: opts.connection.brandVoice || "clean, factual, conversion-oriented",
    },
    currentProduct: {
      id: opts.product.id,
      title: opts.product.title,
      handle: opts.product.handle,
      vendor: opts.product.vendor,
      productType: opts.product.productType,
      tags: opts.product.tags || [],
      seo: opts.product.seo || {},
      descriptionText: getDescriptionParagraphTexts(opts.product.descriptionHtml || ""),
      faq: getProductFaq(opts.product),
      categorySize: getProductCategorySize(opts.product),
      categoryMetafields: getProductCategoryMetafields(opts.product),
      templateStyle: opts.product.templateSuffix || "",
      images: opts.images.map((image) => ({
        mediaId: image.mediaId,
        existingFilename: image.filename,
        existingAltText: image.altText,
        url: image.url,
      })),
    },
    currentSnapshot,
    proposed: opts.proposed,
    qualityIssues: opts.issues,
    rules: PRODUCT_BATCH_RULES,
    targetFields: opts.targetFields,
    forbiddenFields,
    targetFieldInstruction:
      "Repair only fields listed in targetFields. Fields listed in forbiddenFields must remain exact original-value placeholders from currentSnapshot/currentProduct.",
    customInstructions: opts.prompt,
  };

  const client = buildGenaiClient();
  try {
    const response = await abortable(
      retryWithBackoff(
        async () => {
          await acquireToken(opts.model);
          return client.models.generateContent({
            model: opts.model,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text:
                      "Repair the incomplete, non-English, or incorrectly formatted Shopify product optimization JSON. Return only the repaired JSON. Obey targetFields and forbiddenFields strictly.\n\n" +
                      JSON.stringify(repairData, null, 2) +
                      "\n\nFinal reminder: repair targetFields only; forbiddenFields must stay exactly as currentSnapshot/currentProduct.",
                  },
                ],
              },
            ],
            config: {
              systemInstruction: PRODUCT_BATCH_REPAIR_SYSTEM_PROMPT,
              responseMimeType: "application/json",
              responseSchema: PRODUCT_BATCH_OUTPUT_SCHEMA,
              temperature: 0.05,
            },
          });
        },
        {
          maxRetries: 2,
          initialDelayMs: 1500,
          maxDelayMs: 12_000,
          onRetry: (err, attempt, delayMs) => {
            console.warn(
              `[product-batch] quality repair retry ${attempt} in ${Math.round(delayMs)}ms: ${formatModelError(err)}`,
            );
          },
        },
      ),
      opts.signal,
      "已强制停止",
    );
    if (opts.signal?.aborted) {
      throw new Error("已强制停止");
    }
    recordUsage({
      userId: opts.user.id,
      model: opts.model,
      feature: "other",
      usageMetadata: response.usageMetadata as never,
      success: true,
      notes: {
        kind: "product-batch-quality-repair",
        shopDomain: opts.connection.shopDomain,
        productId: opts.product.id,
        issueCount: opts.issues.length,
      },
    });
    const repairedRaw = parseJsonObject(response.text || "");
    return normalizeGeneratedProposal(
      { ...opts.proposed, ...repairedRaw },
      opts.product,
      opts.images,
      opts.prompt,
    );
  } catch (err) {
    recordUsage({
      userId: opts.user.id,
      model: opts.model,
      feature: "other",
      success: false,
      error: formatModelError(err),
      notes: {
        kind: "product-batch-quality-repair",
        shopDomain: opts.connection.shopDomain,
        productId: opts.product.id,
        issueCount: opts.issues.length,
      },
    });
    throw new Error(`自动修复内容质量失败：${formatModelError(err)}`);
  }
}
function getCurrentSnapshot(
  product: ShopifyProductNode,
  images: ProductBatchImageSnapshot[],
): ProductBatchSnapshot {
  return {
    title: product.title || "",
    handle: product.handle || "",
    descriptionHtml: product.descriptionHtml || "",
    seoTitle: product.seo?.title || "",
    metaDescription: product.seo?.description || "",
    categorySize: getProductCategorySize(product),
    categoryMetafields: getProductCategoryMetafields(product),
    templateStyle: normalizeProductTemplateStyle(product.templateSuffix || ""),
    tags: product.tags || [],
    faq: getProductFaq(product),
    imageAltTexts: images,
  };
}

function normalizeGeneratedProposal(
  raw: Record<string, unknown>,
  product: ShopifyProductNode,
  images: ProductBatchImageSnapshot[],
  prompt: string,
): ProductBatchProposed {
  const limits = PRODUCT_BATCH_RULES.contentRules;
  const imageIds = new Set(images.map((image) => image.mediaId));
  const imageById = new Map(
    images.map((image, index) => [image.mediaId, { image, index }]),
  );
  const proposedTitle = clampText(
    String(raw.title || product.title || ""),
    limits.productTitleMaxChars,
  );
  const targetFields = detectTargetFieldsFromPrompt(prompt);
  const filenameTitle = targetFields.includes("title")
    ? proposedTitle
    : String(product.title || "");
  const imageAltTexts = Array.isArray(raw.imageAltTexts)
    ? raw.imageAltTexts
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => {
          const mediaId = cleanText(String(item.mediaId || ""));
          const source = imageById.get(mediaId);
          return {
            mediaId,
            altText: clampText(
              String(item.altText || ""),
              limits.imageAltTextMaxChars,
            ),
            filename: source
              ? buildProductImageFilename(
                  filenameTitle,
                  source.index,
                  source.image.url,
                )
              : undefined,
          };
        })
        .filter((item) => imageIds.has(item.mediaId) && item.altText)
    : [];

  const faq = Array.isArray(raw.faq)
    ? raw.faq
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          question: cleanInlineText(String(item.question || "")),
          answer: cleanInlineText(String(item.answer || "")),
        }))
        .filter((item) => item.question && item.answer)
        .slice(0, 5)
    : [];

  const descriptionHtml = cleanDescriptionHtml(
    String(raw.descriptionHtml || product.descriptionHtml || ""),
    limits.descriptionHtmlAllowedTags,
  );

  const currentCategorySize = getProductCategorySize(product);
  const currentCategoryMetafields = getProductCategoryMetafields(product);
  const promptCategorySizeOptions = extractPromptCategorySizeOptions(prompt);
  const currentCategorySizeOptions = parseSizeOptions(currentCategorySize);
  const categorySize = normalizeCategorySize(
    String(raw.categorySize || currentCategorySize || ""),
    {
      promptOptions: promptCategorySizeOptions,
      currentOptions: currentCategorySizeOptions,
      fallback: currentCategorySize,
    },
  );
  const categoryMetafields = normalizeCategoryMetafields(
    raw.categoryMetafields,
    currentCategoryMetafields,
    prompt,
    categorySize,
    product,
  );

  return normalizeProposalCompleteness({
    title: proposedTitle,
    handle:
      normalizeProductHandle(raw.handle || raw.title) ||
      normalizeProductHandle(product.handle),
    descriptionHtml,
    seoTitle: composeSeoTitle(raw, product, limits.seoTitleMaxChars),
    metaDescription: composeMetaDescription(
      raw,
      product,
      limits.metaDescriptionMaxChars,
    ),
    categorySize,
    categoryMetafields,
    templateStyle: normalizeProductTemplateStyle(
      String(raw.templateStyle ?? product.templateSuffix ?? ""),
    ),
    tags: stripAppliedTag(normalizeTags(raw.tags, product.tags || [])),
    imageAltTexts,
    faq,
  });
}

function composeSeoTitle(
  raw: Record<string, unknown>,
  product: ShopifyProductNode,
  maxChars: number,
) {
  const phrases = uniqueNonEmpty([
    ...normalizeStringArray(raw.seoTitlePhrases),
    ...splitTitlePhraseCandidates(raw.seoTitle),
    ...splitTitlePhraseCandidates(product.title || ""),
  ]).map(normalizeSeoTitlePhrase).filter(Boolean);

  let title = "";
  for (const phrase of phrases) {
    const next = title ? `${title} - ${phrase}` : phrase;
    if (next.length <= maxChars) title = next;
  }

  const fallback = normalizeSeoTitlePhrase(raw.seoTitle || product.title || "");
  return clampTextToWordBoundary(title || fallback, maxChars);
}

function composeMetaDescription(
  raw: Record<string, unknown>,
  product: ShopifyProductNode,
  maxChars: number,
) {
  const candidates = uniqueNonEmpty([
    ...normalizeStringArray(raw.metaDescriptionSentences),
    ...splitSentenceCandidates(raw.metaDescription),
    ...splitSentenceCandidates(product.seo?.description || ""),
  ])
    .map((sentence) => normalizeCompleteSentenceText(sentence, maxChars))
    .filter((sentence) => sentence && hasSentenceTerminal(sentence, false) && !hasDanglingEnding(sentence));

  let description = "";
  for (const sentence of candidates) {
    const next = description ? `${description} ${sentence}` : sentence;
    if (next.length <= maxChars) description = next;
  }

  if (description) return description;
  return normalizeCompleteSentenceText(
    String(raw.metaDescription || product.seo?.description || product.title || ""),
    maxChars,
  );
}

function splitTitlePhraseCandidates(value: unknown) {
  return cleanInlineText(String(value || ""))
    .split(/\s*(?:\||,|，|;|；|:)\s*|\s+[-–—]\s+/u)
    .map((part) => cleanInlineText(part))
    .filter(Boolean);
}

function normalizeSeoTitlePhrase(value: unknown) {
  let text = cleanInlineText(String(value || ""))
    .replace(/[.!?。！？]+$/u, "")
    .replace(/[\s,;:，；：、\-–—]+$/u, "");
  for (let index = 0; index < 5 && hasDanglingEnding(text); index += 1) {
    const next = text.replace(/\s+\S+$/u, "").trim();
    if (!next || next === text) break;
    text = next.replace(/[\s,;:，；：、\-–—]+$/u, "");
  }
  return text;
}

function splitSentenceCandidates(value: unknown) {
  const text = cleanInlineText(String(value || ""));
  if (!text) return [];
  const matches = Array.from(text.matchAll(/[^.!?。！？]+[.!?。！？]+(?:["'）)\]}]+)?/g))
    .map((match) => cleanInlineText(match[0]))
    .filter(Boolean);
  return matches.length ? matches : [text];
}

function uniqueNonEmpty(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = cleanInlineText(value || "");
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function normalizeProposalCompleteness(proposed: ProductBatchProposed): ProductBatchProposed {
  const limits = PRODUCT_BATCH_RULES.contentRules;
  return {
    ...proposed,
    title: clampTextToWordBoundary(proposed.title, limits.productTitleMaxChars),
    seoTitle: clampTextToWordBoundary(proposed.seoTitle, limits.seoTitleMaxChars),
    metaDescription: normalizeCompleteSentenceText(
      proposed.metaDescription,
      limits.metaDescriptionMaxChars,
    ),
    imageAltTexts: proposed.imageAltTexts.map((item) => ({
      mediaId: item.mediaId,
      altText: normalizeCompleteSentenceText(
        item.altText,
        limits.imageAltTextMaxChars,
      ),
      filename: normalizeFileName(item.filename || ""),
    })).filter((item) => item.mediaId && item.altText),
    faq: proposed.faq.map((item) => ({
      question: normalizeQuestionText(item.question),
      answer: normalizeCompleteSentenceText(item.answer, 500),
    })).filter((item) => item.question && item.answer),
  };
}

function validateProposalCompleteness(
  proposed: ProductBatchProposed,
): ProductBatchCompletenessIssue[] {
  const issues: ProductBatchCompletenessIssue[] = [];
  addTextCompletenessIssue(issues, "title", proposed.title, {
    required: true,
    requireTerminal: false,
  });
  addTextCompletenessIssue(issues, "seoTitle", proposed.seoTitle, {
    required: true,
    requireTerminal: false,
  });
  addTextCompletenessIssue(issues, "metaDescription", proposed.metaDescription, {
    required: true,
    requireTerminal: true,
  });

  const descriptionParts = getDescriptionParagraphTexts(proposed.descriptionHtml);
  if (!descriptionParts.length) {
    issues.push({ field: "descriptionHtml", message: "商品描述为空或无法读取。" });
  }
  descriptionParts.forEach((part, index) => {
    addTextCompletenessIssue(issues, `descriptionHtml[${index + 1}]`, part, {
      required: true,
      requireTerminal: true,
    });
  });

  proposed.faq.forEach((item, index) => {
    addTextCompletenessIssue(issues, `faq[${index + 1}].question`, item.question, {
      required: true,
      requireTerminal: true,
      question: true,
    });
    addTextCompletenessIssue(issues, `faq[${index + 1}].answer`, item.answer, {
      required: true,
      requireTerminal: true,
    });
  });

  proposed.imageAltTexts.forEach((item, index) => {
    addTextCompletenessIssue(issues, `imageAltTexts[${index + 1}]`, item.altText, {
      required: true,
      requireTerminal: true,
    });
  });

  return issues.slice(0, 24);
}

function validateProposalQuality(
  proposed: ProductBatchProposed,
): ProductBatchCompletenessIssue[] {
  return [
    ...validateProposalCompleteness(proposed),
    ...validateProposalEnglish(proposed),
    ...validateProposalCategorySize(proposed),
  ].slice(0, 32);
}

function validateProposalQualityForTargetFields(
  proposed: ProductBatchProposed,
  targetFields: ProductBatchTargetField[],
): ProductBatchCompletenessIssue[] {
  const targets = new Set(targetFields);
  return validateProposalQuality(proposed).filter((issue) =>
    targets.has(getIssueTargetField(issue.field)),
  );
}

function getIssueTargetField(field: string): ProductBatchTargetField {
  if (field.startsWith("descriptionHtml")) return "descriptionHtml";
  if (field.startsWith("seoTitle")) return "seoTitle";
  if (field.startsWith("metaDescription")) return "metaDescription";
  if (field.startsWith("categorySize")) return "categorySize";
  if (field.startsWith("categoryMetafields")) return "categoryMetafields";
  if (field.startsWith("templateStyle")) return "templateStyle";
  if (field.startsWith("imageAltTexts")) return "imageAltTexts";
  if (field.startsWith("faq")) return "faq";
  if (field.startsWith("tags")) return "tags";
  return "title";
}

function validateProposalEnglish(
  proposed: ProductBatchProposed,
): ProductBatchCompletenessIssue[] {
  const issues: ProductBatchCompletenessIssue[] = [];
  addEnglishLanguageIssue(issues, "title", proposed.title);
  addEnglishLanguageIssue(issues, "seoTitle", proposed.seoTitle);
  addEnglishLanguageIssue(issues, "metaDescription", proposed.metaDescription);

  getDescriptionParagraphTexts(proposed.descriptionHtml).forEach((part, index) => {
    addEnglishLanguageIssue(issues, `descriptionHtml[${index + 1}]`, part);
  });

  proposed.tags.forEach((tag, index) => {
    if (!shouldPreserveTag(tag)) {
      addEnglishLanguageIssue(issues, `tags[${index + 1}]`, tag);
    }
  });

  proposed.faq.forEach((item, index) => {
    addEnglishLanguageIssue(issues, `faq[${index + 1}].question`, item.question);
    addEnglishLanguageIssue(issues, `faq[${index + 1}].answer`, item.answer);
  });

  proposed.imageAltTexts.forEach((item, index) => {
    addEnglishLanguageIssue(issues, `imageAltTexts[${index + 1}]`, item.altText);
  });

  for (const def of PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS) {
    if (def.key === "size") continue;
    addEnglishLanguageIssue(
      issues,
      `categoryMetafields.${def.key}`,
      proposed.categoryMetafields?.[def.key] || "",
    );
    if (def.baseKey) {
      addEnglishLanguageIssue(
        issues,
        `categoryMetafields.${def.baseKey}`,
        proposed.categoryMetafields?.[def.baseKey] || "",
      );
    }
  }

  return issues;
}

function validateProposalCategorySize(
  proposed: ProductBatchProposed,
): ProductBatchCompletenessIssue[] {
  const text = cleanInlineText(proposed.categorySize || "");
  if (!text) return [];
  if (/^[0-9\s,，、/.-]+$/u.test(text) && parseSizeOptions(text).length) return [];
  return [{
    field: "categorySize",
    message: "类别元字段尺寸只能使用阿拉伯数字列表。",
    value: text,
  }];
}

function addEnglishLanguageIssue(
  issues: ProductBatchCompletenessIssue[],
  field: string,
  value: string,
) {
  const text = cleanInlineText(value || "");
  if (!text) return;
  if (hasCjkText(text)) {
    issues.push({ field, message: "包含中文或 CJK 字符，必须改为英文。", value: text });
    return;
  }
  if (!isLikelyEnglishText(text)) {
    issues.push({ field, message: "疑似非英文内容，必须改为英文。", value: text });
  }
}

function hasCjkText(value: string) {
  return /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/u.test(value);
}

function isLikelyEnglishText(value: string) {
  const text = cleanInlineText(value)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/&[a-z]+;/gi, " ");
  const letters = text.match(/\p{L}/gu) || [];
  if (!letters.length) return true;
  const latinLetters = text.match(/\p{Script=Latin}/gu) || [];
  return latinLetters.length / letters.length >= 0.9;
}

function assertProposalQuality(
  proposed: ProductBatchProposed,
  issues = validateProposalQuality(proposed),
  context = "内容质量校验失败",
) {
  if (!issues.length) return;
  throw new Error(`${context}：${formatCompletenessIssues(issues)}`);
}

function assertProposalCompleteness(
  proposed: ProductBatchProposed,
  issues = validateProposalCompleteness(proposed),
  context = "内容完整性校验失败",
) {
  if (!issues.length) return;
  throw new Error(`${context}：${formatCompletenessIssues(issues)}`);
}

function addTextCompletenessIssue(
  issues: ProductBatchCompletenessIssue[],
  field: string,
  value: string,
  opts: { required?: boolean; requireTerminal?: boolean; question?: boolean },
) {
  const text = cleanInlineText(value || "");
  if (!text) {
    if (opts.required) issues.push({ field, message: "内容为空。" });
    return;
  }
  if (opts.question) {
    if (hasDanglingQuestionEnding(text)) {
      issues.push({ field, message: "问题以未完成的连接词或残句结尾。", value: text });
      return;
    }
    if (opts.requireTerminal && !hasSentenceTerminal(text, true)) {
      issues.push({ field, message: "问题缺少问号结尾。", value: text });
    }
    return;
  }
  if (hasDanglingEnding(text)) {
    issues.push({ field, message: "内容以未完成的连接词或残句结尾。", value: text });
    return;
  }
  if (opts.requireTerminal && !hasSentenceTerminal(text, false)) {
    issues.push({ field, message: "内容缺少完整句子结尾。", value: text });
  }
}

function formatCompletenessIssues(issues: ProductBatchCompletenessIssue[]) {
  return issues
    .slice(0, 8)
    .map((issue) => `${issue.field} ${issue.message}`)
    .join("；");
}

function normalizeCompleteSentenceText(value: string, maxChars: number) {
  const text = clampTextToCompleteBoundary(value, maxChars);
  if (!text) return text;
  if (hasSentenceTerminal(text, false) && !hasDanglingEnding(text)) return text;
  const repaired = trimDanglingTextTail(text);
  return appendTerminalMark(repaired || text, ".", maxChars);
}

function normalizeQuestionText(value: string) {
  const text = clampTextToCompleteBoundary(value, 220);
  if (!text || hasSentenceTerminal(text, true) || hasDanglingEnding(text)) return text;
  return appendTerminalMark(text, "?", 220);
}
function trimDanglingTextTail(value: string) {
  let text = cleanInlineText(value).replace(/[\s,;:，；：、\-–—]+$/u, "");
  for (let index = 0; index < 8 && hasDanglingEnding(text); index += 1) {
    const next = text.replace(/\s+\S+$/u, "").trim();
    if (!next || next === text) break;
    text = next.replace(/[\s,;:，；：、\-–—]+$/u, "");
  }
  return text;
}

function clampTextToWordBoundary(value: string, maxChars: number) {
  const text = cleanInlineText(value);
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars).trim();
  return cut.replace(/[\s,;:，；：、\-–—]+\S*$/, "").trim() || cut;
}

function clampTextToCompleteBoundary(value: string, maxChars: number) {
  const text = cleanInlineText(value);
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars).trim();
  const sentenceEnd = findLastSentenceEnd(cut);
  if (sentenceEnd >= Math.max(30, Math.floor(maxChars * 0.45))) {
    return cut.slice(0, sentenceEnd + 1).trim();
  }
  return clampTextToWordBoundary(cut, maxChars);
}

function findLastSentenceEnd(value: string) {
  let last = -1;
  for (const match of value.matchAll(/[.!?。！？]/g)) {
    last = match.index ?? last;
  }
  return last;
}

function appendTerminalMark(value: string, mark: "." | "?", maxChars: number) {
  const cleaned = value.replace(/[\s,;:，；：、\-–—]+$/u, "");
  if (cleaned.length + mark.length <= maxChars) return `${cleaned}${mark}`;
  const shortened = clampTextToWordBoundary(cleaned, Math.max(1, maxChars - mark.length));
  return shortened ? `${shortened}${mark}` : cleaned;
}

function hasSentenceTerminal(value: string, questionOnly: boolean) {
  const text = cleanInlineText(value).replace(/["'）)\]}]+$/u, "");
  return questionOnly ? /[?？]$/.test(text) : /[.!?。！？]$/.test(text);
}
function hasDanglingQuestionEnding(value: string) {
  const text = cleanInlineText(value)
    .replace(/[?？"'）)\]}]+$/u, "")
    .trim();
  if (!text) return true;
  if (/[,;:，；：、\-–—]$/u.test(text)) return true;
  return /\b(?:and|or|but|because|including|featuring|plus|via|using|that|which|while)\s*$/i.test(text);
}

function hasDanglingEnding(value: string) {
  const source = cleanInlineText(value);
  if (!source) return true;
  const text = source
    .replace(/[.!?。！？"'）)\]}]+$/u, "")
    .trim();
  if (!text) return true;
  if (/[,:;，：；、\-–—]$/u.test(text)) return true;
  return /\b(?:and|or|but|with|without|for|to|of|in|on|at|by|from|as|that|which|while|because|including|featuring|made|crafted|designed|suitable|ideal|perfect|plus|via|using|into|over|under|between|through|about|toward|towards|the|a|an|its|their|your|our|is|are|was|were|be|being|been|has|have|had|can|will|would|should|may|might|must)\s*$/i.test(text);
}

function getDescriptionParagraphTexts(html: string) {
  const source = String(html || "");
  const matches = Array.from(source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => htmlToPlainText(match[1]))
    .filter(Boolean);
  if (matches.length) return matches;
  const plain = htmlToPlainText(source);
  return plain
    .split(/\n{2,}/)
    .map((part) => cleanInlineText(part))
    .filter(Boolean);
}

function htmlToPlainText(html: string) {
  return cleanInlineText(
    String(html || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'"),
  );
}
function extractPromptCategorySizeOptions(prompt: string): string[] {
  const text = cleanInlineText(prompt || "");
  if (!text) return [];
  const match = text.match(
    /(?:category\s*size|类别元字段尺寸|类别元字段中的尺寸|尺寸)\s*(?:为|是|=|：|:)?\s*([0-9\s,，、/.-]{1,180})/i,
  );
  if (!match) return [];
  return parseSizeOptions(match[1]);
}

function parseSizeOptions(value: string): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  const matches = cleanInlineText(value || "").match(/\d+(?:\.\d+)?/g) || [];
  for (const match of matches) {
    const option = match.replace(/\.0+$/, "");
    if (!seen.has(option)) {
      seen.add(option);
      options.push(option);
    }
  }
  return options;
}

function normalizeProductTemplateStyle(value: unknown): string {
  const cleaned = cleanInlineText(String(value || ""));
  if (!cleaned) return "";
  if (/^(默认|默认产品|默认模板|default|default product)$/i.test(cleaned)) return "";
  if (cleaned.toLowerCase() === "product") return "";
  return cleaned.replace(/^product[.-]/i, "").trim();
}
function normalizeCategorySize(
  value: string,
  opts: {
    promptOptions: string[];
    currentOptions: string[];
    fallback: string;
  },
) {
  if (opts.promptOptions.length) {
    return opts.promptOptions.join(", ");
  }

  const cleaned = cleanInlineText(value || opts.fallback || "");
  const parsed = parseSizeOptions(cleaned);
  if (!opts.currentOptions.length) return parsed.join(", ");

  const allowed = new Set(opts.currentOptions);
  const kept = parsed.filter((size) => allowed.has(size));
  return kept.length ? kept.join(", ") : parseSizeOptions(opts.fallback || "").join(", ");
}

function normalizeCategoryMetafields(
  raw: unknown,
  current: ProductBatchCategoryMetafields,
  prompt: string,
  categorySize: string,
  product?: ShopifyProductNode,
): ProductBatchCategoryMetafields {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const keys = detectTargetCategoryMetafieldKeys(prompt);
  const result: ProductBatchCategoryMetafields = { ...current };

  if (categorySize) result.size = categorySize;
  for (const key of keys) {
    const def = PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS.find((item) => item.key === key);
    if (!def) continue;
    const rawValue = source[key] ?? source[def.shopifyField] ?? current[key] ?? "";
    if (key === "size") {
      result.size = normalizeCategorySize(String(rawValue || categorySize || ""), {
        promptOptions: extractPromptCategorySizeOptions(prompt),
        currentOptions: parseSizeOptions(current.size || categorySize || ""),
        fallback: current.size || categorySize || "",
      });
    } else {
      result[key] =
        normalizeCategoryMetafieldEnglishValue(key, rawValue) ||
        inferProductBatchCategoryMetafieldValue(key, product, prompt);
      if (def.baseKey) {
        const rawBaseValue =
          source[def.baseKey] ??
          (def.shopifyBaseValueField ? source[def.shopifyBaseValueField] : undefined) ??
          current[def.baseKey] ??
          "";
        result[def.baseKey] = normalizeCategoryMetafieldEnglishValue(key, rawBaseValue);
      }
    }
  }

  return pruneCategoryMetafields(result);
}

function cleanCategoryMetafieldValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanCategoryMetafieldValue(item))
      .filter(Boolean)
      .join(", ");
  }
  const cleaned = cleanInlineText(String(value || ""));
  return /^(null|undefined|none|n\/?a|not applicable)$/i.test(cleaned)
    ? ""
    : cleaned;
}

const CATEGORY_METAFIELD_ENGLISH_ALIASES: Partial<
  Record<ProductBatchCategoryMetafieldKey, Array<[RegExp, string]>>
> = {
  fabric: [
    [/欧根纱|organza/i, "Organza"],
    [/缎面|缎|satin/i, "Satin"],
    [/薄纱|网纱|tulle/i, "Tulle"],
    [/雪纺|chiffon/i, "Chiffon"],
    [/蕾丝|lace/i, "Lace"],
    [/天鹅绒|丝绒|velvet/i, "Velvet"],
    [/亮片|sequin/i, "Sequin"],
    [/绉|crepe/i, "Crepe"],
    [/真丝|桑蚕丝|silk/i, "Silk"],
    [/塔夫绸|taffeta/i, "Taffeta"],
    [/网布|mesh/i, "Mesh"],
    [/聚酯|涤纶|polyester/i, "Polyester Blend"],
  ],
  ageGroup: [
    [/成人|成年|adult/i, "Adult"],
    [/儿童|童装|kids?|children|child/i, "Kids"],
    [/青少年|少女|teen|junior/i, "Teen"],
  ],
  occasion: [
    [/派对|聚会|party/i, "Party"],
    [/舞会|prom/i, "Prom"],
    [/婚礼|婚宴|wedding/i, "Wedding"],
    [/新娘|婚纱|bridal/i, "Bridal"],
    [/伴娘|bridesmaid/i, "Bridesmaid"],
    [/正式|礼服|正装|formal/i, "Formal"],
    [/晚宴|晚礼服|evening/i, "Evening"],
    [/鸡尾酒|cocktail/i, "Cocktail"],
    [/返校|homecoming/i, "Homecoming"],
    [/毕业|graduation/i, "Graduation"],
  ],
  dressStyle: [
    [/a[ -]?line|a字|A字/i, "A-Line"],
    [/公主|princess/i, "Princess"],
    [/鱼尾|mermaid/i, "Mermaid"],
    [/蓬蓬裙|ball gown/i, "Ball Gown"],
    [/直筒|sheath/i, "Sheath"],
    [/高腰|empire/i, "Empire"],
    [/修身喇叭|fit[ -]?and[ -]?flare/i, "Fit and Flare"],
    [/紧身|bodycon/i, "Bodycon"],
    [/小号裙|trumpet/i, "Trumpet"],
  ],
  neckline: [
    [/甜心|sweetheart/i, "Sweetheart"],
    [/v领|v[ -]?neck/i, "V-Neck"],
    [/一字肩|off[ -]?the[ -]?shoulder|off shoulder/i, "Off-the-Shoulder"],
    [/抹胸|strapless/i, "Strapless"],
    [/挂脖|halter/i, "Halter"],
    [/方领|square neck/i, "Square Neck"],
    [/高领|high neck/i, "High Neck"],
    [/圆领|crew neck/i, "Crew Neck"],
    [/船领|bateau|boat neck/i, "Bateau Neck"],
  ],
  dressLengthType: [
    [/及地|拖地|floor[ -]?length|floor/i, "Floor Length"],
    [/踝长|maxi|ankle[ -]?length/i, "Maxi"],
    [/茶长|tea[ -]?length/i, "Tea Length"],
    [/中长|midi/i, "Midi"],
    [/及膝|knee[ -]?length/i, "Knee Length"],
    [/短款|迷你|mini|short dress/i, "Mini"],
  ],
  sleeveLengthType: [
    [/无袖|sleeveless/i, "Sleeveless"],
    [/长袖|long sleeve|long-sleeve/i, "Long Sleeve"],
    [/短袖|short sleeve|short-sleeve/i, "Short Sleeve"],
    [/盖袖|包肩|cap sleeve/i, "Cap Sleeve"],
    [/吊带|细肩带|spaghetti strap/i, "Spaghetti Strap"],
    [/七分袖|3\/4|three-quarter/i, "Three-Quarter Sleeve"],
    [/五分袖|elbow sleeve/i, "Elbow Sleeve"],
  ],
  targetGender: [
    [/女性|女士|女款|女$|female|women|woman|ladies|lady/i, "Female"],
    [/男性|男士|男款|男$|male|men|man/i, "Male"],
    [/中性|男女通用|unisex/i, "Unisex"],
    [/女童|girls?/i, "Girls"],
    [/男童|boys?/i, "Boys"],
  ],
};

function normalizeCategoryMetafieldEnglishValue(
  key: ProductBatchCategoryMetafieldKey,
  value: unknown,
): string {
  const parts = Array.isArray(value)
    ? value.map((item) => cleanCategoryMetafieldValue(item))
    : splitCategoryMetafieldCandidateValue(cleanCategoryMetafieldValue(value));
  const normalized = parts
    .map((part) => normalizeCategoryMetafieldEnglishPart(key, part))
    .filter(Boolean);
  return joinCategoryMetafieldCandidateValues(normalized);
}

function normalizeCategoryMetafieldEnglishPart(
  key: ProductBatchCategoryMetafieldKey,
  value: string,
): string {
  const text = cleanCategoryMetafieldValue(value);
  if (!text) return "";
  if (!hasCjkText(text) && isLikelyEnglishText(text)) return text;
  for (const [pattern, english] of CATEGORY_METAFIELD_ENGLISH_ALIASES[key] || []) {
    if (pattern.test(text)) return english;
  }
  return "";
}

function inferProductBatchCategoryMetafieldValue(
  key: ProductBatchCategoryMetafieldKey,
  product: ShopifyProductNode | undefined,
  prompt: string,
): string {
  const text = collectProductBatchCategoryInferenceText(product, prompt);
  const first = (patterns: Array<[RegExp, string]>, fallback = ""): string => {
    for (const [pattern, value] of patterns) {
      if (pattern.test(text)) return value;
    }
    return fallback;
  };

  switch (key) {
    case "fabric":
      return first(
        [
          [/\borganza\b/, "Organza"],
          [/\bsatin\b/, "Satin"],
          [/\btulle\b/, "Tulle"],
          [/\bchiffon\b/, "Chiffon"],
          [/\black?e\b/, "Lace"],
          [/\bvelvet\b/, "Velvet"],
          [/\bsequins?\b|\bsequined\b/, "Sequin"],
          [/\bcrepe\b/, "Crepe"],
          [/\bsilk\b/, "Silk"],
          [/\btaffeta\b/, "Taffeta"],
          [/\bmesh\b/, "Mesh"],
        ],
        "Dress Fabric",
      );
    case "ageGroup":
      return first(
        [
          [/\b(kids?|children|child|girls?|flower girl)\b/, "Kids"],
          [/\b(teens?|junior)\b/, "Teen"],
          [/\b(adult|women|woman|ladies|lady)\b/, "Adult"],
        ],
        "Adult",
      );
    case "occasion":
      return first(
        [
          [/\bprom\b/, "Prom"],
          [/\bwedding\b|\bbridal\b|\bbridesmaid\b/, "Wedding"],
          [/\bformal\b|\bgown\b|\bevening\b/, "Formal"],
          [/\bparty\b/, "Party"],
          [/\bcocktail\b/, "Cocktail"],
          [/\bhomecoming\b/, "Homecoming"],
          [/\bgraduation\b/, "Graduation"],
        ],
        "Formal",
      );
    case "dressStyle":
      return first(
        [
          [/\ba[ -]?line\b/, "A-Line"],
          [/\bprincess\b/, "Princess"],
          [/\bmermaid\b/, "Mermaid"],
          [/\bball gown\b/, "Ball Gown"],
          [/\bsheath\b/, "Sheath"],
          [/\bempire\b/, "Empire"],
          [/\bfit[ -]?and[ -]?flare\b/, "Fit and Flare"],
          [/\bbodycon\b/, "Bodycon"],
          [/\btrumpet\b/, "Trumpet"],
        ],
        "Dress",
      );
    case "neckline":
      return first(
        [
          [/\boff[ -]?the[ -]?shoulder\b|\boff shoulder\b/, "Off-the-Shoulder"],
          [/\bv[ -]?neck\b/, "V-Neck"],
          [/\bsweetheart\b/, "Sweetheart"],
          [/\bstrapless\b/, "Strapless"],
          [/\bhalter\b/, "Halter"],
          [/\bsquare neck\b/, "Square Neck"],
          [/\bhigh neck\b/, "High Neck"],
          [/\bscoop\b/, "Scoop Neck"],
          [/\bone[ -]?shoulder\b/, "One-Shoulder"],
          [/\bcrew neck\b/, "Crew Neck"],
        ],
        "Classic Neckline",
      );
    case "dressLengthType":
      return first(
        [
          [/\bfloor[ -]?length\b|\bfloor\b/, "Floor Length"],
          [/\bmaxi\b|\bankle[ -]?length\b/, "Maxi"],
          [/\btea[ -]?length\b/, "Tea Length"],
          [/\bmidi\b/, "Midi"],
          [/\bknee[ -]?length\b/, "Knee Length"],
          [/\bmini\b|\bshort dress\b/, "Mini"],
        ],
        "Dress Length",
      );
    case "sleeveLengthType":
      return first(
        [
          [/\blong sleeve\b|\blong-sleeve\b/, "Long Sleeve"],
          [/\bshort sleeve\b|\bshort-sleeve\b/, "Short Sleeve"],
          [/\bsleeveless\b/, "Sleeveless"],
          [/\bcap sleeve\b/, "Cap Sleeve"],
          [/\bspaghetti strap\b|\bspaghetti straps\b/, "Spaghetti Strap"],
        ],
        "Sleeve Length",
      );
    case "targetGender":
      return first(
        [
          [/\b(men|man|male|boys?)\b/, "Male"],
          [/\b(women|woman|female|girls?|ladies|lady|bride|bridesmaid)\b/, "Female"],
        ],
        "Female",
      );
    default:
      return "";
  }
}

function collectProductBatchCategoryInferenceText(
  product: ShopifyProductNode | undefined,
  prompt: string,
) {
  return [
    prompt,
    product?.title,
    product?.handle,
    product?.vendor,
    product?.productType,
    product?.tags?.join(" "),
    htmlToPlainText(product?.descriptionHtml || ""),
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
}

function pruneCategoryMetafields(
  fields: ProductBatchCategoryMetafields,
): ProductBatchCategoryMetafields {
  const result: ProductBatchCategoryMetafields = {};
  for (const def of PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS) {
    const value = cleanCategoryMetafieldValue(fields[def.key]);
    if (value) result[def.key] = value;
    if (def.baseKey) {
      const baseValue = cleanCategoryMetafieldValue(fields[def.baseKey]);
      if (baseValue) result[def.baseKey] = baseValue;
    }
  }
  return result;
}

function detectTargetCategoryMetafieldKeys(prompt: string): ProductBatchCategoryMetafieldKey[] {
  const text = cleanInlineText(prompt || "").toLowerCase();
  if (!text) return PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS.map((def) => def.key);

  const selected = new Set<ProductBatchCategoryMetafieldKey>();
  if (/全部|所有字段|全字段|完整优化|整体优化|全部优化|全量|all\s*fields/i.test(text)) {
    for (const def of PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS) selected.add(def.key);
  }

  for (const def of PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS) {
    if (def.hints.some((hint) => text.includes(hint.toLowerCase()))) {
      selected.add(def.key);
    }
  }
  return PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS
    .map((def) => def.key)
    .filter((key) => selected.has(key));
}

function buildCategoryMetafieldPromptInstruction(
  prompt: string,
  candidates: ProductBatchCategoryMetafieldCandidates = {},
) {
  const keys = detectTargetCategoryMetafieldKeys(prompt);
  return {
    fieldName: "categoryMetafields",
    allowedKeys: keys,
    labels: keys.map((key) => {
      const def = PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS.find((item) => item.key === key);
      return { key, label: def?.label || key };
    }),
    excludedKeys: ["color"],
    backendCandidates: formatCategoryMetafieldCandidatesForPrompt(keys, candidates),
    rule:
      "Only fill categoryMetafields keys listed in allowedKeys. Do not generate color here. Keep size on the existing categorySize logic. For fabric, ageGroup, occasion, dressStyle, neckline, dressLengthType, sleeveLengthType, and targetGender: output concise English display values only. You may choose an exact or closest existingMetaobjectValues item only when that item is already English; never copy Chinese, Japanese, Korean, or other non-English display values. If the backend only has a non-English Metaobject value, translate or infer the English display value from product facts so Shopify sync can create the missing English metaobject. When officialTaxonomyValues contains a suitable legal base value, also output the matching <key>BaseValue field, for example dressStyleBaseValue, copied verbatim from officialTaxonomyValues only when it is English. Never output null, undefined, none, or an empty string for requested categoryMetafields keys. For keys not listed in allowedKeys, copy the current value only if it is English; otherwise infer a concise English value from the product facts.",
  };
}

async function loadProductBatchCategoryMetafieldCandidates(opts: {
  user: User;
  deviceId: string;
  connection: ShopifyToken;
  product: ShopifyProductNode;
  targetKeys: ProductBatchCategoryMetafieldKey[];
  targetFields: ProductBatchTargetField[];
}): Promise<{
  candidates: ProductBatchCategoryMetafieldCandidates;
  warnings: string[];
}> {
  if (!opts.targetFields.includes("categoryMetafields")) {
    return { candidates: {}, warnings: [] };
  }
  const keys = opts.targetKeys.filter((key) => key !== "size");
  if (!keys.length) return { candidates: {}, warnings: [] };

  const categoryId = cleanInlineText(opts.product.category?.id || "");
  if (!categoryId) return { candidates: {}, warnings: [] };

  try {
    const result = await getShopifyCategoryMetafieldOptions(
      opts.user.id,
      opts.deviceId,
      categoryId,
      opts.connection.shopDomain,
    );
    return {
      candidates: buildProductBatchCategoryMetafieldCandidates(result, keys),
      warnings: (result.warnings || [])
        .filter(Boolean)
        .map((item) => `Shopify category metafield candidates: ${item}`)
        .slice(0, 2),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[product-batch] read category metafield candidates failed for ${opts.product.id}: ${message}`,
    );
    return {
      candidates: {},
      warnings: [`Shopify category metafield candidates unavailable: ${message}`],
    };
  }
}

function buildProductBatchCategoryMetafieldCandidates(
  result: ShopifyCategoryMetafieldOptionsResult,
  keys: ProductBatchCategoryMetafieldKey[],
): ProductBatchCategoryMetafieldCandidates {
  const wanted = new Set(keys.filter((key) => key !== "size"));
  const candidates: ProductBatchCategoryMetafieldCandidates = {};
  for (const def of PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS) {
    if (def.key === "size" || !wanted.has(def.key)) continue;
    const field = result.fields[String(def.shopifyField)];
    if (!field?.options?.length) continue;
    const metaobjectValues: string[] = [];
    const taxonomyValues: string[] = [];
    for (const option of field.options) {
      const values = [option.label];
      if (option.value && !option.value.startsWith("gid://shopify/")) {
        values.push(option.value);
      }
      if (/^gid:\/\/shopify\/TaxonomyValue\//.test(option.id)) {
        taxonomyValues.push(...values);
      } else {
        metaobjectValues.push(...values);
      }
    }
    const normalizedMetaobjectValues = sanitizeCategoryCandidateItems(metaobjectValues);
    const normalizedTaxonomyValues = sanitizeCategoryCandidateItems(taxonomyValues);
    if (normalizedMetaobjectValues.length || normalizedTaxonomyValues.length) {
      candidates[def.key] = {
        label: def.label,
        source: field.source,
        metaobjectValues: normalizedMetaobjectValues,
        taxonomyValues: normalizedTaxonomyValues,
      };
    }
  }
  return candidates;
}

function formatCategoryMetafieldCandidatesForPrompt(
  keys: ProductBatchCategoryMetafieldKey[],
  candidates: ProductBatchCategoryMetafieldCandidates,
) {
  return keys
    .filter((key) => key !== "size")
    .map((key) => {
      const def = PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS.find((item) => item.key === key);
      const candidate = candidates[key];
      return {
        key,
        label: def?.label || key,
        source: candidate?.source || "none",
        existingMetaobjectValues: candidate?.metaobjectValues || [],
        officialTaxonomyValues: candidate?.taxonomyValues || [],
      };
    });
}

function resolveCategoryMetafieldsAgainstBackendCandidates(
  proposed: ProductBatchProposed,
  prompt: string,
  candidates: ProductBatchCategoryMetafieldCandidates,
  current: ProductBatchCategoryMetafields = {},
  warnings: string[] = [],
): ProductBatchProposed {
  if (!Object.keys(candidates).length) return proposed;
  const keys = detectTargetCategoryMetafieldKeys(prompt).filter((key) => key !== "size");
  if (!keys.length) return proposed;

  const nextFields: ProductBatchCategoryMetafields = {
    ...(proposed.categoryMetafields || {}),
  };
  let changed = false;
  for (const key of keys) {
    const def = PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS.find((item) => item.key === key);
    const candidate = candidates[key];
    if (!def || !candidate) continue;
    const value = cleanCategoryMetafieldValue(nextFields[key]);
    if (!value) continue;

    const metaMatch = normalizeCategoryMetafieldEnglishValue(
      key,
      resolveCategoryMetafieldValueAgainstCandidate(value, candidate, "metaobject"),
    );
    if (metaMatch) {
      if (metaMatch !== value) {
        nextFields[key] = metaMatch;
        changed = true;
      }
      if (def.baseKey && nextFields[def.baseKey]) {
        delete nextFields[def.baseKey];
        changed = true;
      }
      continue;
    }

    if (!def.baseKey) continue;
    const baseValue = cleanCategoryMetafieldValue(nextFields[def.baseKey]);
    const baseMatch =
      normalizeCategoryMetafieldEnglishValue(
        key,
        resolveCategoryMetafieldValueAgainstCandidate(baseValue, candidate, "taxonomy"),
      ) ||
      normalizeCategoryMetafieldEnglishValue(
        key,
        resolveCategoryMetafieldValueAgainstCandidate(value, candidate, "taxonomy"),
      );

    if (baseMatch) {
      if (baseMatch !== baseValue) {
        nextFields[def.baseKey] = baseMatch;
        changed = true;
      }
      continue;
    }

    if (baseValue && nextFields[def.baseKey]) {
      delete nextFields[def.baseKey];
      changed = true;
    }
    warnings.push(
      `Category metafield ${def.label} will be created from generated value "${value}" because no existing backend value matched.`,
    );
  }

  if (!changed) return proposed;
  return {
    ...proposed,
    categoryMetafields: pruneCategoryMetafields(nextFields),
  };
}
function resolveCategoryMetafieldValueAgainstCandidate(
  value: string,
  candidate: ProductBatchCategoryMetafieldCandidateSet,
  source: "metaobject" | "taxonomy" | "all" = "all",
): string {
  const parts = splitCategoryMetafieldCandidateValue(value);
  if (!parts.length) return "";
  const sourceValues =
    source === "metaobject"
      ? candidate.metaobjectValues
      : source === "taxonomy"
        ? candidate.taxonomyValues
        : [...candidate.metaobjectValues, ...candidate.taxonomyValues];
  const existingValues = sanitizeCategoryCandidateItems(sourceValues);
  if (!existingValues.length) return "";
  const resolved = parts.map((part) => findSimilarCategoryCandidate(part, existingValues));
  return resolved.every(Boolean) ? joinCategoryMetafieldCandidateValues(resolved) : "";
}
function findSimilarCategoryCandidate(value: string, candidates: string[]) {
  const normalizedValue = normalizeCategoryCandidateForMatch(value);
  const compactValue = normalizedValue.replace(/\s+/g, "");
  if (!normalizedValue) return "";
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeCategoryCandidateForMatch(candidate);
    if (normalizedCandidate === normalizedValue) return candidate;
    if (normalizedCandidate.replace(/\s+/g, "") === compactValue) return candidate;
  }
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeCategoryCandidateForMatch(candidate);
    if (
      normalizedValue.length >= 5 &&
      normalizedCandidate.length >= 5 &&
      (normalizedCandidate.includes(normalizedValue) ||
        normalizedValue.includes(normalizedCandidate))
    ) {
      return candidate;
    }
  }
  return "";
}

function normalizeCategoryCandidateForMatch(value: string) {
  return cleanInlineText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCategoryMetafieldCandidateValue(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of String(value || "").split(/[,;|\n]/)) {
    const normalized = cleanInlineText(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);
  }
  return items;
}

function joinCategoryMetafieldCandidateValues(items: string[]) {
  return sanitizeCategoryCandidateItems(items, 40).join(", ");
}

function sanitizeCategoryCandidateItems(value: unknown[], limit = 80): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const rawItem of value) {
    if (typeof rawItem !== "string") continue;
    const item = cleanInlineText(rawItem)
      .replace(/[|]/g, " ")
      .replace(/\s{2,}/g, " ")
      .slice(0, 80)
      .trim();
    if (!item || item.startsWith("gid://shopify/")) continue;
    const normalized = item.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}

function summarizeChanges(
  current: ProductBatchSnapshot,
  proposed: ProductBatchProposed,
  targetFields: ProductBatchTargetField[] = PRODUCT_BATCH_TARGET_FIELDS,
) {
  const targets = new Set(targetFields);
  return {
    titleChanged: targets.has("title") && current.title !== proposed.title,
    handleChanged: targets.has("title") && current.handle !== proposed.handle,
    descriptionChanged:
      targets.has("descriptionHtml") &&
      current.descriptionHtml !== proposed.descriptionHtml,
    seoTitleChanged: targets.has("seoTitle") && current.seoTitle !== proposed.seoTitle,
    metaDescriptionChanged:
      targets.has("metaDescription") &&
      current.metaDescription !== proposed.metaDescription,
    categorySizeChanged:
      targets.has("categorySize") && current.categorySize !== proposed.categorySize,
    categoryMetafieldsChanged:
      targets.has("categoryMetafields") &&
      JSON.stringify(current.categoryMetafields || {}) !==
        JSON.stringify(proposed.categoryMetafields || {}),
    templateStyleChanged:
      targets.has("templateStyle") && current.templateStyle !== proposed.templateStyle,
    tagsChanged:
      targets.has("tags") && JSON.stringify(current.tags) !== JSON.stringify(proposed.tags),
    faqChanged:
      targets.has("faq") && JSON.stringify(current.faq) !== JSON.stringify(proposed.faq),
    imageAltTextUpdates: targets.has("imageAltTexts")
      ? proposed.imageAltTexts.length
      : 0,
  };
}

async function updateProduct(
  connection: ShopifyToken,
  proposal: ProductBatchProposal,
  targetFields: ProductBatchTargetField[],
) {
  const targets = new Set(targetFields);
  const product: Record<string, unknown> = { id: proposal.product.id };
  const seo: Record<string, string> = {};

  if (targets.has("title")) product.title = proposal.proposed.title;
  if (targets.has("descriptionHtml")) {
    product.descriptionHtml = proposal.proposed.descriptionHtml;
  }
  if (targets.has("seoTitle")) seo.title = proposal.proposed.seoTitle;
  if (targets.has("metaDescription")) {
    seo.description = proposal.proposed.metaDescription;
  }
  if (Object.keys(seo).length) product.seo = seo;
  if (targets.has("templateStyle")) {
    const templateSuffix = normalizeProductTemplateStyle(
      proposal.proposed.templateStyle ?? proposal.current.templateStyle ?? "",
    );
    product.templateSuffix = templateSuffix || null;
  }
  if (targets.has("tags")) {
    product.tags = stripAppliedTag(proposal.proposed.tags);
  }

  if (Object.keys(product).length === 1) {
    return { skipped: true, reason: "no product fields selected" };
  }

  const data = await shopifyGraphql<{
    productUpdate: {
      product: unknown;
      userErrors: Array<{ field?: string[]; message?: string }>;
    };
  }>(connection, PRODUCT_UPDATE_MUTATION, { product });
  const errors = normalizeUserErrors(data.productUpdate?.userErrors);
  if (errors.length) throw new Error(errors.join("；"));
  return { ok: true, product: data.productUpdate?.product || null };
}

async function updateProductStatus(
  connection: ShopifyToken,
  productId: string,
  status: "DRAFT" | "ACTIVE" | "ARCHIVED",
) {
  const data = await shopifyGraphql<{
    productUpdate: {
      product: { id: string; status: string } | null;
      userErrors: Array<{ field?: string[]; message?: string }>;
    };
  }>(connection, PRODUCT_UPDATE_MUTATION, {
    product: { id: productId, status },
  });
  const errors = normalizeUserErrors(data.productUpdate?.userErrors);
  if (errors.length) throw new Error(errors.join("；"));
  return { ok: true, product: data.productUpdate?.product || null };
}

async function markProductApplied(connection: ShopifyToken, productId: string) {
  const current = await shopifyGraphql<{
    product: { id: string; tags: string[] } | null;
  }>(connection, PRODUCT_TAGS_QUERY, { id: productId });
  const tags = withAppliedTag(current.product?.tags || []);
  const data = await shopifyGraphql<{
    productUpdate: {
      product: { id: string; tags: string[] } | null;
      userErrors: Array<{ field?: string[]; message?: string }>;
    };
  }>(connection, PRODUCT_UPDATE_MUTATION, {
    product: { id: productId, tags },
  });
  const errors = normalizeUserErrors(data.productUpdate?.userErrors);
  if (errors.length) throw new Error(errors.join("；"));
  return { ok: true, tag: APPLIED_TAG, tags };
}

async function updateImageAltTexts(
  connection: ShopifyToken,
  imageAltTexts: ProductBatchImageUpdate[],
) {
  const files = imageAltTexts
    .filter((item) => item.mediaId && item.altText)
    .map((item) => ({
      id: item.mediaId,
      alt: item.altText,
      ...(item.filename ? { filename: item.filename } : {}),
    }));
  if (!files.length) return { skipped: true, reason: "no image alt text" };
  const data = await shopifyGraphql<{
    fileUpdate: {
      files: Array<{ id: string; alt?: string | null }>;
      userErrors: Array<{ field?: string[]; message?: string }>;
    };
  }>(connection, FILE_UPDATE_MUTATION, { files });
  const errors = normalizeUserErrors(data.fileUpdate?.userErrors);
  if (errors.length) throw new Error(errors.join("；"));
  return { ok: true, updatedCount: data.fileUpdate?.files?.length || 0 };
}

function buildChangedCategoryMetafieldsSyncInput(
  proposal: ProductBatchProposal,
  targetFields: ProductBatchTargetField[],
): ShopifyProductCategoryMetafieldsSyncInput {
  const targets = new Set(targetFields);
  const input: ShopifyProductCategoryMetafieldsSyncInput = {};
  if (!targets.has("categorySize") && !targets.has("categoryMetafields")) {
    return input;
  }

  const currentFields = proposal.current.categoryMetafields || {};
  const proposedFields = proposal.proposed.categoryMetafields || {};
  for (const def of PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS) {
    if (def.key === "size" && !targets.has("categorySize") && !targets.has("categoryMetafields")) {
      continue;
    }
    if (def.key !== "size" && !targets.has("categoryMetafields")) continue;
    const currentValue = cleanCategoryMetafieldValue(
      def.key === "size" ? proposal.current.categorySize || currentFields.size : currentFields[def.key],
    );
    const proposedValue = cleanCategoryMetafieldValue(
      def.key === "size" ? proposal.proposed.categorySize || proposedFields.size : proposedFields[def.key],
    );
    if (!proposedValue || proposedValue === currentValue) continue;
    (input as Record<string, string>)[def.shopifyField] = proposedValue;
    if (def.baseKey && def.shopifyBaseValueField) {
      const proposedBaseValue = cleanCategoryMetafieldValue(proposedFields[def.baseKey]);
      if (proposedBaseValue) {
        (input as Record<string, string>)[def.shopifyBaseValueField] = proposedBaseValue;
      }
    }
  }
  return input;
}

async function updateCategoryMetafields(
  connection: ShopifyToken,
  proposal: ProductBatchProposal,
  categoryMetafields: ShopifyProductCategoryMetafieldsSyncInput,
) {
  if (!Object.keys(categoryMetafields).length) {
    return { skipped: true, reason: "no category metafields" };
  }
  const categoryId = proposal.product.categoryId || "";
  if (!categoryId) {
    return { skipped: true, reason: "product has no Shopify category" };
  }
  return syncShopifyProductCategoryMetafields({
    shopDomain: connection.shopDomain,
    accessToken: connection.accessToken,
    productId: proposal.product.id,
    categoryId,
    categoryMetafields,
  });
}

async function updateFaqMetafields(
  connection: ShopifyToken,
  productId: string,
  faq: ProductBatchFaqItem[],
) {
  const items = Array.isArray(faq) ? faq.slice(0, 5) : [];
  if (!items.length) return { skipped: true, reason: "no proposed FAQ" };
  const definitions = await getFaqMetafieldDefinitions(connection);
  const metafields = items.flatMap((item, index) => {
    const slot = definitions.get(index + 1) || createDefaultFaqSlot(index + 1);
    return [
      {
        ownerId: productId,
        namespace: slot.question.namespace,
        key: slot.question.key,
        type: slot.question.type,
        value: formatMetafieldValue(slot.question.type, item.question),
      },
      {
        ownerId: productId,
        namespace: slot.answer.namespace,
        key: slot.answer.key,
        type: slot.answer.type,
        value: formatMetafieldValue(slot.answer.type, item.answer),
      },
    ];
  });
  const data = await shopifyGraphql<{
    metafieldsSet: {
      metafields: Array<{ id: string }>;
      userErrors: Array<{ field?: string[]; message?: string }>;
    };
  }>(connection, METAFIELDS_SET_MUTATION, { metafields });
  const errors = normalizeUserErrors(data.metafieldsSet?.userErrors);
  if (errors.length) throw new Error(errors.join("；"));
  return { ok: true, updatedCount: data.metafieldsSet?.metafields?.length || 0 };
}

type FaqDefinition = {
  namespace: string;
  key: string;
  type: string;
};

async function getFaqMetafieldDefinitions(connection: ShopifyToken) {
  const data = await shopifyGraphql<{
    metafieldDefinitions: {
      nodes: Array<{
        name?: string | null;
        namespace?: string | null;
        key?: string | null;
        type?: { name?: string | null } | null;
      }>;
    };
  }>(connection, METAFIELD_DEFINITIONS_QUERY);
  const slots = new Map<
    number,
    { question: FaqDefinition; answer: FaqDefinition }
  >();
  for (const def of data.metafieldDefinitions?.nodes || []) {
    const label = normalizeLabel(`${def.name || ""} ${def.key || ""}`);
    const number = extractFaqNumber(label);
    if (!number || number < 1 || number > 5) continue;
    const target = /answer|daan|回复|答案/.test(label) ? "answer" : "question";
    const current = slots.get(number) || createDefaultFaqSlot(number);
    current[target] = {
      namespace: def.namespace || "custom",
      key: def.key || current[target].key,
      type: def.type?.name || current[target].type,
    };
    slots.set(number, current);
  }
  return slots;
}

function createDefaultFaqSlot(number: number): {
  question: FaqDefinition;
  answer: FaqDefinition;
} {
  return {
    question: {
      namespace: "custom",
      key: `faq_${number}_question`,
      type: "single_line_text_field",
    },
    answer: {
      namespace: "custom",
      key: `faq_${number}_answer`,
      type: "multi_line_text_field",
    },
  };
}

function formatMetafieldValue(type: string, value: string) {
  const text = cleanInlineText(value);
  if (type === "rich_text_field") {
    return JSON.stringify({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: text }],
        },
      ],
    });
  }
  if (type.startsWith("list.")) return JSON.stringify([text]);
  if (type === "json") return JSON.stringify(text);
  return text;
}

async function shopifyGraphql<T>(
  connection: ShopifyToken,
  query: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal,
  options?: {
    maxThrottleRetries?: number;
    onThrottle?: (throttle: ProductBatchShopifyThrottleProgress) => void;
    onCost?: (throttle: ProductBatchShopifyThrottleProgress) => void;
  },
): Promise<T> {
  const domain = normalizeShopDomainInput(connection.shopDomain);
  const endpoint = `https://${domain}/admin/api/${connection.apiVersion || SHOPIFY_API_VERSION}/graphql.json`;
  const maxThrottleRetries = options?.maxThrottleRetries ?? 5;
  for (let attemptIndex = 0; attemptIndex <= maxThrottleRetries; attemptIndex += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": connection.accessToken,
      },
      body: JSON.stringify({ query, variables }),
      signal: withTimeoutSignal(60_000, signal),
    });
    const text = await response.text();
    let json: ShopifyGraphqlEnvelope<T>;
    try {
      json = text ? (JSON.parse(text) as ShopifyGraphqlEnvelope<T>) : {};
    } catch {
      throw new Error(
        `Shopify 返回非 JSON 响应（HTTP ${response.status}）：${truncate(text, 300)}`,
      );
    }

    const graphqlErrors = normalizeShopifyGraphqlErrors(json.errors);
    const throttled =
      response.status === 429 ||
      graphqlErrors.some((message) => /throttled/i.test(message));
    if (throttled && attemptIndex < maxThrottleRetries) {
      const throttle = buildShopifyThrottleProgress(
        json,
        response,
        attemptIndex,
        maxThrottleRetries,
      );
      options?.onThrottle?.(throttle);
      await waitWithAbort(throttle.retryAfterMs, signal);
      continue;
    }

    if (!response.ok) {
      throw new Error(
        `Shopify 请求失败：HTTP ${response.status} ${truncate(JSON.stringify(json), 500)}`,
      );
    }
    if (graphqlErrors.length) {
      throw new Error(`Shopify GraphQL 错误：${graphqlErrors.join("；")}`);
    }
    const costProgress = buildShopifyCostProgress(json);
    if (costProgress) options?.onCost?.(costProgress);
    return (json.data || {}) as T;
  }
  throw new Error("Shopify GraphQL 错误：Throttled");
}

function buildShopifyCostProgress<T>(
  json: ShopifyGraphqlEnvelope<T>,
): ProductBatchShopifyThrottleProgress | null {
  const cost = json.extensions?.cost;
  const throttleStatus = cost?.throttleStatus;
  if (!throttleStatus) return null;
  return {
    retryAt: Date.now(),
    retryAfterMs: 0,
    attempt: 0,
    maxAttempts: 0,
    currentlyAvailable: toFiniteNumber(throttleStatus.currentlyAvailable),
    restoreRate: toFiniteNumber(throttleStatus.restoreRate),
    maximumAvailable: toFiniteNumber(throttleStatus.maximumAvailable),
    requestedQueryCost: toFiniteNumber(cost?.requestedQueryCost),
    source: "shopify",
  };
}

function buildShopifyThrottleProgress<T>(
  json: ShopifyGraphqlEnvelope<T>,
  response: Response,
  attemptIndex: number,
  maxAttempts: number,
): ProductBatchShopifyThrottleProgress {
  const cost = json.extensions?.cost;
  const throttleStatus = cost?.throttleStatus;
  const retryAfterHeaderMs = parseRetryAfterMs(response.headers.get("retry-after"));
  const requested = Number(cost?.requestedQueryCost);
  const current = Number(throttleStatus?.currentlyAvailable);
  const restoreRate = Number(throttleStatus?.restoreRate);
  const shopifyWaitMs =
    Number.isFinite(requested) &&
    Number.isFinite(current) &&
    Number.isFinite(restoreRate) &&
    restoreRate > 0
      ? Math.ceil((Math.max(0, requested - current) / restoreRate) * 1000) + 1000
      : null;
  const fallbackWaitMs = Math.min(30_000, 3000 * 2 ** attemptIndex);
  const retryAfterMs = clampNumber(
    retryAfterHeaderMs || shopifyWaitMs || fallbackWaitMs,
    1000,
    30_000,
  );
  return {
    retryAt: Date.now() + retryAfterMs,
    retryAfterMs,
    attempt: attemptIndex + 1,
    maxAttempts,
    currentlyAvailable: toFiniteNumber(throttleStatus?.currentlyAvailable),
    restoreRate: toFiniteNumber(throttleStatus?.restoreRate),
    maximumAvailable: toFiniteNumber(throttleStatus?.maximumAvailable),
    requestedQueryCost: toFiniteNumber(cost?.requestedQueryCost),
    source: shopifyWaitMs || retryAfterHeaderMs ? "shopify" : "fallback",
  };
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function toFiniteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function waitWithAbort(ms: number, signal?: AbortSignal) {
  if (!signal) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
  if (signal.aborted) return Promise.reject(abortReason(signal, "已取消"));
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal, "已取消"));
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function getProductImages(product: ShopifyProductNode): ProductBatchImageSnapshot[] {
  const edges = product.media?.edges || [];
  return edges
    .map((edge) => edge.node)
    .filter((node): node is ShopifyMediaNode => Boolean(node))
    .map((node) => {
      const image = node.image || node.preview?.image || null;
      const url = image?.url || "";
      return {
        mediaId: node.id || "",
        altText: node.image?.altText || node.alt || "",
        filename: getFilenameFromUrl(url),
        url,
        width: node.image?.width || null,
        height: node.image?.height || null,
      };
    })
    .filter((image) => image.mediaId);
}

function getProductFaq(product: ShopifyProductNode): ProductBatchFaqItem[] {
  const nodes = product.metafields?.nodes || [];
  const values = new Map<string, string>();
  for (const item of nodes) {
    const normalized = normalizeLabel(item.key || item.definition?.name || "");
    if (normalized) values.set(normalized, String(item.value || "").trim());
  }
  const faq: ProductBatchFaqItem[] = [];
  for (let index = 1; index <= 5; index += 1) {
    const question =
      extractMetafieldText(values.get(`faq${index}question`) || "") ||
      extractMetafieldText(values.get(`faq${index}`) || "") ||
      extractMetafieldText(values.get(`question${index}`) || "");
    const answer =
      extractMetafieldText(values.get(`faq${index}answer`) || "") ||
      extractMetafieldText(values.get(`answer${index}`) || "");
    if (question || answer) faq.push({ question, answer });
  }
  return faq;
}

function getProductCategorySize(product: ShopifyProductNode): string {
  const nodes = product.metafields?.nodes || [];
  for (const item of nodes) {
    if (!isCategorySizeMetafield(item)) continue;
    return extractCategoryMetafieldText(item);
  }
  return "";
}

function getProductCategoryMetafields(
  product: ShopifyProductNode,
): ProductBatchCategoryMetafields {
  const result: ProductBatchCategoryMetafields = {};
  const nodes = product.metafields?.nodes || [];
  for (const item of nodes) {
    const key = getCategoryMetafieldKey(item);
    if (!key) continue;
    const value = extractCategoryMetafieldText(item);
    if (value) result[key] = value;
  }
  const size = getProductCategorySize(product);
  if (size) result.size = size;
  return result;
}

function getCategoryMetafieldKey(
  item: ShopifyMetafieldNode,
): ProductBatchCategoryMetafieldKey | null {
  const namespace = String(item.namespace || "").toLowerCase();
  if (namespace !== "shopify") return null;
  const key = normalizeLabel(item.key || "");
  const name = normalizeLabel(item.definition?.name || "");
  const combined = `${key} ${name}`;
  for (const def of PRODUCT_BATCH_CATEGORY_METAFIELD_DEFS) {
    if (
      def.hints.some((hint) => {
        const normalizedHint = normalizeLabel(hint);
        return normalizedHint && combined.includes(normalizedHint);
      })
    ) {
      return def.key;
    }
  }
  return null;
}

function isCategorySizeMetafield(item: ShopifyMetafieldNode) {
  const namespace = String(item.namespace || "").toLowerCase();
  if (namespace !== "shopify") return false;
  const key = normalizeLabel(item.key || "");
  const name = normalizeLabel(item.definition?.name || "");
  const combined = `${key} ${name}`;
  if (/sleeve|length|neckline|color|fabric|material|gender|occasion/.test(combined)) {
    return false;
  }
  return key === "size" || key.includes("clothingsize") || name === "size";
}

function extractCategoryMetafieldText(item: ShopifyMetafieldNode): string {
  const referenceValues = [
    ...(item.reference ? [item.reference] : []),
    ...(item.references?.nodes || []),
  ]
    .map(formatMetaobjectValue)
    .filter(Boolean);
  if (referenceValues.length) return referenceValues.join(", ");
  return extractMetafieldText(String(item.value || ""));
}

function formatMetaobjectValue(node: ShopifyMetaobjectNode): string {
  return (
    cleanInlineText(node.displayName || "") ||
    cleanInlineText(node.fields?.find((field) => field.key === "label")?.value || "") ||
    cleanInlineText(node.fields?.find((field) => field.key === "name")?.value || "") ||
    cleanInlineText(node.handle || "") ||
    cleanInlineText(node.id || "")
  );
}

function extractMetafieldText(raw: string) {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "children" in parsed) {
      return flattenRichText(parsed).trim();
    }
    if (typeof parsed === "string") return parsed.trim();
  } catch {
    // Plain text metafield.
  }
  return raw.trim();
}

function flattenRichText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const source = node as {
    type?: string;
    value?: string;
    children?: unknown[];
  };
  if (source.type === "text") return source.value || "";
  return (source.children || []).map(flattenRichText).join("");
}

function normalizeTitleKeyword(value: string) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productTitleMatchesKeyword(title: unknown, keyword: string) {
  const normalizedKeyword = normalizeTitleKeyword(keyword).toLowerCase();
  if (!normalizedKeyword) return true;
  return String(title || "").toLowerCase().includes(normalizedKeyword);
}

function hasAppliedTag(product: ShopifyProductNode) {
  return (product.tags || []).some(
    (tag) => String(tag || "").trim().toLowerCase() === APPLIED_TAG,
  );
}

function stripAppliedTag(tags: unknown): string[] {
  const values = Array.isArray(tags) ? tags : [];
  return values
    .map((tag) => String(tag || "").trim())
    .filter((tag) => tag && tag.toLowerCase() !== APPLIED_TAG);
}

function withAppliedTag(tags: string[]) {
  if (tags.some((tag) => tag.trim().toLowerCase() === APPLIED_TAG)) return tags;
  return [...tags, APPLIED_TAG];
}

function normalizeTags(generatedTags: unknown, existingTags: string[]) {
  const generated = Array.isArray(generatedTags) ? generatedTags : [];
  const preserved = existingTags.filter(shouldPreserveTag);
  const combined = [...preserved, ...generated]
    .map((tag) => clampText(String(tag || "").replace(/\s+/g, " "), 255))
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of combined) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= PRODUCT_BATCH_RULES.contentRules.maxTags) break;
  }
  return result;
}

function shouldPreserveTag(tag: string) {
  const value = String(tag || "");
  const lower = value.toLowerCase();
  const preserve = PRODUCT_BATCH_RULES.preserveExistingTags;
  if (preserve.exact.some((item) => lower === item.toLowerCase())) return true;
  if (preserve.prefixes.some((prefix) => lower.startsWith(prefix.toLowerCase()))) {
    return true;
  }
  return preserve.contains.some((needle) => lower.includes(needle.toLowerCase()));
}

function cleanDescriptionHtml(value: string, allowedTags: string[]) {
  const allowed = new Set(allowedTags.map((tag) => tag.toLowerCase()));
  let html = String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .trim();
  const hasHtml = /<\/?[a-z][\s\S]*>/i.test(html);
  if (!hasHtml) {
    return html
      .split(/\n{2,}/)
      .map((part) => escapeHtml(part.trim()))
      .filter(Boolean)
      .map((part) => `<p>${part}</p>`)
      .join("\n");
  }
  html = html.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (full, tag: string) => {
    const name = tag.toLowerCase();
    if (!allowed.has(name)) return "";
    if (name === "br") return "<br>";
    return full.startsWith("</") ? `</${name}>` : `<${name}>`;
  });
  return html.slice(0, 20_000);
}

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const candidates = [cleaned];
  const embeddedObject = extractFirstJsonObject(cleaned);
  if (embeddedObject && embeddedObject !== cleaned) candidates.push(embeddedObject);
  let lastParseError = "";

  for (const candidate of candidates) {
    try {
      return assertJsonObject(JSON.parse(candidate) as unknown);
    } catch (err) {
      lastParseError = err instanceof Error ? err.message : String(err);
    }

    const repaired = repairMissingJsonCommas(candidate);
    if (repaired !== candidate) {
      try {
        return assertJsonObject(JSON.parse(repaired) as unknown);
      } catch (err) {
        lastParseError = err instanceof Error ? err.message : String(err);
      }
    }
  }
  throw new Error(
    `模型返回的 JSON 无法解析${lastParseError ? `（${lastParseError}）` : ""}：${truncate(text, 500)}`,
  );
}

function assertJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("Parsed JSON is not an object");
}

function extractFirstJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function repairMissingJsonCommas(text: string) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out += ch;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
        const nextIndex = findNextNonWhitespace(text, i + 1);
        if (shouldInsertMissingComma(text, i, nextIndex)) out += ",";
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "}" || ch === "]" || isNumberTokenEnd(text, i)) {
      const nextIndex = findNextNonWhitespace(text, i + 1);
      if (shouldInsertMissingComma(text, i, nextIndex)) out += ",";
    }
  }
  return out;
}

function isNumberTokenEnd(text: string, index: number) {
  const ch = text[index];
  if (!/[0-9]/.test(ch)) return false;
  const next = text[index + 1];
  return !next || !/[0-9.eE+-]/.test(next);
}

function findNextNonWhitespace(text: string, start: number) {
  for (let i = start; i < text.length; i++) {
    if (!/\s/.test(text[i])) return i;
  }
  return -1;
}

function shouldInsertMissingComma(text: string, currentIndex: number, nextIndex: number) {
  if (nextIndex < 0) return false;
  const between = text.slice(currentIndex + 1, nextIndex);
  if (between.includes(",") || between.includes(":")) return false;
  const next = text[nextIndex];
  return next === "{" || next === "[" || next === '"' || next === "-" || /[0-9tfn]/.test(next);
}

function formatModelError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (/429|RESOURCE_EXHAUSTED|quota|exhausted/i.test(raw)) {
    return "大模型额度或调用频率已达到上限。已自动重试仍未恢复，请稍后再试，或减少本次店铺/商品数量后重新生成。";
  }
  if (/503|UNAVAILABLE/i.test(raw)) {
    return "大模型服务暂时不可用。已自动重试仍未恢复，请稍后再试。";
  }
  if (/privoxy|proxy/i.test(raw)) {
    return "本机代理或网络连接临时异常。已自动重试仍未恢复，请稍后再试；如果连续出现，请检查代理/VPN 后再重新生成。";
  }
  return raw;
}

function createPreviewJob(jobId: string | undefined, scope: ProductBatchScope): PreviewJobState | null {
  if (!jobId) return null;
  const id = cleanJobId(jobId);
  const existing = previewJobs.get(id);
  if (existing && !existing.cancelled) {
    assertPreviewJobInScope(existing, scope);
    throw new Error("同一个预览任务正在运行，请稍后再试。");
  }
  const job: PreviewJobState = {
    id,
    userId: scope.userId,
    deviceId: scope.deviceId,
    cancelled: false,
    controller: new AbortController(),
    createdAt: Date.now(),
    reason: null,
    progress: {
      jobId: id,
      phase: "starting",
      percent: 0,
      completed: 0,
      total: 0,
      message: "正在准备任务...",
      currentStore: null,
      currentProduct: null,
      done: false,
      cancelled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
  previewJobs.set(id, job);
  cleanupOldPreviewJobs();
  return job;
}

function isPreviewJobInScope(job: PreviewJobState, scope: ProductBatchScope) {
  return job.userId === scope.userId && job.deviceId === scope.deviceId;
}

function assertPreviewJobInScope(job: PreviewJobState, scope: ProductBatchScope) {
  if (isPreviewJobInScope(job, scope)) return;
  const error = new Error("预览任务不属于当前电脑。") as Error & { status?: number };
  error.status = 404;
  throw error;
}
function cleanJobId(value: string) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_.:-]{8,120}$/.test(id)) {
    throw new Error("无效的预览任务 ID。");
  }
  return id;
}

function cleanupOldPreviewJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of previewJobs) {
    if (job.createdAt < cutoff) previewJobs.delete(id);
  }
}

function isPreviewJobCancelled(job: PreviewJobState | null) {
  return Boolean(job?.cancelled || job?.controller.signal.aborted);
}

function updatePreviewProgress(
  job: PreviewJobState | null,
  patch: Partial<ProductBatchPreviewProgress>,
) {
  if (!job) return;
  const next: ProductBatchPreviewProgress = {
    ...job.progress,
    ...patch,
    jobId: job.id,
    percent: clampInt(
      Math.round(
        patch.percent ?? job.progress.percent ?? getProgressPercent(
          patch.completed ?? job.progress.completed,
          patch.total ?? job.progress.total,
        ),
      ),
      0,
      100,
    ),
    completed: Math.max(0, patch.completed ?? job.progress.completed),
    total: Math.max(0, patch.total ?? job.progress.total),
    cancelled: Boolean(patch.cancelled ?? job.progress.cancelled),
    done: Boolean(patch.done ?? job.progress.done),
    updatedAt: Date.now(),
  };
  job.progress = next;
}

function getProgressPercent(completed: number, total: number) {
  if (!total) return 0;
  return clampInt(Math.round((completed / total) * 100), 0, 99);
}

function isAbortLikeError(error: unknown) {
  if (!error) return false;
  const name = (error as { name?: string }).name || "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === "AbortError" ||
    /abort|aborted|强制停止|cancel/i.test(message)
  );
}

function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  fallbackMessage = "已取消",
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(abortReason(signal, fallbackMessage));
  }
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      void promise.catch(() => {});
      reject(abortReason(signal, fallbackMessage));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function abortReason(signal: AbortSignal, fallbackMessage: string) {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === "string" ? reason : fallbackMessage);
}

function getProposalKey(proposal: ProductBatchProposal) {
  return `${proposal.store.key}::${proposal.product.id}`;
}

function withTimeoutSignal(ms: number, parent?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    controller.abort(new Error("Shopify 请求超时"));
  }, ms);
  const abortFromParent = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    controller.abort(parent?.reason || new Error("已强制停止"));
  };
  if (parent?.aborted) {
    abortFromParent();
  } else {
    parent?.addEventListener("abort", abortFromParent, { once: true });
  }
  return controller.signal;
}

function getStoreFilePath() {
  return path.join(DATA_DIR_PATH, RUNS_DIR_NAME, "stores.json");
}

async function readStoresDocument(): Promise<ProductBatchStoresDocument> {
  try {
    const raw = await fs.readFile(getStoreFilePath(), "utf8");
    const doc = JSON.parse(raw) as Partial<ProductBatchStoresDocument>;
    return {
      stores: Array.isArray(doc.stores)
        ? doc.stores.filter(isStoreRecord).map(normalizeStoreRecord)
        : [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { stores: [] };
    }
    throw err;
  }
}

async function writeStoresDocument(doc: ProductBatchStoresDocument) {
  const filePath = getStoreFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

function isStoreRecord(value: unknown): value is ProductBatchStoreRecord {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<ProductBatchStoreRecord>;
  return Boolean(source.key && source.shopDomain && source.accessTokenEnc);
}

function normalizeStoreRecord(
  store: ProductBatchStoreRecord,
): ProductBatchStoreRecord {
  return {
    key: normalizeStoreKey(store.key),
    userId: normalizeOptionalUserId(store.userId),
    deviceId: normalizeOptionalDeviceId(store.deviceId),
    name: cleanInlineText(store.name || fallbackStoreName(store.shopDomain)),
    shopDomain: normalizeShopDomainInput(store.shopDomain),
    accessTokenEnc: store.accessTokenEnc,
    apiVersion: store.apiVersion || SHOPIFY_API_VERSION,
    language: store.language || "en",
    market: store.market || "",
    brandVoice:
      store.brandVoice ||
      "Clear, trustworthy, product-focused, and conversion-oriented.",
    defaultProductQuery: store.defaultProductQuery || "status:active",
    tokenIssuedAt: store.tokenIssuedAt || "",
    tokenExpiresAt: store.tokenExpiresAt || null,
    createdAt: store.createdAt || store.tokenIssuedAt || "",
    updatedAt: store.updatedAt || store.tokenIssuedAt || "",
  };
}

function getScopedStores(
  doc: ProductBatchStoresDocument,
  scope: ProductBatchScope,
) {
  return doc.stores.filter((store) => isStoreInScope(store, scope));
}

function isStoreInScope(store: ProductBatchStoreRecord, scope: ProductBatchScope) {
  return store.userId === scope.userId && store.deviceId === scope.deviceId;
}

function isRunInScope(run: ProductBatchRunDocument, scope: ProductBatchScope) {
  return run.userId === scope.userId && run.deviceId === scope.deviceId;
}

function assertRunInScope(run: ProductBatchRunDocument, scope: ProductBatchScope) {
  if (isRunInScope(run, scope)) return;
  const error = new Error("运行记录不存在或不属于当前电脑。") as Error & { status?: number };
  error.status = 404;
  throw error;
}

function normalizeOptionalUserId(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function normalizeOptionalDeviceId(value: unknown) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_-]{12,96}$/.test(text) ? text : undefined;
}
function toSafeStore(store: ProductBatchStoreRecord): ProductBatchStoreSafe {
  const issuedAtMs = store.tokenIssuedAt
    ? new Date(store.tokenIssuedAt).getTime()
    : NaN;
  const savedExpiresAtMs = store.tokenExpiresAt
    ? new Date(store.tokenExpiresAt).getTime()
    : NaN;
  const expiresAtMs = Number.isFinite(savedExpiresAtMs)
    ? savedExpiresAtMs
    : Number.isFinite(issuedAtMs)
      ? issuedAtMs + PRODUCT_BATCH_TOKEN_TTL_MS
      : 0;
  const remaining = expiresAtMs ? Math.max(0, expiresAtMs - Date.now()) : 0;
  return {
    key: store.key,
    name: store.name || fallbackStoreName(store.shopDomain),
    shopDomain: store.shopDomain,
    apiVersion: store.apiVersion || SHOPIFY_API_VERSION,
    language: store.language || "en",
    market: store.market || "",
    tokenPresent: Boolean(store.accessTokenEnc),
    tokenIssuedAt: store.tokenIssuedAt || null,
    tokenExpiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    tokenExpired: expiresAtMs ? remaining <= 0 : true,
    tokenRemainingMs: remaining,
    defaultProductQuery: store.defaultProductQuery || "status:active",
  };
}

async function refreshProductBatchStoreNames(
  doc: ProductBatchStoresDocument,
  scope: ProductBatchScope,
) {
  const candidates = getScopedStores(doc, scope).filter(shouldRefreshStoreName);
  if (!candidates.length) return;

  const refreshed = await Promise.all(candidates.map(async (store) => {
    try {
      const shopName = await fetchShopifyShopName({
        key: store.key,
        name: store.name,
        shopDomain: store.shopDomain,
        accessToken: getValidStoreAccessToken(store),
        apiVersion: store.apiVersion || SHOPIFY_API_VERSION,
        language: store.language || "en",
        market: store.market || "",
        brandVoice: store.brandVoice || "",
      });
      if (!shopName || shopName === store.name) return false;
      store.name = shopName;
      store.updatedAt = new Date().toISOString();
      return true;
    } catch {
      return false;
    }
  }));

  if (refreshed.some(Boolean)) {
    await writeStoresDocument(doc);
  }
}

function shouldRefreshStoreName(store: ProductBatchStoreRecord) {
  const current = cleanInlineText(store.name || "");
  if (!current) return true;
  return current.toLowerCase() === fallbackStoreName(store.shopDomain).toLowerCase();
}

function fallbackStoreName(shopDomain: string) {
  return normalizeShopDomainInput(shopDomain).replace(/\.myshopify\.com$/i, "");
}

async function fetchShopifyShopName(connection: ShopifyToken) {
  const data = await shopifyGraphql<ShopifyShopQueryData>(
    connection,
    `query BuqiqiProductBatchShopName {
      shop {
        name
        myshopifyDomain
        primaryDomain {
          host
        }
      }
    }`,
  );
  return cleanInlineText(data.shop?.name || "");
}

async function requestShopifyAccessToken(input: {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
}) {
  const response = await fetch(
    `https://${input.shopDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: input.clientId,
        client_secret: input.clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Do not expose raw response; it may contain sensitive information.
  }
  if (!response.ok || !json.access_token) {
    const detail = String(
      json.error_description || json.error || json.message || "兑换失败",
    ).slice(0, 240);
    throw new Error(`Shopify Token 兑换失败（HTTP ${response.status}）：${detail}`);
  }
  const expiresIn =
    typeof json.expires_in === "number" && Number.isFinite(json.expires_in)
      ? Math.max(1, Math.floor(json.expires_in))
      : null;
  return { accessToken: String(json.access_token), expiresIn };
}

function normalizeShopDomainInput(value: unknown) {
  const domain = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new Error("SHOPIFY_SHOP_DOMAIN 必须是有效的 your-store.myshopify.com 域名。");
  }
  return domain;
}

function validateCredential(value: unknown, name: string) {
  const text = String(value || "").trim();
  if (!text || text.length > 500 || /[\r\n\0]/.test(text)) {
    throw new Error(`${name} 无效。`);
  }
  return text;
}

function normalizeStoreKey(value: string) {
  const key = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(key)) {
    throw new Error("店铺标识无效。");
  }
  return key;
}

function nextStoreKey(stores: ProductBatchStoreRecord[]) {
  const used = new Set(stores.map((store) => store.key.toLowerCase()));
  let number = 1;
  while (used.has(`store_${number}`)) number += 1;
  return `store_${number}`;
}

function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decryptSecret(value: string): string {
  const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("产品批量优化店铺 token 存储格式无效。");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function encryptionKey(): Buffer {
  const secret =
    process.env.SHOPIFY_TOKEN_SECRET ||
    process.env.SESSION_SECRET ||
    "dev-shopify-token-secret";
  return crypto.createHash("sha256").update(secret).digest();
}

function getRunsRoot() {
  return path.join(DATA_DIR_PATH, RUNS_DIR_NAME, "runs");
}

function getRunDir(runId: string) {
  assertSafeRunId(runId);
  return path.join(getRunsRoot(), runId);
}

function getRunFilePath(runId: string) {
  return path.join(getRunDir(runId), "proposals.json");
}

async function writeProductBatchJsonFailure(opts: {
  userId: number;
  model: string;
  shopDomain: string;
  productId: string;
  productTitle: string;
  rawText: string;
  error: unknown;
}): Promise<string | null> {
  try {
    const dir = path.join(DATA_DIR_PATH, RUNS_DIR_NAME, JSON_FAILURES_DIR_NAME);
    await fs.mkdir(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const hash = crypto
      .createHash("sha1")
      .update(`${opts.shopDomain}:${opts.productId}:${opts.rawText}`)
      .digest("hex")
      .slice(0, 10);
    const filename = [
      stamp,
      safeFilePart(opts.shopDomain),
      safeFilePart(opts.productId),
      hash,
    ].join("-") + ".json";
    const filePath = path.join(dir, filename);

    await fs.writeFile(
      filePath,
      `${JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          userId: opts.userId,
          model: opts.model,
          shopDomain: opts.shopDomain,
          productId: opts.productId,
          productTitle: opts.productTitle,
          error: opts.error instanceof Error ? opts.error.message : String(opts.error),
          rawLength: opts.rawText.length,
          rawText: opts.rawText,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    return path
      .join(RUNS_DIR_NAME, JSON_FAILURES_DIR_NAME, filename)
      .replace(/\\/g, "/");
  } catch (err) {
    console.error(
      "[product-batch] failed to write raw JSON failure:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function safeFilePart(value: string) {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "unknown";
}

async function writeProductBatchRun(run: ProductBatchRunDocument) {
  const dir = getRunDir(run.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getRunFilePath(run.id), JSON.stringify(run, null, 2), "utf8");
}

function toRunSummary(run: ProductBatchRunDocument): ProductBatchRunSummary {
  return {
    id: run.id,
    userId: run.userId,
    deviceId: run.deviceId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    shopDomain: run.shopDomain,
    shopName: run.shopName,
    storeKeys: run.storeKeys || [],
    stores: run.stores || [],
    proposalStores: getRunProposalStores(run),
    start: run.start || 0,
    query: run.query,
    prompt: run.prompt,
    limit: run.limit,
    model: run.model,
    proposalCount: run.proposalCount,
    failureCount: run.failureCount,
    stopped: Boolean(run.stopped),
    stopReason: run.stopReason || null,
    lastApplyAt: run.lastApplyAt || null,
  };
}

function getRunProposalStores(run: ProductBatchRunDocument) {
  const stores = new Map<string, { key: string; name: string | null; shopDomain: string }>();
  for (const proposal of run.proposals || []) {
    const key = String(proposal.store?.key || "").trim();
    if (!key || stores.has(key)) continue;
    stores.set(key, {
      key,
      name: proposal.store?.name || null,
      shopDomain: proposal.store?.shopDomain || "",
    });
  }
  return Array.from(stores.values());
}

function createRunId() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-preview`;
}

function assertSafeRunId(runId: string) {
  if (!/^[A-Za-z0-9_.-]+$/.test(runId)) {
    throw new Error("无效的运行记录 ID。");
  }
}

function cleanText(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function detectTargetFieldsFromPrompt(prompt: string): ProductBatchTargetField[] {
  const text = cleanInlineText(prompt).toLowerCase();
  if (!text) return [...PRODUCT_BATCH_TARGET_FIELDS];

  const fields = new Set<ProductBatchTargetField>();
  const add = (field: ProductBatchTargetField) => fields.add(field);
  const has = (pattern: RegExp) => pattern.test(text);
  const textWithoutSeoTitle = text.replace(/seo\s*标题|seo标题|页面标题/gu, "");
  const textWithoutMetaDescription = text.replace(
    /meta\s*描述|meta描述|元描述|meta\s*description/giu,
    "",
  );

  if (
    has(/商品标题|产品标题|product\s*title/i) ||
    textWithoutSeoTitle.includes("标题")
  ) {
    add("title");
  }
  if (
    has(/商品描述|产品描述|descriptionhtml|product\s*description/i) ||
    textWithoutMetaDescription.includes("描述") ||
    (has(/description/i) && !has(/meta\s*description/i))
  ) {
    add("descriptionHtml");
  }
  if (has(/seo\s*标题|seo标题|页面标题|page\s*title|seo\s*title/i)) add("seoTitle");
  if (has(/meta\s*描述|meta描述|元描述|meta\s*description/i)) add("metaDescription");
  if (has(/标签|tags?\b/i)) add("tags");
  if (has(/模板样式|模板|template/i)) add("templateStyle");
  if (has(/类别元字段尺寸|类别尺寸|category\s*size|尺寸/i)) add("categorySize");
  const categoryMetafieldKeys = detectTargetCategoryMetafieldKeys(prompt);
  if (categoryMetafieldKeys.some((key) => key !== "size")) add("categoryMetafields");
  if (
    has(
      /图片\s*alt|图片alt|图片\s*(?:名称|名字|文件名)|替代文本|替换文本|image\s*(?:alt|name)|file\s*name|filename|alt\b/i,
    )
  ) {
    add("imageAltTexts");
  }
  if (has(/faq|问答|常见问题/i)) add("faq");

  if (
    !fields.size ||
    has(/全部|所有字段|全字段|完整优化|整体优化|全部优化|全量|all\s*fields/i)
  ) {
    return [...PRODUCT_BATCH_TARGET_FIELDS];
  }

  return PRODUCT_BATCH_TARGET_FIELDS.filter((field) => fields.has(field));
}

function getProposalTargetFields(
  proposal: ProductBatchProposal,
  runTargetFields?: ProductBatchTargetField[],
): ProductBatchTargetField[] {
  const fields = proposal.targetFields?.length ? proposal.targetFields : runTargetFields;
  if (!fields?.length) return [...PRODUCT_BATCH_TARGET_FIELDS];
  const valid = new Set(PRODUCT_BATCH_TARGET_FIELDS);
  return fields.filter((field): field is ProductBatchTargetField => valid.has(field));
}

function constrainProposalToTargetFields(
  proposed: ProductBatchProposed,
  current: ProductBatchSnapshot,
  targetFields: ProductBatchTargetField[],
): ProductBatchProposed {
  const targets = new Set(targetFields);
  return {
    title: targets.has("title") ? proposed.title : current.title,
    handle: current.handle,
    descriptionHtml: targets.has("descriptionHtml")
      ? proposed.descriptionHtml
      : current.descriptionHtml,
    seoTitle: targets.has("seoTitle") ? proposed.seoTitle : current.seoTitle,
    metaDescription: targets.has("metaDescription")
      ? proposed.metaDescription
      : current.metaDescription,
    categorySize: targets.has("categorySize")
      ? proposed.categorySize
      : current.categorySize,
    categoryMetafields: targets.has("categoryMetafields")
      ? proposed.categoryMetafields
      : current.categoryMetafields,
    templateStyle: targets.has("templateStyle")
      ? proposed.templateStyle
      : current.templateStyle,
    tags: targets.has("tags") ? proposed.tags : current.tags,
    imageAltTexts: targets.has("imageAltTexts")
      ? proposed.imageAltTexts
      : current.imageAltTexts.map((item) => ({
          mediaId: item.mediaId,
          altText: item.altText,
          filename: item.filename,
        })),
    faq: targets.has("faq") ? proposed.faq : current.faq,
  };
}

function cleanInlineText(value: string) {
  return cleanText(value).replace(/\s+/g, " ").trim();
}

function clampText(value: string, maxChars: number) {
  const text = cleanInlineText(value);
  return text.length > maxChars ? text.slice(0, maxChars).trim() : text;
}

function normalizeProductHandle(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 255);
}

function normalizeFileName(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .trim()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 255);
}

function getFilenameFromUrl(url: string) {
  const rawPath = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return String(url || "").split(/[?#]/)[0];
    }
  })();
  const filename = rawPath.split("/").filter(Boolean).pop() || "";
  try {
    return normalizeFileName(decodeURIComponent(filename));
  } catch {
    return normalizeFileName(filename);
  }
}

function getImageExtension(url: string) {
  const filename = getFilenameFromUrl(url);
  const match = filename.match(/\.(?:jpg|jpeg|png|webp|gif|avif)$/i);
  return match ? match[0].toLowerCase() : ".jpg";
}

function buildProductImageFilename(title: string, index: number, sourceUrl: string) {
  const base = normalizeFileName(title).slice(0, 120) || "product-image";
  return normalizeFileName(`${base}-${index + 1}${getImageExtension(sourceUrl)}`);
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanInlineText(String(item || ""))).filter(Boolean);
}

function normalizeLabel(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function extractFaqNumber(label: string) {
  if (!/faq|question|answer|问题|答案|问答/.test(label)) return 0;
  const match = label.match(/[1-5]/);
  return match ? Number(match[0]) : 0;
}

function normalizeShopifyGraphqlErrors(errors: ShopifyGraphqlErrorPayload | undefined): string[] {
  if (!errors) return [];
  if (Array.isArray(errors)) {
    return errors
      .map((err) => err?.message || JSON.stringify(err))
      .filter(Boolean);
  }
  if (typeof errors === "string") return [errors].filter(Boolean);
  if (typeof errors === "object") {
    const message = typeof errors.message === "string" ? errors.message : "";
    if (message) return [message];
    try {
      return [JSON.stringify(errors)];
    } catch {
      return ["未知错误"];
    }
  }
  return [String(errors)];
}

function normalizeUserErrors(
  errors?: Array<{ field?: string[]; message?: string }>,
) {
  return (errors || [])
    .map((err) => {
      const field = err.field?.length ? `${err.field.join(".")}: ` : "";
      return `${field}${err.message || "未知错误"}`;
    })
    .filter(Boolean);
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function truncate(value: string, maxChars: number) {
  const text = String(value || "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
