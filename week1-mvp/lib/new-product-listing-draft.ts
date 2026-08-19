export const PRODUCT_LISTING_MEDIA_STORAGE_KEY =
  "buqiqi:new-product-listing:media";
export const PRODUCT_LISTING_NOTICE_STORAGE_KEY =
  "buqiqi:new-product-listing:notice";
export const PRODUCT_LISTING_PROMPT_PRESETS_STORAGE_KEY =
  "buqiqi:new-product-listing:prompt-presets";

export type ProductMediaRole = "main" | "detail" | "back";

export interface ProductMediaWatermarkPlacement {
  /** 水印中心点横向位置，0-1 */
  x: number;
  /** 水印中心点纵向位置，0-1 */
  y: number;
  /** 水印宽度占原图宽度的比例，0-1 */
  width: number;
}

export interface ProductMediaWatermark {
  id: string;
  name: string;
  /** 未叠加水印的源图；再次调整时始终从该图重新合成 */
  sourceUrl: string;
  placement: ProductMediaWatermarkPlacement;
}

export interface ProductListingPromptPreset {
  id: string;
  name: string;
  prompt: string;
  createdAt: number;
}

export interface ProductListingMediaItem {
  id: string;
  url: string;
  alt: string;
  role: ProductMediaRole;
  addedAt: number;
  sourceJobId?: string;
  sourceItemId?: number;
  sourceLabel?: string;
  watermark?: ProductMediaWatermark;
}

export interface ProductListingMediaInput {
  url: string;
  alt?: string | null;
  role?: ProductMediaRole;
  sourceJobId?: string;
  sourceItemId?: number;
  sourceLabel?: string | null;
}

export const PRODUCT_MEDIA_ROLE_LABELS: Record<ProductMediaRole, string> = {
  main: "主图",
  detail: "细节",
  back: "背面",
};

export const DEFAULT_PRODUCT_LISTING_PROMPT_PRESETS: ProductListingPromptPreset[] =
  [
    {
      id: "default-shopify-dress-listing",
      name: "礼服商品上架",
      prompt:
        "请根据媒体 Media 中的商品图片，生成适合 Shopify 上架的英文商品信息。请输出：商品标题、商品描述、产品类型、供应商、产品系列、标签、主色调、面料材质、领口设计、整体版型、类别元字段颜色、类别元字段尺寸、类别元字段织物、类别元字段年龄段、类别元字段穿着场合、类别元字段裙子风格、类别元字段领口、类别元字段裙子/连衣裙长度类型、类别元字段袖长类型、类别元字段目标性别、SKU、原价、售价、库存、SEO标题、SEO描述。要求内容面向礼服电商，描述自然专业，产品系列和标签用英文逗号分隔，输出为 key: value 格式。",
      createdAt: 0,
    },
  ];

export function appendProductListingMedia(
  current: ProductListingMediaItem[],
  incoming: ProductListingMediaInput[],
): { media: ProductListingMediaItem[]; addedCount: number } {
  const media = [...current];
  const knownUrls = new Set(media.map((item) => item.url.trim()));
  let addedCount = 0;

  for (const item of incoming) {
    const url = item.url.trim();
    if (!url || knownUrls.has(url)) continue;
    const isFirst = media.length === 0;
    media.push({
      id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url,
      alt: item.alt?.trim() || item.sourceLabel?.trim() || "商品图片",
      role: item.role || (isFirst ? "main" : "detail"),
      addedAt: Date.now(),
      sourceJobId: item.sourceJobId,
      sourceItemId: item.sourceItemId,
      sourceLabel: item.sourceLabel?.trim() || undefined,
    });
    knownUrls.add(url);
    addedCount += 1;
  }

  return { media, addedCount };
}
