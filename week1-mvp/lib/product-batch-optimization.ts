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
import { syncShopifyProductCategorySizeMetafield } from "./shopify";

const SHOPIFY_API_VERSION =
  process.env.SHOPIFY_API_VERSION?.trim() || "2026-04";
const APPLIED_TAG = "ai-seo-geo-applied";
const MAX_PREVIEW_LIMIT = 50;
const SHOPIFY_PRODUCT_FETCH_BATCH_SIZE = 10;
const RUNS_DIR_NAME = "product-batch-optimization";
const PRODUCT_BATCH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

type PreviewJobState = {
  id: string;
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
  "请根据现有商品资料优化 Shopify 商品标题、描述、SEO 标题、Meta 描述、标签、图片 Alt 和 FAQ。保持事实准确，不要编造材质、认证、折扣、物流或售后承诺。文案优先使用英文，适合礼服/婚纱独立站自然搜索和 AI 问答引用。";

const PRODUCT_BATCH_SYSTEM_PROMPT = `
你是专业的 Shopify 商品 SEO/GEO 内容编辑。你会基于输入的商品资料，优化商品标题、商品描述、页面标题、元描述、标签、图片 Alt 文本和 FAQ。

事实规则：
1. 只能使用输入资料中明确提供，或图片 URL/既有 alt/商品标题能合理支持的商品事实。
2. 不得虚构材质、功能、认证、保证、折扣、医疗功效、兼容性、库存、物流时效、退换政策或其他未经证实的信息。
3. 当资料不足或无法确认时，省略相关内容，不要为了完整而补充未经证实的信息。
4. 不得改变品牌名称、产品型号和其他关键商品信息。

文案规则：
1. 使用店铺目标语言、目标市场用语和品牌语气。
2. 标题必须重新优化，不得与原标题完全相同。
3. 描述正文只使用自然段，不要生成项目符号、编号列表、参数表或属性清单。
4. 描述 HTML 只能使用 p、strong、em、br 标签，不要把 FAQ 写进描述正文。
5. SEO 标题控制在 70 字符以内，Meta 描述控制在 160 字符以内。
6. 图片 Alt 简洁描述可见商品，不要重复 "image of"，不要堆砌关键词。
7. categorySize 表示 Shopify 类别元字段中的尺寸；不要写固定默认值，只能根据用户输入、现有商品资料或可确认的商品信息生成。
8. 如果 customInstructions 明确列出 categorySize/类别元字段尺寸的固定尺寸，categorySize 必须逐项复制这些值，不得新增、猜测或扩展未列出的尺寸。

输出规则：
1. 只返回合法 JSON，不要 Markdown、代码块、解释或 JSON 之外的文字。
2. JSON 必须匹配 schema。warnings 用来提示资料不足、疑似风险或需要人工确认的点。
3. rationale 必须使用中文，简洁说明本次优化了哪些内容以及为什么这样改。
`.trim();

const PRODUCT_BATCH_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    handle: { type: "string" },
    descriptionHtml: { type: "string" },
    seoTitle: { type: "string" },
    metaDescription: { type: "string" },
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
    "metaDescription",
    "tags",
    "imageAltTexts",
    "categorySize",
    "faq",
    "rationale",
    "warnings",
  ],
};

export type ProductBatchImageSnapshot = {
  mediaId: string;
  altText: string;
  url: string;
  width?: number | null;
  height?: number | null;
};

export type ProductBatchFaqItem = {
  question: string;
  answer: string;
};

export type ProductBatchSnapshot = {
  title: string;
  handle: string;
  descriptionHtml: string;
  seoTitle: string;
  metaDescription: string;
  categorySize: string;
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
  tags: string[];
  imageAltTexts: Array<{ mediaId: string; altText: string }>;
  faq: ProductBatchFaqItem[];
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
  changeSummary: Record<string, boolean | number>;
  rationale: string;
  warnings: string[];
};

export type ProductBatchRunSummary = {
  id: string;
  createdAt: number;
  updatedAt: number;
  shopDomain: string;
  shopName: string | null;
  storeKeys: string[];
  stores: Array<{ key: string; name: string | null; shopDomain: string }>;
  start: number;
  query: string;
  prompt: string;
  limit: number;
  model: string;
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
  status?: string | null;
  category?: { id?: string | null } | null;
  tags?: string[] | null;
  descriptionHtml?: string | null;
  seo?: { title?: string | null; description?: string | null } | null;
  metafields?: { nodes?: ShopifyMetafieldNode[] | null } | null;
  media?: { edges?: Array<{ node?: ShopifyMediaNode | null }> | null } | null;
};

type ShopifyGraphqlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type ShopifyProductsQueryData = {
  products: {
    edges: Array<{ cursor: string; node: ShopifyProductNode }>;
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  };
};

const PRODUCTS_QUERY = `
query Products($first: Int!, $after: String, $query: String) {
  products(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    edges {
      cursor
      node {
        id
        legacyResourceId
        title
        handle
        vendor
        productType
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

export async function getProductBatchStatus() {
  const stores = await listProductBatchStores();
  const runs = await listProductBatchRuns();
  return {
    stores,
    runs,
    appliedTag: APPLIED_TAG,
    rulesVersion: PRODUCT_BATCH_RULES.rulesVersion,
    defaultPrompt: PRODUCT_BATCH_DEFAULT_PROMPT,
  };
}

export async function listProductBatchStores(): Promise<ProductBatchStoreSafe[]> {
  const doc = await readStoresDocument();
  return doc.stores.map(toSafeStore);
}

export async function exchangeAndSaveProductBatchStore(input: {
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
  if (
    doc.stores.some(
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
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const expiresAt =
    token.expiresIn && token.expiresIn > 0
      ? new Date(nowMs + token.expiresIn * 1000).toISOString()
      : new Date(nowMs + PRODUCT_BATCH_TOKEN_TTL_MS).toISOString();
  const store: ProductBatchStoreRecord = {
    key: nextStoreKey(doc.stores),
    name: shopDomain.replace(/\.myshopify\.com$/i, ""),
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

export async function deleteProductBatchStore(storeKey: string) {
  const key = normalizeStoreKey(storeKey);
  const doc = await readStoresDocument();
  const before = doc.stores.length;
  doc.stores = doc.stores.filter((store) => store.key !== key);
  if (doc.stores.length === before) {
    throw new Error("店铺不存在或已被删除。");
  }
  await writeStoresDocument(doc);
  return { ok: true, deletedStoreKey: key };
}

export function cancelProductBatchPreview(jobId: string) {
  const id = cleanJobId(jobId);
  const job = previewJobs.get(id);
  if (!job) {
    return { ok: false, cancelled: false, reason: "任务不存在或已经结束。" };
  }
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

export async function listProductBatchRuns(): Promise<ProductBatchRunSummary[]> {
  const root = getRunsRoot();
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const runs: ProductBatchRunSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const doc = await readProductBatchRun(entry.name);
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
): Promise<ProductBatchRunDocument> {
  const filePath = getRunFilePath(runId);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as ProductBatchRunDocument;
}

export async function deleteProductBatchRun(runId: string) {
  const dir = getRunDir(runId);
  await fs.rm(dir, { recursive: true, force: true });
  return { ok: true };
}

export async function createProductBatchPreview(opts: {
  user: User;
  jobId?: string;
  storeKeys?: string[];
  query?: string;
  start?: number;
  limit?: number;
  prompt?: string;
  includeImages?: boolean;
  includeApplied?: boolean;
  model?: string | null;
}): Promise<ProductBatchRunDocument> {
  assertWithinBudget(opts.user.id, opts.user.role);

  const previewJob = createPreviewJob(opts.jobId);
  const stores = await requireStoreTokens(opts.storeKeys);
  const limit = clampInt(opts.limit ?? 10, 1, MAX_PREVIEW_LIMIT);
  const start = clampInt(opts.start ?? 0, 0, 100_000);
  const query = cleanText(opts.query || "status:active");
  const prompt = cleanText(opts.prompt || PRODUCT_BATCH_DEFAULT_PROMPT);
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

    while (storeProcessed < limit) {
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
        products = await fetchProducts({
          connection: store,
          query,
          start: start + storeProcessed,
          limit: batchLimit,
          includeApplied,
          signal: previewJob?.controller.signal,
        });
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
      if (!products.length) {
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
              connection: store,
              product,
              prompt,
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
      if (products.length < batchLimit) {
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
    createdAt: now,
    updatedAt: now,
    shopDomain: runStores[0]?.shopDomain || "",
    shopName: runStores[0]?.name || null,
    storeKeys: runStores.map((store) => store.key),
    stores: runStores,
    start,
    query,
    prompt,
    limit,
    model,
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
  runId: string;
  selectedProductIds?: string[];
  selectedProposalKeys?: string[];
  skipImageAlt?: boolean;
  applyFaq?: boolean;
  setDraft?: boolean;
}): Promise<{ run: ProductBatchRunDocument; results: ProductBatchApplyResult[] }> {
  const run = await readProductBatchRun(opts.runId);
  const stores = await requireStoreTokens(run.storeKeys?.length ? run.storeKeys : undefined);
  const storeByKey = new Map(stores.map((store) => [store.key, store]));

  const selectedProposalKeys = new Set(opts.selectedProposalKeys || []);
  const selectedProductIds = new Set(opts.selectedProductIds || []);
  const proposals = selectedProposalKeys.size
    ? run.proposals.filter((item) => selectedProposalKeys.has(getProposalKey(item)))
    : selectedProductIds.size
      ? run.proposals.filter((item) => selectedProductIds.has(item.product.id))
      : run.proposals;
  if (!proposals.length) {
    throw new Error("没有选中可应用的商品。");
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
      const storeKey = proposal.store.key || run.storeKeys?.[0] || "";
      const connection = storeByKey.get(storeKey);
      if (!connection) {
        throw new Error(`店铺 ${storeKey || "未知"} 未绑定或 token 不存在。`);
      }
      result.productUpdate = await updateProduct(connection, proposal);
      if (opts.applyFaq !== false) {
        result.faqUpdate = await updateFaqMetafields(
          connection,
          proposal.product.id,
          proposal.proposed.faq,
        );
      }
      if (opts.skipImageAlt === false && proposal.proposed.imageAltTexts.length) {
        result.imageAltUpdate = await updateImageAltTexts(
          connection,
          proposal.proposed.imageAltTexts,
        );
      }
      if (proposal.proposed.categorySize) {
        result.categorySizeUpdate = await updateCategorySizeMetafield(
          connection,
          proposal,
        );
      }
      if (opts.setDraft) {
        result.draftUpdate = await updateProductStatus(
          connection,
          proposal.product.id,
          "DRAFT",
        );
      }
      result.appliedTagUpdate = await markProductApplied(
        connection,
        proposal.product.id,
      );
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

async function requireStoreTokens(storeKeys?: string[]): Promise<ShopifyToken[]> {
  const doc = await readStoresDocument();
  if (!doc.stores.length) {
    throw new Error("请先在产品批量优化里添加 Shopify 店铺。");
  }
  const wanted = new Set((storeKeys || []).map(normalizeStoreKey));
  const records = wanted.size
    ? doc.stores.filter((store) => wanted.has(store.key))
    : doc.stores;
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
  start: number;
  limit: number;
  includeApplied: boolean;
  signal?: AbortSignal;
}): Promise<ShopifyProductNode[]> {
  const products: ShopifyProductNode[] = [];
  let skipped = 0;
  let after: string | null = null;
  let page = 0;
  const maxPages = Math.max(
    12,
    Math.ceil((opts.start + opts.limit) / SHOPIFY_PRODUCT_FETCH_BATCH_SIZE) + 2,
  );
  while (products.length < opts.limit && page < maxPages) {
    if (opts.signal?.aborted) throw new Error("已强制停止");
    page += 1;
    const pageData: ShopifyProductsQueryData =
      await shopifyGraphql<ShopifyProductsQueryData>(opts.connection, PRODUCTS_QUERY, {
      first: Math.min(
        SHOPIFY_PRODUCT_FETCH_BATCH_SIZE,
        Math.max(1, opts.limit - products.length),
      ),
      after,
      query: opts.query || null,
    }, opts.signal);
    const productsConnection = pageData.products;
    for (const edge of productsConnection.edges || []) {
      const product = edge.node;
      if (!opts.includeApplied && hasAppliedTag(product)) continue;
      if (skipped < opts.start) {
        skipped += 1;
        continue;
      }
      products.push(product);
      if (products.length >= opts.limit) break;
    }
    after = productsConnection.pageInfo?.endCursor || null;
    if (!productsConnection.pageInfo?.hasNextPage || !after) break;
  }
  return products;
}

async function generateProductProposal(opts: {
  user: User;
  connection: ShopifyToken;
  product: ShopifyProductNode;
  prompt: string;
  includeImages: boolean;
  model: string;
  signal?: AbortSignal;
}): Promise<ProductBatchProposal> {
  if (opts.signal?.aborted) {
    throw new Error("已强制停止");
  }
  const images = getProductImages(opts.product).slice(0, 8);
  const promptData = {
    store: {
      key: opts.connection.key,
      name: opts.connection.name || opts.connection.shopDomain,
      shopDomain: opts.connection.shopDomain,
      language: opts.connection.language || "English unless the user prompt says otherwise",
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
      categoryMetafields: {
        categorySize: getProductCategorySize(opts.product),
      },
      descriptionHtml: truncate(opts.product.descriptionHtml || "", 7000),
      images: images.map((image) => ({
        mediaId: image.mediaId,
        url: opts.includeImages ? image.url : "",
        existingAltText: image.altText,
        width: image.width || null,
        height: image.height || null,
      })),
    },
    rules: PRODUCT_BATCH_RULES,
    customInstructions: opts.prompt,
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
                      "Rewrite this Shopify product for SEO and GEO. Return only JSON that matches the schema.\n\n" +
                      JSON.stringify(promptData, null, 2),
                  },
                ],
              },
            ],
            config: {
              systemInstruction: PRODUCT_BATCH_SYSTEM_PROMPT,
              responseMimeType: "application/json",
              responseSchema: PRODUCT_BATCH_OUTPUT_SCHEMA,
              temperature: 0.25,
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
  const raw = parseJsonObject(rawText);
  const proposed = normalizeGeneratedProposal(raw, opts.product, images, opts.prompt);
  const current = getCurrentSnapshot(opts.product, images);

  return {
    store: {
      key: opts.connection.key,
      name: opts.connection.name,
      shopDomain: opts.connection.shopDomain,
      language: opts.connection.language || "English",
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
    changeSummary: summarizeChanges(current, proposed),
    rationale: cleanText(String(raw.rationale || "")),
    warnings: normalizeStringArray(raw.warnings).slice(0, 8),
  };
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
  const imageAltTexts = Array.isArray(raw.imageAltTexts)
    ? raw.imageAltTexts
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          mediaId: cleanText(String(item.mediaId || "")),
          altText: clampText(
            String(item.altText || ""),
            limits.imageAltTextMaxChars,
          ),
        }))
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

  return {
    title: clampText(String(raw.title || product.title || ""), limits.productTitleMaxChars),
    handle:
      normalizeProductHandle(raw.handle || raw.title) ||
      normalizeProductHandle(product.handle),
    descriptionHtml,
    seoTitle: clampText(String(raw.seoTitle || ""), limits.seoTitleMaxChars),
    metaDescription: clampText(
      String(raw.metaDescription || ""),
      limits.metaDescriptionMaxChars,
    ),
    categorySize,
    tags: stripAppliedTag(normalizeTags(raw.tags, product.tags || [])),
    imageAltTexts,
    faq,
  };
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
  if (!opts.currentOptions.length) return cleaned;

  const allowed = new Set(opts.currentOptions);
  const kept = parseSizeOptions(cleaned).filter((size) => allowed.has(size));
  return kept.length ? kept.join(", ") : cleanInlineText(opts.fallback || "");
}

function summarizeChanges(
  current: ProductBatchSnapshot,
  proposed: ProductBatchProposed,
) {
  return {
    titleChanged: current.title !== proposed.title,
    handleChanged: current.handle !== proposed.handle,
    descriptionChanged: current.descriptionHtml !== proposed.descriptionHtml,
    seoTitleChanged: current.seoTitle !== proposed.seoTitle,
    metaDescriptionChanged: current.metaDescription !== proposed.metaDescription,
    categorySizeChanged: current.categorySize !== proposed.categorySize,
    tagsChanged: JSON.stringify(current.tags) !== JSON.stringify(proposed.tags),
    faqChanged: JSON.stringify(current.faq) !== JSON.stringify(proposed.faq),
    imageAltTextUpdates: proposed.imageAltTexts.length,
  };
}

async function updateProduct(
  connection: ShopifyToken,
  proposal: ProductBatchProposal,
) {
  const data = await shopifyGraphql<{
    productUpdate: {
      product: unknown;
      userErrors: Array<{ field?: string[]; message?: string }>;
    };
  }>(connection, PRODUCT_UPDATE_MUTATION, {
    product: {
      id: proposal.product.id,
      title: proposal.proposed.title,
      handle: proposal.proposed.handle,
      descriptionHtml: proposal.proposed.descriptionHtml,
      seo: {
        title: proposal.proposed.seoTitle,
        description: proposal.proposed.metaDescription,
      },
      tags: stripAppliedTag(proposal.proposed.tags),
    },
  });
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
  imageAltTexts: Array<{ mediaId: string; altText: string }>,
) {
  const files = imageAltTexts
    .filter((item) => item.mediaId && item.altText)
    .map((item) => ({ id: item.mediaId, alt: item.altText }));
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

async function updateCategorySizeMetafield(
  connection: ShopifyToken,
  proposal: ProductBatchProposal,
) {
  const categorySize = cleanInlineText(proposal.proposed.categorySize || "");
  if (!categorySize) return { skipped: true, reason: "no category size" };
  const categoryId = proposal.product.categoryId || "";
  if (!categoryId) {
    return { skipped: true, reason: "product has no Shopify category" };
  }
  return syncShopifyProductCategorySizeMetafield({
    shopDomain: connection.shopDomain,
    accessToken: connection.accessToken,
    productId: proposal.product.id,
    categoryId,
    categorySize,
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
): Promise<T> {
  const domain = normalizeShopDomainInput(connection.shopDomain);
  const endpoint = `https://${domain}/admin/api/${connection.apiVersion || SHOPIFY_API_VERSION}/graphql.json`;
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
  if (!response.ok) {
    throw new Error(
      `Shopify 请求失败：HTTP ${response.status} ${truncate(JSON.stringify(json), 500)}`,
    );
  }
  if (json.errors?.length) {
    throw new Error(
      `Shopify GraphQL 错误：${json.errors
        .map((err) => err.message || "未知错误")
        .join("；")}`,
    );
  }
  return (json.data || {}) as T;
}

function getProductImages(product: ShopifyProductNode): ProductBatchImageSnapshot[] {
  const edges = product.media?.edges || [];
  return edges
    .map((edge) => edge.node)
    .filter((node): node is ShopifyMediaNode => Boolean(node))
    .map((node) => {
      const image = node.image || node.preview?.image || null;
      return {
        mediaId: node.id || "",
        altText: node.image?.altText || node.alt || "",
        url: image?.url || "",
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

function hasAppliedTag(product: ShopifyProductNode) {
  return (product.tags || []).some(
    (tag) => String(tag || "").toLowerCase() === APPLIED_TAG,
  );
}

function stripAppliedTag(tags: unknown): string[] {
  const values = Array.isArray(tags) ? tags : [];
  return values
    .map((tag) => String(tag || "").trim())
    .filter((tag) => tag && tag.toLowerCase() !== APPLIED_TAG);
}

function withAppliedTag(tags: string[]) {
  if (tags.some((tag) => tag.toLowerCase() === APPLIED_TAG)) return tags;
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
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    }
  }
  throw new Error(`模型返回的 JSON 无法解析：${truncate(text, 500)}`);
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

function createPreviewJob(jobId?: string): PreviewJobState | null {
  if (!jobId) return null;
  const id = cleanJobId(jobId);
  const existing = previewJobs.get(id);
  if (existing && !existing.cancelled) {
    throw new Error("同一个预览任务正在运行，请稍后再试。");
  }
  const job: PreviewJobState = {
    id,
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
    name: cleanInlineText(store.name || store.shopDomain.replace(/\.myshopify\.com$/i, "")),
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
    name: store.name || store.shopDomain.replace(/\.myshopify\.com$/i, ""),
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

async function writeProductBatchRun(run: ProductBatchRunDocument) {
  const dir = getRunDir(run.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getRunFilePath(run.id), JSON.stringify(run, null, 2), "utf8");
}

function toRunSummary(run: ProductBatchRunDocument): ProductBatchRunSummary {
  return {
    id: run.id,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    shopDomain: run.shopDomain,
    shopName: run.shopName,
    storeKeys: run.storeKeys || [],
    stores: run.stores || [],
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
