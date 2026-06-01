"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Link,
  RefreshCw,
  Save,
  Search,
  Send,
  ShoppingBag,
  Star,
  Store,
  Tags,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Dialog,
  IconButton,
  Input,
  Select,
  Textarea,
} from "@/app/_components/ui";
import { Thumbnail, ThumbnailBadge } from "@/app/_components/thumbnail";
import { PageRefreshButton } from "@/app/_components/page-refresh-button";
import {
  appendProductListingMedia,
  DEFAULT_PRODUCT_LISTING_PROMPT_PRESETS,
  PRODUCT_LISTING_MEDIA_STORAGE_KEY,
  PRODUCT_LISTING_NOTICE_STORAGE_KEY,
  PRODUCT_LISTING_PROMPT_PRESETS_STORAGE_KEY,
  PRODUCT_MEDIA_ROLE_LABELS,
  type ProductListingMediaItem,
  type ProductListingPromptPreset,
  type ProductMediaRole,
} from "@/lib/product-listing-draft";
import { fetchWithShopifyDevice } from "@/lib/shopify-device-client";

type ShopifyBinding = {
  shopDomain: string;
  authMode: "access_token" | "oauth_app" | "client_credentials";
  tokenPreview: string;
  clientIdPreview: string | null;
  shopName: string | null;
  myshopifyDomain: string | null;
  primaryDomain: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastTestedAt: number | null;
};

type SyncState = "idle" | "draft" | "syncing" | "synced";
type SyncAction = "draft" | "publish" | null;
type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

type ProductForm = {
  title: string;
  description: string;
  shopifyCategoryId: string;
  shopifyCategoryName: string;
  productType: string;
  vendor: string;
  templateStyle: string;
  collections: string;
  tags: string;
  color: string;
  material: string;
  neckline: string;
  silhouette: string;
  sku: string;
  compareAtPrice: string;
  price: string;
  inventory: string;
  status: ProductStatus;
  categoryColor: string;
  categorySize: string;
  categoryFabric: string;
  categoryAgeGroup: string;
  categoryOccasion: string;
  categoryDressStyle: string;
  categoryNeckline: string;
  categoryDressLengthType: string;
  categorySleeveLengthType: string;
  categoryTargetGender: string;
  seoTitle: string;
  seoDescription: string;
  variantOptionName: string;
};

type CategoryMetafieldFormKey =
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

type CategoryMetafieldMemory = Partial<Record<CategoryMetafieldFormKey, string[]>>;

type ShopifyCategoryMetafieldOption = {
  id: string;
  label: string;
  value: string;
  attributeName: string;
};

type ShopifyCategoryMetafieldField = {
  formKey: string;
  label: string;
  shopifyName: string | null;
  shopifyKey: string | null;
  shopifyType: string | null;
  source: "store" | "official" | "none";
  options: ShopifyCategoryMetafieldOption[];
};

type ShopifyCategoryMetafieldFields = Partial<
  Record<CategoryMetafieldFormKey, ShopifyCategoryMetafieldField>
>;

type ShopifyTaxonomyCategoryOption = {
  id: string;
  name: string;
  fullName: string;
  parentId: string | null;
  level: number;
  isRoot: boolean;
  isLeaf: boolean;
  childrenCount: number;
};

type ShopifySyncResult = {
  productId: string;
  title: string;
  handle: string | null;
  legacyResourceId: string | null;
  adminUrl: string | null;
  warnings: string[];
};

type ProductVariantRow = {
  id: string;
  size: string;
  sku: string;
  price: string;
  inventory: string;
  selected: boolean;
  isMainImage: boolean;
  imageUrl: string;
  imageAlt: string;
};

const DEFAULT_SIZE_VARIANT_OPTIONS = [
  "US 2 / UK 6 / EU 32",
  "US 4 / UK 8 / EU 34",
  "US 6 / UK 10 / EU 36",
  "US 8 / UK 12 / EU 38",
  "US 10 / UK 14 / EU 40",
  "US 12 / UK 16 / EU 42",
  "US 14 / UK 18 / EU 44",
  "US 16 / UK 20 / EU 46",
  "US 16Plus / UK 20 / EU 46",
  "US 18Plus / UK 22 / EU 48",
  "US 20Plus / UK 24 / EU 50",
  "US 22Plus / UK 26 / EU 52",
  "US 24Plus / UK 28 / EU 54",
  "US 26Plus / UK 30 / EU 56",
];
const PRODUCT_TAG_QUICK_OPTIONS = ["ONLY", "MANYCOLOR"];
const CATEGORY_METAFIELD_MEMORY_STORAGE_KEY =
  "buqiqi_product_listing_category_metafield_memory_v1";
const CATEGORY_METAFIELD_MEMORY_LIMIT = 20;
const SHOPIFY_PRODUCT_STATUS_OPTIONS: Array<{
  value: ProductStatus;
  label: string;
  description: string;
}> = [
  {
    value: "ACTIVE",
    label: "已上架",
    description: "通过所选销售渠道和市场销售",
  },
  {
    value: "DRAFT",
    label: "草稿",
    description: "在所选销售渠道或市场上不可见",
  },
  {
    value: "ARCHIVED",
    label: "未上架",
    description: "仅可通过直接链接访问",
  },
];

const CATEGORY_METAFIELD_ROWS: Array<{
  key: CategoryMetafieldFormKey;
  label: string;
}> = [
  { key: "categoryColor", label: "颜色" },
  { key: "categorySize", label: "尺寸" },
  { key: "categoryFabric", label: "织物" },
  { key: "categoryAgeGroup", label: "年龄段" },
  { key: "categoryOccasion", label: "穿着场合" },
  { key: "categoryDressStyle", label: "裙子风格" },
  { key: "categoryNeckline", label: "领口" },
  { key: "categoryDressLengthType", label: "裙子/连衣裙长度类型" },
  { key: "categorySleeveLengthType", label: "袖长类型" },
  { key: "categoryTargetGender", label: "目标性别" },
];

const VARIANT_OPTION_RECOMMENDATIONS = [
  "颜色",
  "尺寸",
  "织物",
  "年龄段",
  "穿着场合",
  "裙子风格",
  "领口",
  "裙子/连衣裙长度类型",
  "袖长类型",
];

const CATEGORY_COLOR_OPTIONS = [
  { label: "海军蓝", value: "海军蓝", color: "#2d2aa4", badge: "推荐" },
  { label: "White", value: "White", color: "#ffffff", ring: true },
  { label: "Apricot", value: "Apricot", color: "#f4dfaa" },
  { label: "Champagne", value: "Champagne", color: "#f3e2b7" },
  { label: "Purple", value: "Purple", color: "#9b51d6" },
  { label: "Blue", value: "Blue", color: "#0b6bd3" },
  { label: "Red", value: "Red", color: "#f32728" },
  { label: "Pink", value: "Pink", color: "#ffb3c1" },
  { label: "青铜色", value: "青铜色", color: "#cd7f32" },
  { label: "黑色", value: "黑色", color: "#000000" },
  { label: "金色", value: "金色", color: "#d39a00" },
  { label: "橙色", value: "橙色", color: "#ff8a00" },
  { label: "白", value: "白", color: "#ffffff", ring: true },
  { label: "花型", value: "花型", color: "#ffffff", patterned: true },
  { label: "紫色", value: "紫色", color: "#8a2be2" },
  { label: "黄色", value: "黄色", color: "#f5e300" },
  { label: "粉红色", value: "粉红色", color: "#ffb6c8" },
  { label: "棕色", value: "棕色", color: "#9a5a33" },
  { label: "红酒", value: "红酒", color: "#b91c2b" },
  { label: "灰色", value: "灰色", color: "#808080" },
  { label: "茶色", value: "茶色", color: "#c8a466" },
  { label: "绿色", value: "绿色", color: "#0dad49" },
  { label: "蓝色", value: "蓝色", color: "#0b6bd3" },
  { label: "Beige", value: "Beige", color: "#e8d6a9", group: "默认条目" },
  { label: "Black", value: "Black", color: "#000000", group: "默认条目" },
  { label: "Bronze", value: "Bronze", color: "#cd7f32", group: "默认条目" },
  { label: "Brown", value: "Brown", color: "#9a5a33", group: "默认条目" },
  { label: "Clear", value: "Clear", color: "#ffffff", ring: true, group: "默认条目" },
  { label: "Gold", value: "Gold", color: "#d39a00", group: "默认条目" },
  { label: "Gray", value: "Gray", color: "#808080", group: "默认条目" },
  { label: "Green", value: "Green", color: "#0dad49", group: "默认条目" },
  { label: "Navy", value: "Navy", color: "#2d2aa4", group: "默认条目" },
  { label: "Orange", value: "Orange", color: "#ff8a00", group: "默认条目" },
  { label: "Rose gold", value: "Rose gold", color: "#b76e79", group: "默认条目" },
  { label: "Silver", value: "Silver", color: "#c0c0c0", group: "默认条目" },
];

const TEST_SHOP_DOMAIN = "test.myshopify.com";
const TEST_ACCESS_TOKEN = "shpat_test_buqiqi";

const EMPTY_FORM: ProductForm = {
  title: "",
  description: "",
  shopifyCategoryId: "gid://shopify/TaxonomyCategory/na",
  shopifyCategoryName: "未分类",
  productType: "",
  vendor: "",
  templateStyle: "",
  collections: "",
  tags: "",
  color: "",
  material: "",
  neckline: "",
  silhouette: "",
  sku: "",
  compareAtPrice: "",
  price: "",
  inventory: "",
  status: "DRAFT",
  categoryColor: "",
  categorySize: "",
  categoryFabric: "",
  categoryAgeGroup: "",
  categoryOccasion: "",
  categoryDressStyle: "",
  categoryNeckline: "",
  categoryDressLengthType: "",
  categorySleeveLengthType: "",
  categoryTargetGender: "",
  seoTitle: "",
  seoDescription: "",
  variantOptionName: "Size",
};

const SHOPIFY_CATEGORY_OPTIONS = [
  {
    id: "gid://shopify/TaxonomyCategory/ap",
    zh: "动物/宠物用品",
    en: "Animals & Pet Supplies",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa",
    zh: "服饰与配饰",
    en: "Apparel & Accessories",
  },
  {
    id: "gid://shopify/TaxonomyCategory/ae",
    zh: "艺术与娱乐",
    en: "Arts & Entertainment",
  },
  {
    id: "gid://shopify/TaxonomyCategory/bt",
    zh: "婴幼儿用品",
    en: "Baby & Toddler",
  },
  {
    id: "gid://shopify/TaxonomyCategory/bi",
    zh: "商业/工业",
    en: "Business & Industrial",
  },
  {
    id: "gid://shopify/TaxonomyCategory/co",
    zh: "相机与光学器件",
    en: "Cameras & Optics",
  },
  {
    id: "gid://shopify/TaxonomyCategory/el",
    zh: "电子产品",
    en: "Electronics",
  },
  {
    id: "gid://shopify/TaxonomyCategory/fb",
    zh: "饮食/烟酒",
    en: "Food, Beverages & Tobacco",
  },
  {
    id: "gid://shopify/TaxonomyCategory/fr",
    zh: "家具",
    en: "Furniture",
  },
  {
    id: "gid://shopify/TaxonomyCategory/ha",
    zh: "五金/硬件",
    en: "Hardware",
  },
  {
    id: "gid://shopify/TaxonomyCategory/hb",
    zh: "保健/美容/卫生/护理",
    en: "Health & Beauty",
  },
  {
    id: "gid://shopify/TaxonomyCategory/hg",
    zh: "家居与园艺",
    en: "Home & Garden",
  },
  {
    id: "gid://shopify/TaxonomyCategory/lb",
    zh: "箱包",
    en: "Luggage & Bags",
  },
  {
    id: "gid://shopify/TaxonomyCategory/ma",
    zh: "成人",
    en: "Mature",
  },
  {
    id: "gid://shopify/TaxonomyCategory/me",
    zh: "媒体",
    en: "Media",
  },
  {
    id: "gid://shopify/TaxonomyCategory/os",
    zh: "办公用品",
    en: "Office Supplies",
  },
  {
    id: "gid://shopify/TaxonomyCategory/rc",
    zh: "宗教/仪式",
    en: "Religious & Ceremonial",
  },
  {
    id: "gid://shopify/TaxonomyCategory/so",
    zh: "软件",
    en: "Software",
  },
  {
    id: "gid://shopify/TaxonomyCategory/sg",
    zh: "体育用品",
    en: "Sporting Goods",
  },
  {
    id: "gid://shopify/TaxonomyCategory/tg",
    zh: "玩具/游戏",
    en: "Toys & Games",
  },
  {
    id: "gid://shopify/TaxonomyCategory/vp",
    zh: "交通工具/汽车/飞机/船舶",
    en: "Vehicles & Parts",
  },
  {
    id: "gid://shopify/TaxonomyCategory/gc",
    zh: "礼品卡",
    en: "Gift Cards",
  },
  {
    id: "gid://shopify/TaxonomyCategory/na",
    zh: "未分类",
    en: "Uncategorized",
  },
  {
    id: "gid://shopify/TaxonomyCategory/se",
    zh: "服务",
    en: "Services",
  },
  {
    id: "gid://shopify/TaxonomyCategory/pa",
    zh: "产品附加件",
    en: "Product Add-Ons",
  },
  {
    id: "gid://shopify/TaxonomyCategory/bu",
    zh: "套装",
    en: "Bundles",
  },
] as const;

const SHOPIFY_APPAREL_ACCESSORY_OPTIONS = [
  {
    id: "gid://shopify/TaxonomyCategory/aa-1",
    parentId: "gid://shopify/TaxonomyCategory/aa",
    zh: "服装",
    en: "Clothing",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-2",
    parentId: "gid://shopify/TaxonomyCategory/aa",
    zh: "服装配饰",
    en: "Clothing Accessories",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-3",
    parentId: "gid://shopify/TaxonomyCategory/aa",
    zh: "演出服与配饰",
    en: "Costumes & Accessories",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-4",
    parentId: "gid://shopify/TaxonomyCategory/aa",
    zh: "手提包/钱包配件",
    en: "Handbag & Wallet Accessories",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-5",
    parentId: "gid://shopify/TaxonomyCategory/aa",
    zh: "手提包、钱包与箱包",
    en: "Handbags, Wallets & Cases",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-6",
    parentId: "gid://shopify/TaxonomyCategory/aa",
    zh: "珠宝首饰",
    en: "Jewelry",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-7",
    parentId: "gid://shopify/TaxonomyCategory/aa",
    zh: "鞋类配饰",
    en: "Shoe Accessories",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-8",
    parentId: "gid://shopify/TaxonomyCategory/aa",
    zh: "鞋类",
    en: "Shoes",
  },
] as const;

const SHOPIFY_CLOTHING_OPTIONS = [
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-1",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "运动服装",
    en: "Activewear",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-10",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "外衣",
    en: "Outerwear",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-11",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "整套服装",
    en: "Outfit Sets",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-12",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "裤装",
    en: "Pants",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-13",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "服装上衣",
    en: "Clothing Tops",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-14",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "短裤",
    en: "Shorts",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-15",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "裙子",
    en: "Skirts",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-16",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "裙裤",
    en: "Skorts",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-20",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "泳装",
    en: "Swimwear",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-22",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "新娘/婚礼服饰",
    en: "Wedding & Bridal Party Dresses",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-23",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "传统服装与礼服",
    en: "Traditional & Ceremonial Clothing",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-24",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "制服和工作服",
    en: "Uniforms & Workwear",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-25",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "婴儿及儿童服饰",
    en: "Baby & Children's Clothing",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-4",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "连衣裙",
    en: "Dresses",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-6",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "女式内衣",
    en: "Lingerie",
  },
  {
    id: "gid://shopify/TaxonomyCategory/aa-1-7",
    parentId: "gid://shopify/TaxonomyCategory/aa-1",
    zh: "孕妇装",
    en: "Maternity Clothing",
  },
] as const;

const SHOPIFY_ALL_CATEGORY_OPTIONS = [
  ...SHOPIFY_CATEGORY_OPTIONS,
  ...SHOPIFY_APPAREL_ACCESSORY_OPTIONS,
  ...SHOPIFY_CLOTHING_OPTIONS,
] as const;

const SHOPIFY_CATEGORY_ZH_BY_EN = new Map(
  SHOPIFY_ALL_CATEGORY_OPTIONS.map((category) => [
    normalizeShopifyCategoryLabel(category.en),
    category.zh,
  ]),
);

const SHOPIFY_UNCATEGORIZED_CATEGORY_ID = "gid://shopify/TaxonomyCategory/na";
const SHOPIFY_APPAREL_ACCESSORIES_CATEGORY_ID =
  "gid://shopify/TaxonomyCategory/aa";
const SHOPIFY_CLOTHING_CATEGORY_ID = "gid://shopify/TaxonomyCategory/aa-1";

function formatUnixTime(value: number | null): string {
  if (!value) return "未记录";
  return new Date(value * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sanitizeAiOutput(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripMarkdownJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseAiOutputToForm(raw: string): Partial<ProductForm> {
  const cleaned = sanitizeAiOutput(raw);
  const json = parseAiJson(cleaned);
  if (json) return mapObjectToProductForm(json);
  return mapKeyValueTextToProductForm(cleaned);
}

function parseAiJson(value: string): Record<string, unknown> | null {
  const cleaned = stripMarkdownJsonFence(value);
  const candidates = [
    cleaned,
    cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1),
  ].filter((item) => item && item.includes("{") && item.includes("}"));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {}
  }
  return null;
}

function mapObjectToProductForm(source: Record<string, unknown>): Partial<ProductForm> {
  const readFromSources = (
    sources: Record<string, unknown>[],
    ...keys: string[]
  ) => {
    for (const candidate of sources) {
      for (const key of keys) {
        const value = candidate[key];
        if (Array.isArray(value)) return value.join(", ");
        if (value != null && String(value).trim()) return String(value).trim();
      }
    }
    return "";
  };
  const read = (...keys: string[]) => readFromSources([source], ...keys);
  const categoryMetafieldSources = [
    source,
    "类别元字段",
    "类别 元字段",
    "Category metafields",
    "Category Metafields",
    "categoryMetafields",
    "category_metafields",
  ]
    .map((keyOrSource) => {
      if (typeof keyOrSource !== "string") return keyOrSource;
      const value = source[keyOrSource];
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    })
    .filter((value): value is Record<string, unknown> => Boolean(value));
  const readCategoryMetafield = (...keys: string[]) =>
    readFromSources(categoryMetafieldSources, ...keys);
  const categoryName = read("Shopify 类别", "商品类别", "类别", "category", "Category");
  const category = findShopifyCategoryByName(categoryName);
  const productType = read(
    "产品类型",
    "商品类型",
    "礼服类型",
    "productType",
    "product_type",
  );
  const collections = mergeProductCollections(
    read(
      "产品系列",
      "商品系列",
      "系列",
      "产品集合",
      "Collection",
      "Collections",
      "Product collection",
      "Product collections",
      "collection",
      "collections",
    ),
    productType,
  );
  return {
    title: read("商品标题", "标题", "title", "Title"),
    description: read("商品描述", "描述", "description", "Description"),
    ...(category
      ? { shopifyCategoryId: category.id, shopifyCategoryName: category.zh }
      : {}),
    productType,
    vendor: read("供应商", "厂商", "vendor", "Vendor"),
    templateStyle: read(
      "模板样式",
      "产品样式",
      "产品模板",
      "templateStyle",
      "templateSuffix",
      "Template suffix",
      "Theme template",
    ),
    collections,
    tags: read("标记", "商品标记", "标签", "tags", "Tags", "tag", "Tag"),
    color: read("主色调", "颜色", "color", "Color"),
    material: read("面料材质", "材质", "material", "Material"),
    neckline: read("领口设计", "领口", "neckline", "Neckline"),
    silhouette: read("整体版型", "版型", "silhouette", "Silhouette"),
    sku: read("SKU", "sku"),
    compareAtPrice: read(
      "原价",
      "划线价",
      "吊牌价",
      "compareAtPrice",
      "compare_at_price",
      "Compare at price",
      "Original price",
    ),
    price: read("售价", "销售价", "价格", "price", "Price", "Sale price"),
    inventory: read("库存", "inventory", "Inventory"),
    categoryColor: readCategoryMetafield(
      "类别元字段颜色",
      "类别颜色",
      "颜色",
      "主色调",
      "Category color",
      "Color",
      "categoryColor",
      "category_color",
    ),
    categorySize: readCategoryMetafield(
      "类别元字段尺寸",
      "尺寸",
      "Size",
      "categorySize",
      "category_size",
    ),
    categoryFabric: readCategoryMetafield(
      "类别元字段织物",
      "织物",
      "面料材质",
      "材质",
      "Fabric",
      "Material",
      "categoryFabric",
      "category_fabric",
    ),
    categoryAgeGroup: readCategoryMetafield(
      "类别元字段年龄段",
      "年龄段",
      "Age group",
      "ageGroup",
      "categoryAgeGroup",
      "category_age_group",
    ),
    categoryOccasion: readCategoryMetafield(
      "类别元字段穿着场合",
      "穿着场合",
      "场合",
      "Occasion",
      "categoryOccasion",
      "category_occasion",
    ),
    categoryDressStyle: readCategoryMetafield(
      "类别元字段裙子风格",
      "裙子风格",
      "裙型",
      "Dress style",
      "categoryDressStyle",
      "category_dress_style",
    ),
    categoryNeckline: readCategoryMetafield(
      "类别元字段领口",
      "领口",
      "领口设计",
      "Neckline",
      "categoryNeckline",
      "category_neckline",
    ),
    categoryDressLengthType: readCategoryMetafield(
      "类别元字段裙子/连衣裙长度类型",
      "类别元字段裙长",
      "裙子/连衣裙长度类型",
      "裙长",
      "Dress length type",
      "categoryDressLengthType",
      "category_dress_length_type",
    ),
    categorySleeveLengthType: readCategoryMetafield(
      "类别元字段袖长类型",
      "袖长类型",
      "袖长",
      "Sleeve length type",
      "categorySleeveLengthType",
      "category_sleeve_length_type",
    ),
    categoryTargetGender: readCategoryMetafield(
      "类别元字段目标性别",
      "目标性别",
      "性别",
      "Target gender",
      "categoryTargetGender",
      "category_target_gender",
    ),
    seoTitle: read("SEO标题", "SEO 标题", "seoTitle", "seo_title"),
    seoDescription: read("SEO描述", "SEO 描述", "seoDescription", "seo_description"),
  };
}

function mapKeyValueTextToProductForm(value: string): Partial<ProductForm> {
  const aliases: Record<keyof ProductForm, string[]> = {
    title: ["商品标题", "标题", "Title"],
    description: ["商品描述", "描述", "Description"],
    shopifyCategoryId: ["Shopify 类别 ID", "Category ID"],
    shopifyCategoryName: ["Shopify 类别", "商品类别", "类别", "Category"],
    productType: ["产品类型", "商品类型", "礼服类型", "Product type"],
    vendor: ["供应商", "厂商", "Vendor"],
    templateStyle: [
      "模板样式",
      "产品样式",
      "产品模板",
      "Template suffix",
      "Theme template",
    ],
    collections: [
      "产品系列",
      "商品系列",
      "系列",
      "产品集合",
      "Collection",
      "Collections",
      "Product collection",
      "Product collections",
    ],
    tags: ["标记", "商品标记", "标签", "Tags", "tags", "Tag", "tag"],
    color: ["主色调", "颜色", "Color"],
    material: ["面料材质", "材质", "Material"],
    neckline: ["领口设计", "领口", "Neckline"],
    silhouette: ["整体版型", "版型", "Silhouette"],
    sku: ["SKU"],
    compareAtPrice: ["原价", "划线价", "吊牌价", "Compare at price", "Original price"],
    price: ["售价", "销售价", "价格", "Price", "Sale price"],
    inventory: ["库存", "Inventory"],
    status: ["状态", "Status"],
    categoryColor: ["类别元字段颜色", "类别颜色", "颜色", "Color"],
    categorySize: ["类别元字段尺寸", "尺寸", "Size"],
    categoryFabric: ["类别元字段织物", "织物", "面料材质", "材质", "Fabric", "Material"],
    categoryAgeGroup: ["类别元字段年龄段", "年龄段", "Age group"],
    categoryOccasion: ["类别元字段穿着场合", "穿着场合", "场合", "Occasion"],
    categoryDressStyle: ["类别元字段裙子风格", "裙子风格", "裙型", "Dress style"],
    categoryNeckline: ["类别元字段领口", "领口", "领口设计", "Neckline"],
    categoryDressLengthType: [
      "类别元字段裙子/连衣裙长度类型",
      "类别元字段裙长",
      "裙子/连衣裙长度类型",
      "裙长",
      "Dress length type",
    ],
    categorySleeveLengthType: [
      "类别元字段袖长类型",
      "袖长类型",
      "袖长",
      "Sleeve length type",
    ],
    categoryTargetGender: ["类别元字段目标性别", "目标性别", "性别", "Target gender"],
    seoTitle: ["SEO标题", "SEO 标题", "SEO Title"],
    seoDescription: ["SEO描述", "SEO 描述", "SEO Description"],
    variantOptionName: ["多属性名称", "选项名称", "Option name", "Variant option"],
  };
  const result: Partial<ProductForm> = {};
  for (const [field, labels] of Object.entries(aliases) as Array<
    [keyof ProductForm, string[]]
  >) {
    if (field === "status") continue;
    const extracted = extractByLabels(value, labels);
    if (extracted) result[field] = extracted as never;
  }
  const category = findShopifyCategoryByName(result.shopifyCategoryName || "");
  if (category) {
    result.shopifyCategoryId = category.id;
    result.shopifyCategoryName = category.zh;
  }
  if (result.productType) {
    result.collections = mergeProductCollections(
      result.collections,
      result.productType,
    );
  }
  if (!result.description && value) result.description = value;
  return result;
}

function findShopifyCategoryByName(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return (
    SHOPIFY_ALL_CATEGORY_OPTIONS.find(
      (item) =>
        item.id === value ||
        item.zh === value ||
        item.en.toLowerCase() === normalized ||
        item.zh.includes(value) ||
        item.en.toLowerCase().includes(normalized),
    ) || null
  );
}

function findShopifyCategoryById(id: string) {
  return SHOPIFY_ALL_CATEGORY_OPTIONS.find((item) => item.id === id) || null;
}

function normalizeShopifyCategoryLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function translateShopifyCategoryLabel(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return "";
  return SHOPIFY_CATEGORY_ZH_BY_EN.get(normalizeShopifyCategoryLabel(cleaned)) || cleaned;
}

function getShopifyCategoryOptionLabel(
  category: Pick<ShopifyTaxonomyCategoryOption, "id" | "name" | "fullName">,
) {
  const local = findShopifyCategoryById(category.id);
  return local?.zh || translateShopifyCategoryLabel(category.name);
}

function getShopifyCategoryOptionFullLabel(
  category: Pick<ShopifyTaxonomyCategoryOption, "id" | "name" | "fullName">,
) {
  const fullName = category.fullName || category.name;
  const parts = fullName
    .split(/\s*>\s*/)
    .map(translateShopifyCategoryLabel)
    .filter(Boolean);
  return parts.length ? parts.join(" > ") : getShopifyCategoryOptionLabel(category);
}

function getShopifyRootCategoryId(id: string): string {
  const clothingCategory = SHOPIFY_CLOTHING_OPTIONS.find(
    (item) => item.id === id,
  );
  if (clothingCategory) return SHOPIFY_APPAREL_ACCESSORIES_CATEGORY_ID;
  const subcategory = SHOPIFY_APPAREL_ACCESSORY_OPTIONS.find(
    (item) => item.id === id,
  );
  return subcategory?.parentId || id;
}

function getShopifyApparelSubcategoryId(id: string): string {
  const clothingCategory = SHOPIFY_CLOTHING_OPTIONS.find(
    (item) => item.id === id,
  );
  if (clothingCategory) return clothingCategory.parentId;
  const apparelCategory = SHOPIFY_APPAREL_ACCESSORY_OPTIONS.find(
    (item) => item.id === id,
  );
  return apparelCategory?.id || "";
}

function isShopifyApparelCategory(id: string): boolean {
  return getShopifyRootCategoryId(id) === SHOPIFY_APPAREL_ACCESSORIES_CATEGORY_ID;
}

function isShopifyClothingCategory(id: string): boolean {
  return getShopifyApparelSubcategoryId(id) === SHOPIFY_CLOTHING_CATEGORY_ID;
}

function isShopifyTaxonomyCategoryId(value: string): boolean {
  return /^gid:\/\/shopify\/TaxonomyCategory\/[a-z0-9-]+$/i.test(value);
}

function getShopifyCategoryMetafieldContext(id: string): string {
  const category = findShopifyCategoryById(id);
  if (!category) return "未分类";
  const clothingCategory = SHOPIFY_CLOTHING_OPTIONS.find((item) => item.id === id);
  if (clothingCategory) return `服装 中的 ${clothingCategory.zh}`;
  const apparelCategory = SHOPIFY_APPAREL_ACCESSORY_OPTIONS.find(
    (item) => item.id === id,
  );
  if (apparelCategory) return `服饰与配饰 中的 ${apparelCategory.zh}`;
  return category.zh;
}

function inferShopifyCategoryFromText(value: string) {
  const text = value.toLowerCase();
  const includesAny = (words: string[]) => words.some((word) => text.includes(word));

  if (
    includesAny(["bridal", "bridesmaid", "wedding", "婚纱", "伴娘", "婚礼"])
  ) {
    return findShopifyCategoryById("gid://shopify/TaxonomyCategory/aa-1-22");
  }
  if (includesAny(["dress", "gown", "prom", "礼服", "连衣裙", "晚礼服"])) {
    return findShopifyCategoryById("gid://shopify/TaxonomyCategory/aa-1-4");
  }
  if (includesAny(["shorts", "短裤"])) {
    return findShopifyCategoryById("gid://shopify/TaxonomyCategory/aa-1-14");
  }
  if (includesAny(["skirt", "半身裙", "裙子"])) {
    return findShopifyCategoryById("gid://shopify/TaxonomyCategory/aa-1-15");
  }
  if (includesAny(["top", "shirt", "blouse", "上衣", "衬衫"])) {
    return findShopifyCategoryById("gid://shopify/TaxonomyCategory/aa-1-13");
  }
  if (includesAny(["bag", "luggage", "handbag", "箱包", "包"])) {
    return findShopifyCategoryById("gid://shopify/TaxonomyCategory/aa-5");
  }
  if (includesAny(["jewelry", "necklace", "ring", "earring", "首饰", "珠宝", "戒指"])) {
    return findShopifyCategoryById("gid://shopify/TaxonomyCategory/aa-6");
  }
  if (includesAny(["beauty", "cosmetic", "护肤", "美容", "化妆"])) {
    return findShopifyCategoryById("gid://shopify/TaxonomyCategory/hb");
  }
  if (includesAny(["home", "garden", "家居", "园艺"])) {
    return findShopifyCategoryById("gid://shopify/TaxonomyCategory/hg");
  }
  if (includesAny(["toy", "game", "玩具", "游戏"])) {
    return findShopifyCategoryById("gid://shopify/TaxonomyCategory/tg");
  }
  if (includesAny(["phone", "camera", "electronics", "电子", "相机", "手机"])) {
    return findShopifyCategoryById("gid://shopify/TaxonomyCategory/el");
  }
  return null;
}

function inferShopifyCategoryFromForm(form: ProductForm) {
  return inferShopifyCategoryFromText(
    [
      form.title,
      form.description,
      form.productType,
      form.tags,
      form.color,
      form.material,
      form.neckline,
      form.silhouette,
      form.categoryColor,
      form.categorySize,
      form.categoryFabric,
      form.categoryAgeGroup,
      form.categoryOccasion,
      form.categoryDressStyle,
      form.categoryNeckline,
      form.categoryDressLengthType,
      form.categorySleeveLengthType,
      form.categoryTargetGender,
    ].join(" "),
  );
}

function extractByLabels(text: string, labels: string[]): string {
  const labelPattern = labels.map(escapeRegExp).join("|");
  const match = text.match(
    new RegExp(
      `(?:^|\\n)\\s*(?:[-•*]\\s*)?(?:${labelPattern})\\s*[：:]\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-•*]\\s*)?[\\u4e00-\\u9fa5A-Za-z ]{2,24}\\s*[：:]|$)`,
      "i",
    ),
  );
  return sanitizeAiOutput(match?.[1] || "").replace(/\n/g, "、");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCategoryMetafieldMemoryValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeCategoryMetafieldMemoryItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = normalizeCategoryMetafieldMemoryValue(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);
    if (items.length >= CATEGORY_METAFIELD_MEMORY_LIMIT) break;
  }

  return items;
}

function loadCategoryMetafieldMemory(): CategoryMetafieldMemory {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(CATEGORY_METAFIELD_MEMORY_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const source = parsed as Partial<Record<CategoryMetafieldFormKey, unknown>>;
    const memory: CategoryMetafieldMemory = {};
    for (const { key } of CATEGORY_METAFIELD_ROWS) {
      const items = sanitizeCategoryMetafieldMemoryItems(source[key]);
      if (items.length) {
        memory[key] = items;
      }
    }

    return memory;
  } catch {
    return {};
  }
}

function saveCategoryMetafieldMemory(memory: CategoryMetafieldMemory) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      CATEGORY_METAFIELD_MEMORY_STORAGE_KEY,
      JSON.stringify(memory),
    );
  } catch {
    // Ignore storage write failures so the product form remains usable.
  }
}

function buildCategoryMetafieldCandidates(): CategoryMetafieldMemory {
  const memory = loadCategoryMetafieldMemory();
  const candidates: CategoryMetafieldMemory = {};
  for (const { key } of CATEGORY_METAFIELD_ROWS) {
    const items = sanitizeCategoryMetafieldMemoryItems(memory[key]);
    if (items.length) candidates[key] = items;
  }
  return candidates;
}

function addCategoryMetafieldMemoryValue(
  memory: CategoryMetafieldMemory,
  key: CategoryMetafieldFormKey,
  value: string,
): CategoryMetafieldMemory {
  const normalized = normalizeCategoryMetafieldMemoryValue(value);
  if (!normalized) return memory;

  const current = memory[key] || [];
  const nextItems = [
    normalized,
    ...current.filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
  ].slice(0, CATEGORY_METAFIELD_MEMORY_LIMIT);

  if (
    current.length === nextItems.length &&
    current.every((item, index) => item === nextItems[index])
  ) {
    return memory;
  }

  return { ...memory, [key]: nextItems };
}

function removeCategoryMetafieldMemoryValue(
  memory: CategoryMetafieldMemory,
  key: CategoryMetafieldFormKey,
  value: string,
): CategoryMetafieldMemory {
  const normalized = normalizeCategoryMetafieldMemoryValue(value);
  if (!normalized) return memory;

  const current = memory[key] || [];
  const nextItems = current.filter(
    (item) => item.toLowerCase() !== normalized.toLowerCase(),
  );
  if (nextItems.length === current.length) return memory;

  const next: CategoryMetafieldMemory = { ...memory };
  if (nextItems.length) {
    next[key] = nextItems;
  } else {
    delete next[key];
  }

  return next;
}

function splitProductTags(value: string): string[] {
  return value
    .split(/[,，、;；\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function appendProductTag(value: string, tag: string): string {
  const tags = splitProductTags(value);
  if (tags.some((item) => item.toLowerCase() === tag.toLowerCase())) {
    return tags.join(", ");
  }
  return [...tags, tag].join(", ");
}

function removeProductTag(value: string, tag: string): string {
  return splitProductTags(value)
    .filter((item) => item.toLowerCase() !== tag.toLowerCase())
    .join(", ");
}

function mergeProductCollections(
  ...values: Array<string | undefined>
): string {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const item of splitProductTags(value || "")) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged.join(", ");
}

function loadPromptPresets(): ProductListingPromptPreset[] {
  if (typeof window === "undefined") return DEFAULT_PRODUCT_LISTING_PROMPT_PRESETS;
  try {
    const raw = window.localStorage.getItem(
      PRODUCT_LISTING_PROMPT_PRESETS_STORAGE_KEY,
    );
    if (!raw) return DEFAULT_PRODUCT_LISTING_PROMPT_PRESETS;
    const parsed = JSON.parse(raw) as
      | ProductListingPromptPreset[]
      | { presets?: ProductListingPromptPreset[] };
    const stored = Array.isArray(parsed) ? parsed : parsed.presets;
    const presets = Array.isArray(stored) ? normalizePromptPresets(stored) : [];
    if (!presets.length) return DEFAULT_PRODUCT_LISTING_PROMPT_PRESETS;

    if (!Array.isArray(parsed) && Array.isArray(parsed.presets)) {
      return refreshDefaultPromptPresets(presets);
    }

    const storedById = new Map(presets.map((preset) => [preset.id, preset]));
    const defaultIds = new Set(
      DEFAULT_PRODUCT_LISTING_PROMPT_PRESETS.map((preset) => preset.id),
    );
    const defaults = DEFAULT_PRODUCT_LISTING_PROMPT_PRESETS.map((preset) => ({
      ...preset,
      name: storedById.get(preset.id)?.name || preset.name,
      createdAt: storedById.get(preset.id)?.createdAt ?? preset.createdAt,
    }));
    const custom = presets.filter((preset) => !defaultIds.has(preset.id));
    return [...defaults, ...custom];
  } catch {
    return DEFAULT_PRODUCT_LISTING_PROMPT_PRESETS;
  }
}

function refreshDefaultPromptPresets(
  presets: ProductListingPromptPreset[],
): ProductListingPromptPreset[] {
  const defaultById = new Map(
    DEFAULT_PRODUCT_LISTING_PROMPT_PRESETS.map((preset) => [preset.id, preset]),
  );
  return presets.map((preset) => {
    const defaultPreset = defaultById.get(preset.id);
    if (!defaultPreset) return preset;
    return {
      ...preset,
      prompt: defaultPreset.prompt,
    };
  });
}

function normalizePromptPresets(
  presets: ProductListingPromptPreset[],
): ProductListingPromptPreset[] {
  return presets
    .filter((preset) => preset.id?.trim() && preset.prompt?.trim())
    .map((preset) => ({
      id: preset.id.trim(),
      name: preset.name?.trim() || buildPromptPresetName(preset.prompt, 1),
      prompt: preset.prompt.trim(),
      createdAt: Number(preset.createdAt) || 0,
    }));
}

function buildPromptPresetName(prompt: string, index: number): string {
  const firstLine = prompt
    .split(/\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const cleaned = (firstLine || "")
    .replace(/[：:，,。.；;、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 18) : `上架提示词 ${index}`;
}

function sortMediaByRole(
  mediaItems: ProductListingMediaItem[],
): ProductListingMediaItem[] {
  const priority: Record<ProductMediaRole, number> = {
    main: 0,
    back: 1,
    detail: 2,
  };
  return mediaItems
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const byRole = priority[a.item.role] - priority[b.item.role];
      return byRole || a.index - b.index;
    })
    .map(({ item }) => item);
}

function parseVariantSizes(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,，;；\t]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function variantSku(baseSku: string, size: string, index: number): string {
  const base = baseSku.trim() || "SKU";
  const suffix =
    size
      .normalize("NFKC")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toUpperCase() || String(index + 1).padStart(2, "0");
  return `${base}-${suffix}`;
}

function buildDefaultVariantRows(form: ProductForm = EMPTY_FORM): ProductVariantRow[] {
  return DEFAULT_SIZE_VARIANT_OPTIONS.map((size, index) => ({
    id: `default-size-${index}`,
    size,
    sku: variantSku(form.sku, size, index),
    price: form.price || "0.00",
    inventory: form.inventory || "",
    selected: true,
    isMainImage: true,
    imageUrl: "",
    imageAlt: size,
  }));
}

function buildClearedDefaultVariantRows(): ProductVariantRow[] {
  return DEFAULT_SIZE_VARIANT_OPTIONS.map((size, index) => ({
    id: `default-size-${index}`,
    size,
    sku: "",
    price: "",
    inventory: "",
    selected: true,
    isMainImage: true,
    imageUrl: "",
    imageAlt: size,
  }));
}

function normalizePriceForCompare(value?: string): string {
  const cleaned = String(value || "").replace(/[^\d.]/g, "");
  if (!cleaned) return "";
  const numberValue = Number(cleaned);
  if (!Number.isFinite(numberValue) || numberValue < 0) return "";
  return numberValue.toFixed(2);
}

function isDefaultVariantPrice(value: string, previousProductPrice = ""): boolean {
  const normalized = normalizePriceForCompare(value);
  if (!normalized || normalized === "0.00") return true;
  const previous = normalizePriceForCompare(previousProductPrice);
  return Boolean(previous && normalized === previous);
}

function variantPriceForSync(variantPrice: string, productPrice: string): string {
  return isDefaultVariantPrice(variantPrice, productPrice)
    ? productPrice
    : variantPrice;
}

export default function ProductListingPage() {
  const searchParams = useSearchParams();
  const [binding, setBinding] = useState<ShopifyBinding | null>(null);
  const [shopifyAccounts, setShopifyAccounts] = useState<ShopifyBinding[]>([]);
  const [shopifyAccountDialogOpen, setShopifyAccountDialogOpen] = useState(false);
  const [addingShopifyAccount, setAddingShopifyAccount] = useState(false);
  const [authMode, setAuthMode] =
    useState<ShopifyBinding["authMode"]>("oauth_app");
  const [shopDomain, setShopDomain] = useState("xxx.myshopify.com");
  const [accessToken, setAccessToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [loadingBinding, setLoadingBinding] = useState(true);
  const [testing, setTesting] = useState(false);
  const [savingBinding, setSavingBinding] = useState(false);
  const [switchingShopifyAccount, setSwitchingShopifyAccount] = useState(false);
  const [unbinding, setUnbinding] = useState(false);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const [aiPromptText, setAiPromptText] = useState("");
  const [selectedPromptPresetId, setSelectedPromptPresetId] = useState("");
  const [promptPresetName, setPromptPresetName] = useState("");
  const [promptPresets, setPromptPresets] =
    useState<ProductListingPromptPreset[]>(loadPromptPresets);
  const [generatingAiOutput, setGeneratingAiOutput] = useState(false);
  const [aiRawText, setAiRawText] = useState("");
  const [cleanedAiText, setCleanedAiText] = useState("");
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [variantRows, setVariantRows] = useState<ProductVariantRow[]>(
    buildDefaultVariantRows,
  );
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncAction, setSyncAction] = useState<SyncAction>(null);
  const [lastAction, setLastAction] = useState("等待填写或应用 AI 解析结果");
  const [shopifyProductUrl, setShopifyProductUrl] = useState<string | null>(null);
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaItems, setMediaItems] = useState<ProductListingMediaItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(PRODUCT_LISTING_MEDIA_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as ProductListingMediaItem[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [previewMedia, setPreviewMedia] =
    useState<ProductListingMediaItem | null>(null);

  useEffect(() => {
    window.localStorage.setItem(
      PRODUCT_LISTING_MEDIA_STORAGE_KEY,
      JSON.stringify(mediaItems),
    );
  }, [mediaItems]);

  useEffect(() => {
    window.localStorage.setItem(
      PRODUCT_LISTING_PROMPT_PRESETS_STORAGE_KEY,
      JSON.stringify({ version: 2, presets: promptPresets }),
    );
  }, [promptPresets]);

  useEffect(() => {
    const notice = window.sessionStorage.getItem(PRODUCT_LISTING_NOTICE_STORAGE_KEY);
    if (notice) {
      setConnectionMessage(notice);
      window.sessionStorage.removeItem(PRODUCT_LISTING_NOTICE_STORAGE_KEY);
    } else if (searchParams?.get("shopify") === "missing") {
      setConnectionMessage("请输入 Shopify 密钥");
    } else if (searchParams?.get("shopify_oauth") === "success") {
      setConnectionMessage("Shopify OAuth 授权成功，已保存绑定。");
    } else if (searchParams?.get("shopify_oauth") === "error") {
      setConnectionMessage(
        searchParams?.get("message") || "Shopify OAuth 授权失败，请重新授权。",
      );
    }
    if (searchParams?.get("media") === "added") {
      setLastAction("已从历史记录加入媒体 Media，确认商品信息后可同步到 Shopify");
    }
  }, [searchParams]);

  useEffect(() => {
    let alive = true;
    async function loadBinding() {
      setLoadingBinding(true);
      try {
        const res = await fetchWithShopifyDevice("/api/shopify/connection");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        if (!alive) return;
        const accounts = Array.isArray(data.connections)
          ? (data.connections as ShopifyBinding[])
          : data.bound
            ? ([data] as ShopifyBinding[])
            : [];
        setShopifyAccounts(accounts);
        const active = (data.connection || (data.bound ? data : null)) as
          | ShopifyBinding
          | null;
        if (active?.shopDomain) {
          setBinding(active);
          setShopDomain(active.shopDomain);
          setAuthMode(active.authMode || "access_token");
          setAddingShopifyAccount(false);
          setConnectionMessage("已读取 Shopify 绑定信息。");
        } else {
          setBinding(null);
        }
      } catch (e) {
        if (alive) {
          setConnectionMessage(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (alive) setLoadingBinding(false);
      }
    }
    loadBinding();
    return () => {
      alive = false;
    };
  }, []);

  const tokenPreview = useMemo(() => {
    if (binding && !addingShopifyAccount) return binding.tokenPreview;
    const secret = authMode === "access_token" ? accessToken : clientSecret;
    if (!secret.trim()) return "未填写";
    return `••••••••••••${secret.trim().slice(-4)}`;
  }, [accessToken, addingShopifyAccount, authMode, binding, clientSecret]);

  const hasActiveShopifyBinding = Boolean(binding) && !addingShopifyAccount;

  async function testConnection() {
    if ((!binding || addingShopifyAccount) && authMode === "oauth_app") {
      setConnectionMessage("新版 Dev Dashboard 应用需要先点击“开始 Shopify 授权”，授权成功后再测试连接。");
      return;
    }
    setTesting(true);
    setConnectionMessage(null);
    try {
      const res = await fetchWithShopifyDevice("/api/shopify/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          binding &&
            !addingShopifyAccount &&
            !accessToken.trim() &&
            !clientId.trim() &&
            !clientSecret.trim()
            ? { useStored: true }
            : { authMode, shopDomain, accessToken, clientId, clientSecret },
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setConnectionMessage(
        data.result?.shopName
          ? `连接成功：${data.result.shopName}`
          : "连接成功，已验证 Shopify Admin API。",
      );
    } catch (e) {
      setConnectionMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  async function saveBinding() {
    if (
      !shopDomain.trim() ||
      (authMode !== "access_token"
        ? !clientId.trim() || !clientSecret.trim()
        : !accessToken.trim())
    ) {
      setConnectionMessage(
        authMode !== "access_token"
          ? "请填写店铺域名、客户端 ID 和客户端密钥。"
          : "请填写店铺域名和 Admin API Access Token。",
      );
      return;
    }
    setSavingBinding(true);
    setConnectionMessage(null);
    try {
      if (authMode === "oauth_app" || authMode === "client_credentials") {
        const res = await fetchWithShopifyDevice("/api/shopify/oauth/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shopDomain,
            clientId,
            clientSecret,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        setConnectionMessage("正在跳转到 Shopify 授权页面...");
        window.location.href = data.authorizeUrl;
        return;
      }

      const res = await fetchWithShopifyDevice("/api/shopify/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authMode,
          shopDomain,
          accessToken,
          clientId,
          clientSecret,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setBinding(data.connection as ShopifyBinding);
      setShopifyAccounts(
        Array.isArray(data.connections)
          ? (data.connections as ShopifyBinding[])
          : data.connection
            ? [data.connection as ShopifyBinding]
            : [],
      );
      setShopDomain(data.connection.shopDomain);
      setAuthMode(data.connection.authMode || authMode);
      setAddingShopifyAccount(false);
      setAccessToken("");
      setClientId("");
      setClientSecret("");
      setConnectionMessage("Shopify 连接验证通过，绑定信息已加密保存。");
    } catch (e) {
      setConnectionMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingBinding(false);
    }
  }

  function fillTestCredentials() {
    setShopDomain(TEST_SHOP_DOMAIN);
    setAuthMode("access_token");
    setAccessToken(TEST_ACCESS_TOKEN);
    setClientId("");
    setClientSecret("");
    setConnectionMessage(
      "已填入测试密钥。点击测试连接或保存会走模拟分支，不调用 Shopify 官方接口。",
    );
  }

  function beginAddShopifyAccount() {
    setShopifyAccountDialogOpen(false);
    setAddingShopifyAccount(true);
    setAuthMode("oauth_app");
    setShopDomain("xxx.myshopify.com");
    setAccessToken("");
    setClientId("");
    setClientSecret("");
    setConnectionMessage("请填写新 Shopify 店铺信息后授权。");
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function selectShopifyAccount(shopDomain: string) {
    if (!shopDomain || shopDomain === binding?.shopDomain) {
      setShopifyAccountDialogOpen(false);
      return;
    }
    setSwitchingShopifyAccount(true);
    try {
      const res = await fetchWithShopifyDevice("/api/shopify/connection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopDomain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      const active = data.connection as ShopifyBinding;
      setBinding(active);
      setShopifyAccounts(
        Array.isArray(data.connections)
          ? (data.connections as ShopifyBinding[])
          : active
            ? [active]
            : [],
      );
      if (active) {
        setShopDomain(active.shopDomain);
        setAuthMode(active.authMode || "access_token");
        setConnectionMessage(`已切换到 Shopify 店铺：${active.shopDomain}`);
      }
      setAddingShopifyAccount(false);
      setShopifyAccountDialogOpen(false);
      setSyncState("idle");
      setShopifyProductUrl(null);
      setSyncWarnings([]);
    } catch (e: unknown) {
      setConnectionMessage(String(e));
    } finally {
      setSwitchingShopifyAccount(false);
    }
  }

  function switchShopifyAccount() {
    setShopifyAccountDialogOpen(true);
  }

  async function unbindShopify() {
    setUnbinding(true);
    try {
      const res = await fetchWithShopifyDevice("/api/shopify/connection", {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      const active = data.connection as ShopifyBinding | null;
      setShopifyAccounts(
        Array.isArray(data.connections) ? (data.connections as ShopifyBinding[]) : [],
      );
      if (active) {
        setBinding(active);
        setShopDomain(active.shopDomain);
        setAuthMode(active.authMode || "access_token");
        setAccessToken("");
        setClientId("");
        setClientSecret("");
        setConnectionMessage(`已解除当前店铺绑定，已切换到：${active.shopDomain}`);
        setConfirmUnbind(false);
        setSyncState("idle");
        setLastAction("Shopify 已切换到下一个已绑定店铺");
        return;
      }
      setBinding(null);
      setAccessToken("");
      setClientId("");
      setClientSecret("");
      setConnectionMessage("已解除 Shopify 绑定。");
      setConfirmUnbind(false);
      setSyncState("idle");
      setLastAction("Shopify 已解除绑定");
    } catch (e) {
      setConnectionMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setUnbinding(false);
    }
  }

  function updateAiPromptText(value: string) {
    setAiPromptText(value);
  }

  function resetProductListingContent() {
    setAiPromptText("");
    setSelectedPromptPresetId("");
    setPromptPresetName("");
    setGeneratingAiOutput(false);
    setAiRawText("");
    setCleanedAiText("");
    setForm(EMPTY_FORM);
    setVariantRows(buildClearedDefaultVariantRows());
    setSyncState("idle");
    setLastAction("已清空产品上架内容，保留固定 Size 多属性");
    setShopifyProductUrl(null);
    setSyncWarnings([]);
    setUploadingMedia(false);
    setMediaItems([]);
    setPreviewMedia(null);
  }

  function selectPromptPreset(id: string) {
    setSelectedPromptPresetId(id);
    const preset = promptPresets.find((item) => item.id === id);
    if (!preset) {
      setPromptPresetName("");
      return;
    }
    setAiPromptText(preset.prompt);
    setPromptPresetName(preset.name);
    setLastAction(`已载入预设提示词：${preset.name}`);
  }

  function savePromptPreset() {
    const prompt = sanitizeAiOutput(aiPromptText);
    if (!prompt) {
      setLastAction("请输入大模型提示词后再保存为预设");
      return;
    }
    const name =
      promptPresetName.trim() ||
      buildPromptPresetName(prompt, promptPresets.length + 1);
    const preset: ProductListingPromptPreset = {
      id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      prompt,
      createdAt: Date.now(),
    };
    setPromptPresets((prev) => [preset, ...prev]);
    setSelectedPromptPresetId(preset.id);
    setPromptPresetName(preset.name);
    setAiPromptText(prompt);
    setLastAction(`已加入预设提示词：${preset.name}`);
  }

  function renamePromptPreset() {
    const name = promptPresetName.trim();
    if (!selectedPromptPresetId) {
      setLastAction("请选择需要重命名的预设提示词");
      return;
    }
    if (!name) {
      setLastAction("请输入新的预设名称");
      return;
    }
    const target = promptPresets.find(
      (preset) => preset.id === selectedPromptPresetId,
    );
    if (!target) {
      setLastAction("未找到该预设提示词");
      return;
    }
    setPromptPresets((prev) =>
      prev.map((preset) => {
        if (preset.id !== selectedPromptPresetId) return preset;
        return {
          ...preset,
          name,
          createdAt: preset.createdAt > 0 ? preset.createdAt : Date.now(),
        };
      }),
    );
    setLastAction(`预设提示词已重命名：${name}`);
  }

  function deletePromptPreset(id: string) {
    const target = promptPresets.find((preset) => preset.id === id);
    if (!target) {
      setLastAction("未找到该预设提示词");
      return;
    }
    setPromptPresets((prev) => prev.filter((preset) => preset.id !== id));
    if (selectedPromptPresetId === id) {
      setSelectedPromptPresetId("");
      setPromptPresetName("");
    }
    setLastAction(`已删除预设提示词：${target.name}`);
  }

  async function generateAiOutput() {
    const prompt = sanitizeAiOutput(aiPromptText);
    if (!prompt) {
      setLastAction("请输入大模型提示词");
      return;
    }

    setGeneratingAiOutput(true);
    setLastAction("正在根据提示词解析商品信息");
    try {
      const categoryMetafieldCandidates = buildCategoryMetafieldCandidates();
      const res = await fetch("/api/product-listing/ai-output", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          media: mediaItems.map((item) => ({
            url: item.url,
            alt: item.alt,
            role: item.role,
          })),
          categoryMetafieldCandidates,
        }),
      });
      const data = (await res.json()) as {
        text?: string;
        cleanedText?: string;
        model?: string;
        imageCount?: number;
        warnings?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || res.statusText);
      const cleaned = sanitizeAiOutput(data.cleanedText || data.text || "");
      setAiPromptText(prompt);
      setAiRawText(cleaned);
      setCleanedAiText(cleaned);
      setSyncState("idle");
      const warningText = data.warnings?.length
        ? `，${data.warnings.length} 条媒体提示`
        : "";
      const imageText =
        typeof data.imageCount === "number" ? `，已传入 ${data.imageCount} 张图` : "";
      setLastAction(
        `大模型解析完成${data.model ? `：${data.model}` : ""}${imageText}${warningText}`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const errorText = `解析失败：${message}`;
      setAiRawText(errorText);
      setCleanedAiText(errorText);
      setLastAction(message);
    } finally {
      setGeneratingAiOutput(false);
    }
  }

  function applyAiToForm() {
    const cleaned = sanitizeAiOutput(aiRawText);
    const parsed = parseAiOutputToForm(cleaned);
    const previousPrice = form.price;
    setForm((prev) => {
      const next = {
        ...prev,
        ...parsed,
        status: prev.status,
      };
      if (
        !parsed.shopifyCategoryId &&
        (!prev.shopifyCategoryId ||
          prev.shopifyCategoryId === SHOPIFY_UNCATEGORIZED_CATEGORY_ID)
      ) {
        const category = inferShopifyCategoryFromForm(next);
        if (category) {
          next.shopifyCategoryId = category.id;
          next.shopifyCategoryName = category.zh;
        }
      }
      return next;
    });
    if (parsed.price) {
      setVariantRows((rows) =>
        rows.map((row) =>
          isDefaultVariantPrice(row.price, previousPrice)
            ? { ...row, price: parsed.price || "" }
            : row,
        ),
      );
    }
    setAiRawText(cleaned);
    setCleanedAiText(cleaned);
    setSyncState("idle");
    setLastAction("大模型输出已清理并填入 Shopify 商品表单");
  }

  async function syncToShopify(
    statusOverride?: ProductStatus,
    action: Exclude<SyncAction, null> =
      statusOverride === "ACTIVE" ? "publish" : "draft",
  ) {
    const productStatus = statusOverride || form.status;
    setSyncState("syncing");
    setSyncAction(action);
    setShopifyProductUrl(null);
    setSyncWarnings([]);
    setForm((prev) => ({ ...prev, status: productStatus }));
    setLastAction(
      `正在同步到 Shopify 商品后台：${getProductStatusOption(productStatus).label}`,
    );
    try {
      const res = await fetchWithShopifyDevice("/api/shopify/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: {
            ...form,
            status: productStatus,
            categoryId: form.shopifyCategoryId,
            categoryName: form.shopifyCategoryName,
            media: mediaItems.map((item) => ({
              url: item.url,
              alt: item.alt,
              role: item.role,
            })),
            variants: variantRows.map((row, index) => ({
              size: row.size,
              sku: row.sku || variantSku(form.sku, row.size, index),
              price: variantPriceForSync(row.price, form.price),
              inventory: row.inventory,
              imageUrl:
                mediaItems.find((item) => item.role === "main")?.url ||
                mediaItems[0]?.url ||
                row.imageUrl,
              isMainImage: row.isMainImage,
            })),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      const result = data.result as ShopifySyncResult;
      setSyncState(productStatus === "DRAFT" ? "draft" : "synced");
      setShopifyProductUrl(result.adminUrl);
      setSyncWarnings(result.warnings?.length ? result.warnings : ["同步成功"]);
      setLastAction(
        result.adminUrl
          ? `已同步到 Shopify（${getProductStatusOption(productStatus).label}）：${result.title}`
          : `已同步到 Shopify（${getProductStatusOption(productStatus).label}）：${result.title}`,
      );
    } catch (e) {
      setSyncState("idle");
      setLastAction(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncAction(null);
    }
  }

  function removeMedia(id: string) {
    setMediaItems((prev) => prev.filter((item) => item.id !== id));
  }

  function moveMedia(id: string, direction: -1 | 1) {
    setMediaItems((prev) => {
      const idx = prev.findIndex((item) => item.id === id);
      if (idx < 0) return prev;
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
      return next;
    });
  }

  function updateMediaRole(id: string, role: ProductMediaRole) {
    setMediaItems((prev) => {
      const next = prev.map((item): ProductListingMediaItem => {
        if (item.id === id) return { ...item, role };
        if (role === "main" && item.role === "main") {
          return { ...item, role: "detail" };
        }
        if (role === "back" && item.role === "back") {
          return { ...item, role: "detail" };
        }
        return item;
      });
      return sortMediaByRole(next);
    });
  }

  async function uploadLocalMedia(files: FileList | null) {
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) {
      setLastAction("请选择图片文件");
      return;
    }

    setUploadingMedia(true);
    try {
      const fd = new FormData();
      for (const file of imageFiles) fd.append("files", file, file.name);
      const res = await fetch("/api/product-listing/media", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        items?: Array<{ url: string; alt: string }>;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || res.statusText);
      const incoming = data.items || [];
      const { media, addedCount } = appendProductListingMedia(
        mediaItems,
        incoming.map((item, index) => {
          const finalIndex = mediaItems.length + index;
          return {
            url: item.url,
            alt: item.alt,
            role:
              finalIndex === 0 ? "main" : finalIndex === 2 ? "back" : "detail",
          };
        }),
      );
      setMediaItems(media);
      setLastAction(
        addedCount > 0
          ? `已上传 ${addedCount} 张图片到媒体 Media`
          : "上传的图片已经在媒体 Media 中",
      );
    } catch (e) {
      setLastAction(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingMedia(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-5 md:px-8 py-6 md:py-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-10 h-10 rounded-md flex items-center justify-center text-white shrink-0"
            style={{
              background: "var(--brand-gradient)",
              boxShadow: "0 0 16px var(--brand-glow)",
            }}
          >
            <ShoppingBag size={18} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-bold text-fg-primary tracking-tight">
                产品上架
              </h1>
              <PageRefreshButton
                title="清空当前产品上架内容"
                ariaLabel="清空当前产品上架内容"
                onClick={resetProductListingContent}
              />
            </div>
            <p className="mt-0.5 text-[13px] text-fg-tertiary">
              AI 解析商品信息 → 填入 Shopify 商品字段 → 确认后同步草稿
            </p>
          </div>
        </div>
        <Chip tone={hasActiveShopifyBinding ? "success" : "warn"}>
          {hasActiveShopifyBinding ? "Shopify 已绑定" : "待绑定"}
        </Chip>
      </header>

      {loadingBinding ? (
        <Card padding="lg">
          <div className="text-sm text-fg-tertiary">正在读取 Shopify 绑定状态...</div>
        </Card>
      ) : !hasActiveShopifyBinding ? (
        <UnboundView
          authMode={authMode}
          shopDomain={shopDomain}
          accessToken={accessToken}
          clientId={clientId}
          clientSecret={clientSecret}
          tokenPreview={tokenPreview}
          connectionMessage={connectionMessage}
          testing={testing}
          savingBinding={savingBinding}
          onAuthModeChange={setAuthMode}
          onShopDomainChange={setShopDomain}
          onAccessTokenChange={setAccessToken}
          onClientIdChange={setClientId}
          onClientSecretChange={setClientSecret}
          onFillTestCredentials={fillTestCredentials}
          onTestConnection={testConnection}
          onSaveBinding={saveBinding}
        />
      ) : (
        <div className="space-y-4">
          <BoundStatusCard
            binding={binding as ShopifyBinding}
            connectionMessage={connectionMessage}
            testing={testing}
            unbinding={unbinding}
            onTestConnection={testConnection}
            onConfirmUnbind={() => setConfirmUnbind(true)}
            onSwitchAccount={switchShopifyAccount}
          />

          <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)_290px] gap-4 items-start">
            <AiPanel
              promptText={aiPromptText}
              promptPresets={promptPresets}
              selectedPromptPresetId={selectedPromptPresetId}
              promptPresetName={promptPresetName}
              generating={generatingAiOutput}
              rawText={aiRawText}
              cleanedText={cleanedAiText}
              onPromptTextChange={updateAiPromptText}
              onPromptPresetChange={selectPromptPreset}
              onPromptPresetNameChange={setPromptPresetName}
              onSavePromptPreset={savePromptPreset}
              onRenamePromptPreset={renamePromptPreset}
              onDeletePromptPreset={deletePromptPreset}
              onGenerate={generateAiOutput}
              onRawTextChange={setAiRawText}
              onApply={applyAiToForm}
              onClean={() => {
                const cleaned = sanitizeAiOutput(aiRawText);
                setAiRawText(cleaned);
                setCleanedAiText(cleaned);
                setLastAction("大模型输出已清理");
              }}
            />
            <ProductFormPanel
              form={form}
              setForm={setForm}
              variantRows={variantRows}
              setVariantRows={setVariantRows}
              mediaItems={mediaItems}
              onPreviewMedia={setPreviewMedia}
              onRemoveMedia={removeMedia}
              onMoveMedia={moveMedia}
              onUpdateMediaRole={updateMediaRole}
              onUploadLocalMedia={uploadLocalMedia}
              uploadingMedia={uploadingMedia}
            />
            <SyncPanel
              form={form}
              syncState={syncState}
              syncAction={syncAction}
              lastAction={lastAction}
              shopifyProductUrl={shopifyProductUrl}
              warnings={syncWarnings}
              onSaveDraft={() =>
                syncToShopify(
                  form.status === "ARCHIVED" ? "ARCHIVED" : "DRAFT",
                  "draft",
                )
              }
              onSync={() => syncToShopify("ACTIVE", "publish")}
              onStatusChange={(status) =>
                setForm((prev) => ({ ...prev, status }))
              }
              onProductTypeChange={(value) =>
                setForm((prev) => ({ ...prev, productType: value }))
              }
              onVendorChange={(value) =>
                setForm((prev) => ({ ...prev, vendor: value }))
              }
              onTemplateStyleChange={(value) =>
                setForm((prev) => ({ ...prev, templateStyle: value }))
              }
              onAddTag={(tag) =>
                setForm((prev) => ({
                  ...prev,
                  tags: appendProductTag(prev.tags, tag),
                }))
              }
              onRemoveTag={(tag) =>
                setForm((prev) => ({
                  ...prev,
                  tags: removeProductTag(prev.tags, tag),
                }))
              }
              onRemoveCollection={(collection) =>
                setForm((prev) => ({
                  ...prev,
                  collections: removeProductTag(prev.collections, collection),
                }))
              }
            />
          </div>
        </div>
      )}

      <Dialog
        open={shopifyAccountDialogOpen}
        onClose={() => setShopifyAccountDialogOpen(false)}
        title="切换 Shopify 店铺"
        description="选择本机已绑定店铺，或添加新的店铺授权。"
        width="2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShopifyAccountDialogOpen(false)}>
              关闭
            </Button>
            <Button
              variant="primary"
              leftIcon={<Store size={14} />}
              onClick={beginAddShopifyAccount}
            >
              添加店铺
            </Button>
          </>
        }
      >
        <div className="max-h-[392px] overflow-y-auto pr-1">
          {shopifyAccounts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {shopifyAccounts.map((account) => {
                const active = account.isActive || account.shopDomain === binding?.shopDomain;
                return (
                  <button
                    key={account.shopDomain}
                    type="button"
                    disabled={switchingShopifyAccount}
                    onClick={() =>
                      active
                        ? setShopifyAccountDialogOpen(false)
                        : selectShopifyAccount(account.shopDomain)
                    }
                    className={`w-full min-h-[86px] rounded-md border px-3 py-2.5 text-left transition ${
                      active
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-border-subtle bg-white hover:bg-bg-tertiary"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-fg-primary truncate">
                          {account.shopName || account.shopDomain}
                        </div>
                        <div className="mt-1 text-[11px] text-fg-tertiary truncate">
                          {account.shopDomain}
                        </div>
                        {account.primaryDomain ? (
                          <div className="mt-0.5 text-[11px] text-fg-tertiary truncate">
                            主域名：{account.primaryDomain}
                          </div>
                        ) : null}
                      </div>
                      {active ? <Chip tone="success">当前</Chip> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border-subtle bg-bg-tertiary px-3 py-4 text-sm text-fg-tertiary">
              当前电脑还没有已绑定的 Shopify 店铺。
            </div>
          )}
        </div>
      </Dialog>

      <Dialog
        open={confirmUnbind}
        onClose={() => setConfirmUnbind(false)}
        title="确认解除 Shopify 绑定？"
        description="解除后将删除本地保存的店铺域名和 Access Token，产品上架功能将暂停同步到 Shopify。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmUnbind(false)}>
              取消
            </Button>
            <Button variant="danger" loading={unbinding} onClick={unbindShopify}>
              确认解除
            </Button>
          </>
        }
      >
        <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">
          解除绑定只影响 Shopify 连接信息，不会删除当前页面已经填写的商品草稿。
        </div>
      </Dialog>

      <Dialog
        open={!!previewMedia}
        onClose={() => setPreviewMedia(null)}
        title={previewMedia?.alt || "媒体预览"}
        width="lg"
      >
        {previewMedia ? (
          <div className="rounded-lg bg-bg-tertiary border border-border-subtle overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewMedia.url}
              alt={previewMedia.alt}
              className="block max-h-[70vh] w-full object-contain"
            />
          </div>
        ) : null}
      </Dialog>
    </main>
  );
}

function UnboundView({
  authMode,
  shopDomain,
  accessToken,
  clientId,
  clientSecret,
  tokenPreview,
  connectionMessage,
  testing,
  savingBinding,
  onAuthModeChange,
  onShopDomainChange,
  onAccessTokenChange,
  onClientIdChange,
  onClientSecretChange,
  onFillTestCredentials,
  onTestConnection,
  onSaveBinding,
}: {
  authMode: ShopifyBinding["authMode"];
  shopDomain: string;
  accessToken: string;
  clientId: string;
  clientSecret: string;
  tokenPreview: string;
  connectionMessage: string | null;
  testing: boolean;
  savingBinding: boolean;
  onAuthModeChange: (value: ShopifyBinding["authMode"]) => void;
  onShopDomainChange: (value: string) => void;
  onAccessTokenChange: (value: string) => void;
  onClientIdChange: (value: string) => void;
  onClientSecretChange: (value: string) => void;
  onFillTestCredentials: () => void;
  onTestConnection: () => void;
  onSaveBinding: () => void;
}) {
  return (
    <div className="min-h-[520px] flex items-center justify-center">
      <Card elevated padding="lg" className="w-full max-w-3xl">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="md:w-[260px] shrink-0">
            <div className="w-11 h-11 rounded-md bg-[var(--brand-50-bg)] text-brand-400 flex items-center justify-center mb-4">
              <KeyRound size={20} strokeWidth={2.2} />
            </div>
            <h2 className="text-lg font-semibold text-fg-primary">
              请绑定 Shopify 凭据
            </h2>
            <p className="mt-2 text-sm text-fg-tertiary leading-relaxed">
              新版 Dev Dashboard 应用请使用 OAuth 授权安装；旧版自定义应用也可以继续使用 shpat Token。
            </p>
            <button
              type="button"
              onClick={onFillTestCredentials}
              className="mt-3 text-xs font-medium text-brand-400 hover:text-brand-600"
            >
              填入测试密钥
            </button>
            <div className="mt-4 rounded-md border border-border-subtle bg-bg-tertiary p-3 text-xs text-fg-secondary space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span>连接状态</span>
                <Chip tone="warn">未绑定</Chip>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>{authMode === "access_token" ? "Token 预览" : "密钥预览"}</span>
                <span className="font-mono text-[11px]">{tokenPreview}</span>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-3">
            <Select
              label="绑定方式"
              value={authMode}
              onChange={(e) =>
                onAuthModeChange(e.target.value as ShopifyBinding["authMode"])
              }
            >
              <option value="oauth_app">新版：Shopify OAuth 授权安装</option>
              <option value="access_token">旧版：Admin API Access Token</option>
            </Select>
            <div>
              <Input
                label="店铺原始域名"
                value={shopDomain}
                onChange={(e) => onShopDomainChange(e.target.value)}
                placeholder="xxxx.myshopify.com"
                leftAddon={<Store size={14} />}
              />
              <p className="mt-1 text-[11px] leading-relaxed text-fg-tertiary">
                填 Shopify 后台“设置 &gt; 域名”里的原始 myshopify.com 域名，不要填 www 自定义域名。
              </p>
            </div>
            {authMode !== "access_token" ? (
              <>
                <Input
                  label="客户端 ID"
                  value={clientId}
                  onChange={(e) => onClientIdChange(e.target.value)}
                  placeholder="从 Shopify Dev Dashboard 凭据页复制"
                  leftAddon={<KeyRound size={14} />}
                />
                <Input
                  label="客户端密钥"
                  value={clientSecret}
                  onChange={(e) => onClientSecretChange(e.target.value)}
                  placeholder="shpss_..."
                  type="password"
                  leftAddon={<KeyRound size={14} />}
                />
              </>
            ) : (
              <Input
                label="Admin API Access Token"
                value={accessToken}
                onChange={(e) => onAccessTokenChange(e.target.value)}
                placeholder="shpat_..."
                type="password"
                leftAddon={<KeyRound size={14} />}
              />
            )}
            {connectionMessage ? (
              <div className="rounded-md border border-border-subtle bg-bg-tertiary px-3 py-2 text-xs text-fg-secondary">
                {connectionMessage}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="secondary"
                leftIcon={<KeyRound size={14} />}
                onClick={onFillTestCredentials}
              >
                测试密钥
              </Button>
              <Button
              variant="outline"
              leftIcon={<Link size={14} />}
              loading={testing}
              disabled={authMode !== "access_token"}
              onClick={onTestConnection}
            >
              测试连接
              </Button>
              <Button
                variant="primary"
              leftIcon={<Save size={14} />}
              loading={savingBinding}
              onClick={onSaveBinding}
            >
              {authMode === "access_token" ? "保存" : "开始 Shopify 授权"}
            </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function BoundStatusCard({
  binding,
  connectionMessage,
  testing,
  unbinding,
  onTestConnection,
  onConfirmUnbind,
  onSwitchAccount,
}: {
  binding: ShopifyBinding;
  connectionMessage: string | null;
  testing: boolean;
  unbinding: boolean;
  onTestConnection: () => void;
  onConfirmUnbind: () => void;
  onSwitchAccount: () => void;
}) {
  return (
    <Card padding="md">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-md bg-[var(--success-bg)] text-success flex items-center justify-center shrink-0">
            <CheckCircle2 size={17} strokeWidth={2.2} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-fg-primary">
                Shopify 已绑定
              </h2>
              <Chip tone="success">可同步</Chip>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-tertiary">
              <span>
                绑定方式：
                {binding.authMode === "oauth_app"
                  ? "Shopify OAuth"
                  : binding.authMode === "client_credentials"
                    ? "客户端凭据"
                    : "Access Token"}
              </span>
              <span>店铺域名：{binding.shopDomain}</span>
              {binding.clientIdPreview ? (
                <span>客户端 ID：{binding.clientIdPreview}</span>
              ) : null}
              <span>密钥预览：{binding.tokenPreview}</span>
              <span>绑定时间：{formatUnixTime(binding.createdAt)}</span>
              {binding.shopName ? <span>店铺名称：{binding.shopName}</span> : null}
              {binding.primaryDomain ? <span>主域名：{binding.primaryDomain}</span> : null}
            </div>
            {connectionMessage ? (
              <div className="mt-2 text-xs text-fg-secondary">
                {connectionMessage}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Link size={13} />}
            loading={testing}
            onClick={onTestConnection}
          >
            测试连接
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw size={13} />}
            loading={unbinding}
            onClick={onSwitchAccount}
          >
            切换账户
          </Button>
          <Button
            variant="danger-outline"
            size="sm"
            onClick={onConfirmUnbind}
          >
            解除绑定
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AiPanel({
  promptText,
  promptPresets,
  selectedPromptPresetId,
  promptPresetName,
  generating,
  rawText,
  cleanedText,
  onPromptTextChange,
  onPromptPresetChange,
  onPromptPresetNameChange,
  onSavePromptPreset,
  onRenamePromptPreset,
  onDeletePromptPreset,
  onGenerate,
  onRawTextChange,
  onApply,
  onClean,
}: {
  promptText: string;
  promptPresets: ProductListingPromptPreset[];
  selectedPromptPresetId: string;
  promptPresetName: string;
  generating: boolean;
  rawText: string;
  cleanedText: string;
  onPromptTextChange: (value: string) => void;
  onPromptPresetChange: (id: string) => void;
  onPromptPresetNameChange: (value: string) => void;
  onSavePromptPreset: () => void;
  onRenamePromptPreset: () => void;
  onDeletePromptPreset: (id: string) => void;
  onGenerate: () => void;
  onRawTextChange: (value: string) => void;
  onApply: () => void;
  onClean: () => void;
}) {
  return (
    <Card padding="md" className="space-y-4">
      <CardHeader
        title="大模型文字输出"
        subtitle="输入提示词解析商品信息，再清理并映射到右侧商品字段"
        action={<Chip tone="brand">输入源</Chip>}
      />

      <Textarea
        label="大模型提示词"
        value={promptText}
        onChange={(e) => onPromptTextChange(e.target.value)}
        placeholder="例如：请根据主图和细节图生成 Shopify 英文商品标题、描述、产品系列、标签、类别元字段、SKU、原价、售价建议和 SEO 信息，输出为 key: value 格式。"
        rows={5}
      />

      <div className="space-y-2">
        <PromptPresetPicker
          presets={promptPresets}
          selectedId={selectedPromptPresetId}
          onSelect={onPromptPresetChange}
          onDelete={onDeletePromptPreset}
        />
        <Input
          label="预设名称"
          value={promptPresetName}
          onChange={(e) => onPromptPresetNameChange(e.target.value)}
          placeholder="给提示词起个名字"
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Save size={13} />}
            onClick={onSavePromptPreset}
          >
            保存为预设
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!selectedPromptPresetId}
            onClick={onRenamePromptPreset}
          >
            重命名
          </Button>
        </div>
      </div>

      <Button
        variant="primary"
        size="sm"
        fullWidth
        loading={generating}
        leftIcon={<Send size={13} />}
        onClick={onGenerate}
      >
        开始解析
      </Button>

      <Textarea
        label="完整大模型输出"
        value={rawText}
        onChange={(e) => onRawTextChange(e.target.value)}
        placeholder="解析后会输出标题、描述、颜色、材质、SKU、原价、售价等完整内容"
        rows={12}
      />

      <div className="rounded-md border border-border-subtle bg-bg-tertiary p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-medium text-fg-tertiary">
            清理后预览
          </div>
          <Chip tone={cleanedText ? "success" : "gray"}>
            {cleanedText ? `${cleanedText.length} 字符` : "待清理"}
          </Chip>
        </div>
        <div className="mt-2 max-h-[180px] overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-fg-secondary">
          {cleanedText || "清理后会去除多余空格、乱码、无效控制字符，并保留可识别字段。"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          leftIcon={<RefreshCw size={13} />}
          onClick={onClean}
        >
          清理文字
        </Button>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<ArrowRight size={13} />}
          onClick={onApply}
        >
          填入表单
        </Button>
      </div>
    </Card>
  );
}

function PromptPresetPicker({
  presets,
  selectedId,
  onSelect,
  onDelete,
}: {
  presets: ProductListingPromptPreset[];
  selectedId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = presets.find((preset) => preset.id === selectedId);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <label className="block text-xs font-medium text-gray-600 mb-1">
        预设提示词
      </label>
      <button
        type="button"
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-left text-sm text-gray-900 transition-colors hover:border-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 truncate">{selected?.name || "选择预设"}</span>
        <ChevronDown size={14} strokeWidth={2} className="shrink-0 text-gray-400" />
      </button>
      {open ? (
        <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg">
          <button
            type="button"
            className={`block w-full px-3 py-2 text-left ${
              !selectedId
                ? "bg-gray-100 text-gray-900"
                : "text-gray-700 hover:bg-gray-50"
            }`}
            onClick={() => {
              onSelect("");
              setOpen(false);
            }}
          >
            选择预设
          </button>
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title="右键删除"
              className={`block w-full px-3 py-2 text-left ${
                selectedId === preset.id
                  ? "bg-brand-50 text-brand-700"
                  : "text-gray-900 hover:bg-gray-50"
              }`}
              onClick={() => {
                onSelect(preset.id);
                setOpen(false);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onDelete(preset.id);
              }}
            >
              <span className="block truncate">{preset.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type CategoryColorOption = (typeof CATEGORY_COLOR_OPTIONS)[number];

function normalizeCategoryColor(value: string) {
  return value.trim().toLowerCase();
}

function CategoryColorSwatch({
  option,
  className = "",
}: {
  option: CategoryColorOption;
  className?: string;
}) {
  const pattern = option.patterned
    ? {
        backgroundImage:
          "linear-gradient(45deg, rgba(0,0,0,0.08) 25%, transparent 25%), linear-gradient(-45deg, rgba(0,0,0,0.08) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.08) 75%), linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.08) 75%)",
        backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
        backgroundSize: "16px 16px",
      }
    : null;

  return (
    <span
      className={`inline-block h-4 w-4 shrink-0 rounded border ${
        option.ring ? "border-gray-300" : "border-transparent"
      } ${className}`}
      style={{ backgroundColor: option.color, ...(pattern || {}) }}
    />
  );
}

function CategoryColorInput({
  value,
  shopifyOptions = [],
  sourceLabel = "Shopify 当前分类",
  onChange,
}: {
  value: string;
  shopifyOptions?: ShopifyCategoryMetafieldOption[];
  sourceLabel?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = CATEGORY_COLOR_OPTIONS.find(
    (option) =>
      normalizeCategoryColor(option.value) === normalizeCategoryColor(value) ||
      normalizeCategoryColor(option.label) === normalizeCategoryColor(value),
  );

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function chooseValue(item: string) {
    onChange(item);
    setOpen(false);
  }

  function renderShopifyOption(item: ShopifyCategoryMetafieldOption) {
    const option = CATEGORY_COLOR_OPTIONS.find(
      (colorOption) =>
        normalizeCategoryColor(colorOption.value) ===
          normalizeCategoryColor(item.value) ||
        normalizeCategoryColor(colorOption.label) ===
          normalizeCategoryColor(item.value),
    );
    const active = normalizeCategoryColor(item.value) === normalizeCategoryColor(value);

    return (
      <button
        key={`shopify-${item.id}`}
        type="button"
        className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors ${
          active ? "bg-purple-50 text-purple-700" : "text-gray-800 hover:bg-gray-50"
        }`}
        onClick={() => chooseValue(item.value)}
      >
        {option ? (
          <CategoryColorSwatch option={option} />
        ) : (
          <span className="h-4 w-4 shrink-0 rounded border border-gray-200 bg-white" />
        )}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </button>
    );
  }

  return (
    <div ref={rootRef} className="category-metafield-control relative">
      <div className="flex h-8 w-full items-center rounded-md border border-gray-300 bg-white transition-colors">
        {selected ? <CategoryColorSwatch option={selected} className="ml-2" /> : null}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="类别元字段颜色"
          className="h-full min-w-0 flex-1 rounded-md bg-transparent px-2 text-xs text-gray-900 outline-none"
        />
        <button
          type="button"
          aria-label="选择颜色色系"
          className="flex h-full w-8 shrink-0 items-center justify-center rounded-r-md text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronDown
            size={14}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {open ? (
        <div className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-purple-100 bg-white p-1 text-xs shadow-lg">
          {shopifyOptions.length ? (
            <>
              <div className="px-2 py-1 text-[11px] font-semibold text-purple-700">
                {sourceLabel}
              </div>
              <div className="space-y-0.5">
                {shopifyOptions.map(renderShopifyOption)}
              </div>
            </>
          ) : (
            <div className="px-2 py-2 text-xs text-gray-400">
              暂无 Shopify 官方选项
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CategoryMetafieldMemoryInput({
  value,
  history = [],
  shopifyOptions = [],
  sourceLabel = "Shopify 当前分类",
  ariaLabel,
  onChange,
  onRemember,
  onDeleteHistory,
}: {
  value: string;
  history?: string[];
  shopifyOptions?: ShopifyCategoryMetafieldOption[];
  sourceLabel?: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  onRemember: (value: string) => void;
  onDeleteHistory: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const normalizedValue = normalizeCategoryMetafieldMemoryValue(value).toLowerCase();

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function chooseHistory(item: string) {
    onChange(item);
    onRemember(item);
    setOpen(false);
  }

  function chooseShopifyOption(item: ShopifyCategoryMetafieldOption) {
    onChange(item.value);
    onRemember(item.value);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="category-metafield-control relative">
      <div className="flex h-8 w-full items-center rounded-md border border-gray-300 bg-white transition-colors">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onRemember(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRemember(e.currentTarget.value);
              e.currentTarget.blur();
            }
          }}
          aria-label={ariaLabel}
          className="h-full min-w-0 flex-1 rounded-md bg-transparent px-2 text-xs text-gray-900 outline-none"
        />
        <button
          type="button"
          aria-label="查看历史输入"
          className="flex h-full w-8 shrink-0 items-center justify-center rounded-r-md text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          onClick={() => {
            onRemember(value);
            setOpen((current) => !current);
          }}
        >
          <ChevronDown
            size={14}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {open ? (
        <div className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-purple-100 bg-white p-1 text-xs shadow-lg">
          {shopifyOptions.length ? (
            <>
              <div className="px-2 py-1 text-[11px] font-semibold text-purple-700">
                {sourceLabel}
              </div>
              <div className="space-y-0.5">
                {shopifyOptions.map((item) => {
                  const active =
                    normalizeCategoryMetafieldMemoryValue(item.value).toLowerCase() ===
                    normalizedValue;
                  return (
                    <button
                      key={`shopify-${item.id}`}
                      type="button"
                      className={`flex h-8 w-full items-center rounded-md px-2 text-left text-xs transition-colors ${
                        active
                          ? "bg-purple-50 text-purple-700"
                          : "text-gray-800 hover:bg-gray-50"
                      }`}
                      onClick={() => chooseShopifyOption(item)}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="my-1 border-t border-gray-100" />
            </>
          ) : null}
          {history.length ? (
            <div className="space-y-0.5">
              {history.map((item) => {
                const active =
                  normalizeCategoryMetafieldMemoryValue(item).toLowerCase() ===
                  normalizedValue;
                return (
                  <button
                    key={item}
                    type="button"
                    title="右键删除"
                    className={`flex h-8 w-full items-center rounded-md px-2 text-left text-xs transition-colors ${
                      active
                        ? "bg-purple-50 text-purple-700"
                        : "text-gray-800 hover:bg-gray-50"
                    }`}
                    onClick={() => chooseHistory(item)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onDeleteHistory(item);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{item}</span>
                  </button>
                );
              })}
            </div>
          ) : shopifyOptions.length ? null : (
            <div className="px-2 py-2 text-xs text-gray-400">暂无历史输入</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function getCategoryMetafieldSourceLabel(
  field?: ShopifyCategoryMetafieldField,
): string {
  if (!field?.options.length) return "Shopify 当前分类";
  if (field.source === "store") return "Shopify 后台已有条目";
  if (field.source === "official") return "Shopify 官方选项";
  return "Shopify 当前分类";
}

function ShopifyCategoryPicker({
  valueId,
  valueName,
  onChange,
}: {
  valueId: string;
  valueName: string;
  onChange: (category: { id: string; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [path, setPath] = useState<ShopifyTaxonomyCategoryOption[]>([]);
  const [items, setItems] = useState<ShopifyTaxonomyCategoryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected =
    valueId && valueId !== SHOPIFY_UNCATEGORIZED_CATEGORY_ID
      ? valueName || "已选择类别"
      : "";
  const parent = path.length ? path[path.length - 1] : null;
  const searchText = query.trim();

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (searchText) {
        params.set("search", searchText);
      } else if (parent?.id) {
        params.set("childrenOf", parent.id);
      }
      setLoading(true);
      setError("");
      fetchWithShopifyDevice(`/api/shopify/categories?${params.toString()}`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          const data = (await res.json()) as {
            categories?: ShopifyTaxonomyCategoryOption[];
            error?: string;
          };
          if (!res.ok) throw new Error(data.error || res.statusText);
          setItems(data.categories || []);
        })
        .catch((e) => {
          if (controller.signal.aborted) return;
          setItems([]);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, searchText ? 180 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, parent?.id, searchText]);

  function chooseCategory(category: ShopifyTaxonomyCategoryOption) {
    onChange({
      id: category.id,
      name: getShopifyCategoryOptionLabel(category),
    });
    setOpen(false);
    setQuery("");
  }

  function hasCategoryChildren(category: ShopifyTaxonomyCategoryOption) {
    return !category.isLeaf || category.childrenCount > 0;
  }

  function enterCategory(category: ShopifyTaxonomyCategoryOption) {
    setPath((prev) => [...prev, category]);
    setQuery("");
  }

  function handleCategoryClick(category: ShopifyTaxonomyCategoryOption) {
    if (!searchText && hasCategoryChildren(category)) {
      enterCategory(category);
      return;
    }
    chooseCategory(category);
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="mb-1 text-xs text-gray-700">类别</div>
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-2 rounded-md border border-gray-300 bg-white px-2 text-left text-sm text-gray-900 shadow-sm transition-colors hover:border-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
        onClick={() => setOpen((current) => !current)}
      >
        {selected ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded bg-gray-100 px-2 py-1 text-xs text-gray-800">
            <span className="min-w-0 truncate">{selected}</span>
            <span
              role="button"
              tabIndex={0}
              className="rounded text-gray-500 hover:text-gray-800"
              onClick={(e) => {
                e.stopPropagation();
                onChange({
                  id: SHOPIFY_UNCATEGORIZED_CATEGORY_ID,
                  name: "未分类",
                });
                setPath([]);
                setQuery("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange({
                    id: SHOPIFY_UNCATEGORIZED_CATEGORY_ID,
                    name: "未分类",
                  });
                  setPath([]);
                  setQuery("");
                }
              }}
              aria-label="清除类别"
            >
              <X size={13} />
            </span>
          </span>
        ) : (
          <span className="flex-1 text-gray-500">未分类</span>
        )}
        <ChevronDown
          size={15}
          className={`ml-auto shrink-0 text-gray-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open ? (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
            <Search size={15} className="shrink-0 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索类别"
              className="h-7 min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
              autoFocus
            />
          </div>

          {!searchText && path.length > 0 ? (
            <div className="flex items-center gap-1 border-b border-gray-100 px-3 py-2 text-[11px] text-gray-500">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 hover:bg-gray-100 hover:text-gray-800"
                onClick={() => setPath([])}
              >
                返回所有类别
              </button>
              {path.map((category, index) => (
                <span key={category.id} className="inline-flex items-center gap-1">
                  <span>/</span>
                  <button
                    type="button"
                    className="max-w-[120px] truncate rounded px-1.5 py-0.5 hover:bg-gray-100 hover:text-gray-800"
                    onClick={() => setPath(path.slice(0, index + 1))}
                  >
                    {getShopifyCategoryOptionLabel(category)}
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="max-h-80 overflow-y-auto p-1">
            {loading ? (
              <div className="px-3 py-8 text-center text-xs text-gray-400">
                正在读取 Shopify 类别
              </div>
            ) : error ? (
              <div className="px-3 py-3 text-xs text-amber-600">{error}</div>
            ) : items.length ? (
              items.map((category) => {
                const hasChildren = hasCategoryChildren(category);
                const label = searchText
                  ? getShopifyCategoryOptionFullLabel(category)
                  : getShopifyCategoryOptionLabel(category);
                return (
                  <div
                    key={category.id}
                    className="flex items-center rounded-md hover:bg-gray-50"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 px-3 py-2 text-left text-sm text-gray-800"
                      onClick={() => handleCategoryClick(category)}
                      aria-label={
                        !searchText && hasChildren
                          ? `进入 ${label} 子类别`
                          : `选择 ${label}`
                      }
                    >
                      <span className="block truncate">
                        {label}
                      </span>
                    </button>
                    {!searchText && hasChildren ? (
                      <button
                        type="button"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                        onClick={() => enterCategory(category)}
                        aria-label={`查看 ${label} 子类别`}
                      >
                        <ArrowRight size={14} />
                      </button>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="px-3 py-8 text-center text-xs text-gray-400">
                暂无 Shopify 类别
              </div>
            )}
          </div>
        </div>
      ) : null}
      <div className="mt-1 text-[11px] text-fg-tertiary">
        确定税率并添加元字段，以改进搜索、筛选和跨渠道销售
      </div>
    </div>
  );
}

function ProductFormPanel({
  form,
  setForm,
  variantRows,
  setVariantRows,
  mediaItems,
  onPreviewMedia,
  onRemoveMedia,
  onMoveMedia,
  onUpdateMediaRole,
  onUploadLocalMedia,
  uploadingMedia,
}: {
  form: ProductForm;
  setForm: React.Dispatch<React.SetStateAction<ProductForm>>;
  variantRows: ProductVariantRow[];
  setVariantRows: React.Dispatch<React.SetStateAction<ProductVariantRow[]>>;
  mediaItems: ProductListingMediaItem[];
  onPreviewMedia: (item: ProductListingMediaItem) => void;
  onRemoveMedia: (id: string) => void;
  onMoveMedia: (id: string, direction: -1 | 1) => void;
  onUpdateMediaRole: (id: string, role: ProductMediaRole) => void;
  onUploadLocalMedia: (files: FileList | null) => void;
  uploadingMedia: boolean;
}) {
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const variantFileInputRef = useRef<HTMLInputElement | null>(null);
  const variantOptionMenuRef = useRef<HTMLDivElement | null>(null);
  const rootCategoryId = getShopifyRootCategoryId(form.shopifyCategoryId);
  const apparelSubcategoryId = getShopifyApparelSubcategoryId(
    form.shopifyCategoryId,
  );
  const showApparelSubcategory = isShopifyApparelCategory(form.shopifyCategoryId);
  const showClothingSubcategory = isShopifyClothingCategory(
    form.shopifyCategoryId,
  );
  const [variantDialogOpen, setVariantDialogOpen] = useState(false);
  const [variantSizeText, setVariantSizeText] = useState("");
  const [variantFileName, setVariantFileName] = useState("");
  const [skuExpanded, setSkuExpanded] = useState(false);
  const [variantSectionCollapsed, setVariantSectionCollapsed] = useState(false);
  const [variantOptionMenuOpen, setVariantOptionMenuOpen] = useState(false);
  const [variantOptionSearch, setVariantOptionSearch] = useState("");
  const [categoryMetafieldMemory, setCategoryMetafieldMemory] =
    useState<CategoryMetafieldMemory>(() => loadCategoryMetafieldMemory());
  const [shopifyCategoryMetafields, setShopifyCategoryMetafields] =
    useState<ShopifyCategoryMetafieldFields>({});
  const [loadingCategoryMetafields, setLoadingCategoryMetafields] =
    useState(false);
  const [categoryMetafieldLoadError, setCategoryMetafieldLoadError] =
    useState("");
  const parsedVariantSizes = parseVariantSizes(variantSizeText);
  const selectedMainMedia =
    mediaItems.find((item) => item.role === "main") || mediaItems[0] || null;
  const totalVariantInventory = variantRows.reduce((sum, row) => {
    const value = Number(row.inventory);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const filledCategoryMetafields = CATEGORY_METAFIELD_ROWS.filter((row) =>
    form[row.key].trim(),
  ).length;
  const categoryMetafieldContext = getShopifyCategoryMetafieldContext(
    form.shopifyCategoryId,
  );
  const variantOptionName = form.variantOptionName.trim() || "Size";
  const filteredVariantOptionRecommendations = useMemo(() => {
    const keyword = variantOptionSearch.trim().toLowerCase();
    if (!keyword) return VARIANT_OPTION_RECOMMENDATIONS;
    return VARIANT_OPTION_RECOMMENDATIONS.filter((option) =>
      option.toLowerCase().includes(keyword),
    );
  }, [variantOptionSearch]);

  useEffect(() => {
    if (!variantOptionMenuOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (!variantOptionMenuRef.current?.contains(e.target as Node)) {
        setVariantOptionMenuOpen(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [variantOptionMenuOpen]);

  useEffect(() => {
    const categoryId = form.shopifyCategoryId;
    if (
      !categoryId ||
      categoryId === SHOPIFY_UNCATEGORIZED_CATEGORY_ID ||
      !isShopifyTaxonomyCategoryId(categoryId)
    ) {
      setShopifyCategoryMetafields({});
      setCategoryMetafieldLoadError("");
      setLoadingCategoryMetafields(false);
      return;
    }

    const controller = new AbortController();
    setLoadingCategoryMetafields(true);
    setCategoryMetafieldLoadError("");
    fetchWithShopifyDevice(
      `/api/shopify/category-metafields?categoryId=${encodeURIComponent(categoryId)}`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        const data = (await res.json()) as {
          fields?: ShopifyCategoryMetafieldFields;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || res.statusText);
        setShopifyCategoryMetafields(data.fields || {});
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setShopifyCategoryMetafields({});
        setCategoryMetafieldLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingCategoryMetafields(false);
      });

    return () => controller.abort();
  }, [form.shopifyCategoryId]);

  function update<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    if (key === "inventory") {
      setForm((prev) => {
        const nextInventory = String(value || "");
        const previousInventory = prev.inventory;
        setVariantRows((rows) =>
          rows.map((row) =>
            row.inventory === "" || row.inventory === previousInventory
              ? { ...row, inventory: nextInventory }
              : row,
          ),
        );
        return { ...prev, inventory: nextInventory };
      });
      return;
    }
    if (key === "price") {
      setForm((prev) => {
        const nextPrice = String(value || "");
        const previousPrice = prev.price;
        setVariantRows((rows) =>
          rows.map((row) =>
            isDefaultVariantPrice(row.price, previousPrice)
              ? { ...row, price: nextPrice }
              : row,
          ),
        );
        return { ...prev, price: nextPrice };
      });
      return;
    }
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function rememberCategoryMetafieldValue(
    key: CategoryMetafieldFormKey,
    value: string,
  ) {
    setCategoryMetafieldMemory((prev) => {
      const next = addCategoryMetafieldMemoryValue(prev, key, value);
      if (next === prev) return prev;
      saveCategoryMetafieldMemory(next);
      return next;
    });
  }

  function deleteCategoryMetafieldMemoryValue(
    key: CategoryMetafieldFormKey,
    value: string,
  ) {
    setCategoryMetafieldMemory((prev) => {
      const next = removeCategoryMetafieldMemoryValue(prev, key, value);
      if (next === prev) return prev;
      saveCategoryMetafieldMemory(next);
      return next;
    });
  }

  function updateShopifyCategory(id: string) {
    const category = findShopifyCategoryById(id);
    setForm((prev) => ({
      ...prev,
      shopifyCategoryId: category?.id || SHOPIFY_UNCATEGORIZED_CATEGORY_ID,
      shopifyCategoryName: category?.zh || "未分类",
    }));
  }

  function updateShopifyApparelCategory(id: string) {
    const category =
      findShopifyCategoryById(id) ||
      findShopifyCategoryById(SHOPIFY_APPAREL_ACCESSORIES_CATEGORY_ID);
    setForm((prev) => ({
      ...prev,
      shopifyCategoryId:
        category?.id || SHOPIFY_APPAREL_ACCESSORIES_CATEGORY_ID,
      shopifyCategoryName: category?.zh || "服饰与配饰",
    }));
  }

  function updateShopifyClothingCategory(id: string) {
    const category =
      findShopifyCategoryById(id) ||
      findShopifyCategoryById(SHOPIFY_CLOTHING_CATEGORY_ID);
    setForm((prev) => ({
      ...prev,
      shopifyCategoryId: category?.id || SHOPIFY_CLOTHING_CATEGORY_ID,
      shopifyCategoryName: category?.zh || "服装",
    }));
  }

  function normalizeVariantOptionName(name: string) {
    const cleaned = name.trim();
    if (!cleaned) return "Size";
    return cleaned === "尺寸" ? "Size" : cleaned;
  }

  function openVariantDialog(optionName = variantOptionName) {
    const nextOptionName = normalizeVariantOptionName(optionName);
    setVariantSectionCollapsed(false);
    update("variantOptionName", nextOptionName);
    const useExistingValues = variantRows.length > 0 && nextOptionName === variantOptionName;
    setVariantSizeText(
      useExistingValues
        ? variantRows.map((row) => row.size).join("\n")
        : nextOptionName === "Size"
          ? DEFAULT_SIZE_VARIANT_OPTIONS.join("\n")
          : "",
    );
    setVariantFileName("");
    setVariantDialogOpen(true);
  }

  function chooseVariantOption(optionName: string) {
    setVariantOptionMenuOpen(false);
    setVariantOptionSearch("");
    openVariantDialog(optionName);
  }

  function openCustomVariantOption() {
    setVariantOptionMenuOpen(false);
    setVariantOptionSearch("");
    openVariantDialog("自定义选项");
  }

  async function importVariantSizeFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const text = await file.text();
    setVariantSizeText((prev) => [prev.trim(), text.trim()].filter(Boolean).join("\n"));
    setVariantFileName(file.name);
  }

  function confirmVariantRows() {
    const sizes = parsedVariantSizes;
    if (!sizes.length) return;
    update("variantOptionName", normalizeVariantOptionName(form.variantOptionName));
    const existingBySize = new Map(variantRows.map((row) => [row.size, row]));
    setVariantRows(
      sizes.map((size, index) => {
        const existing = existingBySize.get(size);
        return {
          id: existing?.id || `variant-${Date.now()}-${index}`,
          size,
          sku: existing?.sku || variantSku(form.sku, size, index),
          price: existing?.price || form.price || "0.00",
          inventory: existing ? existing.inventory : form.inventory || "",
          selected: existing?.selected ?? true,
          isMainImage: true,
          imageUrl: selectedMainMedia?.url || "",
          imageAlt: selectedMainMedia?.alt || size,
        };
      }),
    );
    setVariantDialogOpen(false);
    setVariantFileName("");
    setVariantSectionCollapsed(false);
  }

  function updateVariantRow(
    id: string,
    patch: Partial<Pick<ProductVariantRow, "selected" | "isMainImage" | "price" | "inventory">>,
  ) {
    setVariantRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  function removeVariantRows() {
    setVariantRows([]);
    setVariantSizeText("");
    setVariantFileName("");
  }

  function autoMatchShopifyCategory() {
    setForm((prev) => {
      const category = inferShopifyCategoryFromForm(prev);
      if (!category) {
        return {
          ...prev,
          shopifyCategoryId: SHOPIFY_UNCATEGORIZED_CATEGORY_ID,
          shopifyCategoryName: "未分类",
        };
      }
      return {
        ...prev,
        shopifyCategoryId: category.id,
        shopifyCategoryName: category.zh,
      };
    });
  }

  return (
    <div className="space-y-3">
      <ShopifySection>
        <div className="space-y-3">
          <Input
            label="标题"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="短袖 T 恤"
          />
          <Textarea
            label="描述"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="输入商品描述、卖点、面料、适用场景"
            rows={7}
          />
        </div>
      </ShopifySection>

      <ShopifySection>
        <div className="relative space-y-3 pb-12">
          <ShopifySectionHeader
            title="媒体文件"
            action={
              <Chip tone={mediaItems.length > 0 ? "brand" : "gray"}>
                {mediaItems.length} 张
              </Chip>
            }
          />
          {mediaItems.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">
              {mediaItems.map((item, idx) => (
                <div
                  key={item.id}
                  className="rounded-md border border-gray-200 bg-white p-2 space-y-2"
                >
                  <Thumbnail
                    src={item.url}
                    alt={item.alt}
                    ratio="4/5"
                    fit="contain"
                    badge={
                      <ThumbnailBadge tone={item.role === "main" ? "green" : "gray"}>
                        {PRODUCT_MEDIA_ROLE_LABELS[item.role]}
                      </ThumbnailBadge>
                    }
                    hoverOverlay={
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={<Eye size={12} strokeWidth={2} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPreviewMedia(item);
                        }}
                      >
                        预览
                      </Button>
                    }
                    onDoubleClick={() => onPreviewMedia(item)}
                    useThumb
                  />
                  <div className="flex items-center gap-1">
                    <Select
                      size="sm"
                      value={item.role}
                      onChange={(e) =>
                        onUpdateMediaRole(
                          item.id,
                          e.target.value as ProductMediaRole,
                        )
                      }
                      className="flex-1"
                    >
                      <option value="main">主图</option>
                      <option value="back">背面</option>
                      <option value="detail">细节</option>
                    </Select>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      icon={<Star size={13} strokeWidth={2} />}
                      aria-label="设为主图"
                      title="设为主图"
                      disabled={item.role === "main"}
                      onClick={() => onUpdateMediaRole(item.id, "main")}
                    />
                    <IconButton
                      size="sm"
                      variant="ghost"
                      icon={<ArrowUp size={13} strokeWidth={2} />}
                      aria-label="上移"
                      title="上移"
                      disabled={idx === 0}
                      onClick={() => onMoveMedia(item.id, -1)}
                    />
                    <IconButton
                      size="sm"
                      variant="ghost"
                      icon={<ArrowDown size={13} strokeWidth={2} />}
                      aria-label="下移"
                      title="下移"
                      disabled={idx === mediaItems.length - 1}
                      onClick={() => onMoveMedia(item.id, 1)}
                    />
                    <IconButton
                      size="sm"
                      variant="danger-outline"
                      icon={<Trash2 size={13} strokeWidth={2} />}
                      aria-label="移除"
                      title="移除"
                      onClick={() => onRemoveMedia(item.id)}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[138px] flex-col items-center justify-center rounded-md border border-dashed border-gray-300 bg-white text-center">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={uploadingMedia}
                  onClick={() => mediaInputRef.current?.click()}
                >
                  上传新文件
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => mediaInputRef.current?.click()}
                >
                  选择现有文件
                </Button>
              </div>
              <div className="mt-3 text-[11px] text-fg-tertiary">
                支持图片，可从历史记录加入产品上架
              </div>
            </div>
          )}
          <input
            ref={mediaInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onUploadLocalMedia(e.target.files);
              e.currentTarget.value = "";
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            loading={uploadingMedia}
            leftIcon={<Upload size={13} strokeWidth={2} />}
            className="absolute right-0 bottom-0 shadow-sm"
            onClick={() => mediaInputRef.current?.click()}
          >
            本地上传
          </Button>
        </div>
      </ShopifySection>

      <ShopifySection>
        <div className="space-y-3">
          <ShopifySectionHeader
            title="类别"
            action={
              <Button size="sm" variant="outline" onClick={autoMatchShopifyCategory}>
                自动匹配
              </Button>
            }
          />
          <ShopifyCategoryPicker
            valueId={form.shopifyCategoryId}
            valueName={form.shopifyCategoryName}
            onChange={(category) =>
              setForm((prev) => ({
                ...prev,
                shopifyCategoryId: category.id,
                shopifyCategoryName: category.name,
              }))
            }
          />
        </div>
      </ShopifySection>

      <ShopifySection>
        <div className="space-y-3">
          <ShopifySectionHeader title="价格" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="售价"
              value={form.price}
              onChange={(e) => update("price", e.target.value)}
              placeholder="$ 0.00"
            />
            <Input
              label="原价"
              value={form.compareAtPrice}
              onChange={(e) => update("compareAtPrice", e.target.value)}
              placeholder="$ 0.00"
            />
          </div>
        </div>
      </ShopifySection>

      <ShopifySection>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <ShopifySectionHeader title="库存" />
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-gray-300" />
              已跟踪库存
            </label>
          </div>
          <div className="max-w-[490px] overflow-hidden rounded-md border border-gray-200">
            <div className="grid grid-cols-[minmax(0,1fr)_96px] bg-gray-50 text-xs font-medium text-fg-secondary">
              <div className="border-r border-gray-200 px-3 py-2">数量</div>
              <div className="px-3 py-2 text-right">数量</div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_96px]">
              <div className="border-r border-gray-200 px-3 py-2 text-sm text-fg-secondary">
                康桥仓
              </div>
              <div className="px-2 py-1.5">
                <Input
                  label=""
                  value={form.inventory}
                  onChange={(e) => update("inventory", e.target.value)}
                  placeholder="0"
                  size="sm"
                />
              </div>
            </div>
          </div>
          <div className="max-w-[490px] rounded-md border border-gray-200 bg-white">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50"
              onClick={() => setSkuExpanded((value) => !value)}
            >
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="rounded bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-700">
                  SKU
                </span>
                <span className="rounded bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-700">
                  条码
                </span>
                <span className="rounded bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-700">
                  缺货时继续销售
                </span>
                <span className="rounded bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-700">
                  关闭
                </span>
              </span>
              <ChevronDown
                size={14}
                className={`text-gray-400 transition-transform ${
                  skuExpanded ? "rotate-180" : ""
                }`}
              />
            </button>
            {skuExpanded ? (
              <div className="border-t border-gray-100 p-3">
                <Input
                  label=""
                  value={form.sku}
                  onChange={(e) => update("sku", e.target.value)}
                  placeholder="款式编码"
                />
              </div>
            ) : null}
          </div>
        </div>
      </ShopifySection>

      <ShopifySection>
        <div className="space-y-3">
          <ShopifySectionHeader
            title="多属性"
            action={
              <div className="flex items-center gap-2">
                {variantRows.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={removeVariantRows}>
                    清空
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openVariantDialog()}
                >
                  + 添加多属性
                </Button>
                {variantRows.length > 0 ? (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    icon={
                      <ChevronDown
                        size={14}
                        className={`transition-transform ${
                          variantSectionCollapsed ? "" : "rotate-180"
                        }`}
                      />
                    }
                    aria-label={variantSectionCollapsed ? "展开多属性" : "收起多属性"}
                    title={variantSectionCollapsed ? "展开多属性" : "收起多属性"}
                    onClick={() => setVariantSectionCollapsed((value) => !value)}
                  />
                ) : null}
              </div>
            }
          />

          {variantRows.length > 0 && !variantSectionCollapsed ? (
            <div className="space-y-3">
              <div className="rounded-md border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-4 py-3">
                  <div className="text-xs font-semibold text-gray-900">
                    {variantOptionName}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {variantRows.map((row) => (
                      <span
                        key={row.id}
                        className="rounded bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-800"
                      >
                        {row.size}
                      </span>
                    ))}
                  </div>
                </div>
                <div ref={variantOptionMenuRef} className="relative">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50"
                    onClick={() => {
                      setVariantOptionSearch("");
                      setVariantOptionMenuOpen((open) => !open);
                    }}
                  >
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[11px]">
                      +
                    </span>
                    添加其他选项
                  </button>
                  {variantOptionMenuOpen ? (
                    <div className="absolute left-8 top-8 z-50 w-64 rounded-xl border border-gray-200 bg-white p-2 text-sm shadow-xl">
                      <div className="relative">
                        <Search
                          size={15}
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                        />
                        <input
                          value={variantOptionSearch}
                          onChange={(e) => setVariantOptionSearch(e.target.value)}
                          autoFocus
                          placeholder="搜索"
                          className="h-9 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                      <div className="px-2 pb-1 pt-3 text-xs font-medium text-gray-500">
                        推荐
                      </div>
                      <div className="space-y-0.5">
                        {filteredVariantOptionRecommendations.map((option) => {
                          const active =
                            normalizeVariantOptionName(option) === variantOptionName;
                          return (
                            <button
                              key={option}
                              type="button"
                              className={`flex h-8 w-full items-center rounded-md px-2 text-left text-sm transition-colors ${
                                active
                                  ? "bg-gray-100 text-gray-950"
                                  : "text-gray-800 hover:bg-gray-50"
                              }`}
                              onClick={() => chooseVariantOption(option)}
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {option}
                              </span>
                            </button>
                          );
                        })}
                        {filteredVariantOptionRecommendations.length === 0 ? (
                          <div className="px-2 py-3 text-xs text-gray-400">
                            没有匹配的推荐选项
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="mt-2 flex h-9 w-full items-center gap-2 border-t border-gray-100 px-2 pt-2 text-left text-sm text-gray-800 hover:text-gray-950"
                        onClick={openCustomVariantOption}
                      >
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-500 text-[11px]">
                          +
                        </span>
                        创建自定义选项
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
                <div>
                  <div className="grid grid-cols-[36px_82px_minmax(0,1fr)_132px_88px] items-center border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-fg-secondary">
                    <div className="flex items-center justify-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300"
                        checked={variantRows.every((row) => row.selected)}
                        onChange={(e) =>
                          setVariantRows((prev) =>
                            prev.map((row) => ({
                              ...row,
                              selected: e.target.checked,
                            })),
                          )
                        }
                      />
                    </div>
                    <div className="col-span-2">多属性</div>
                    <div>价格</div>
                    <div>可用数量</div>
                  </div>
                  {variantRows.map((row) => {
                    const variantImageUrl = selectedMainMedia?.url || row.imageUrl;
                    const variantImageAlt =
                      selectedMainMedia?.alt || row.imageAlt || row.size;
                    return (
                      <div
                        key={row.id}
                        className="grid grid-cols-[36px_82px_minmax(0,1fr)_132px_88px] items-center border-b border-gray-100 px-3 py-3 last:border-b-0"
                      >
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300"
                            checked={row.selected}
                            onChange={(e) =>
                              updateVariantRow(row.id, { selected: e.target.checked })
                            }
                          />
                        </div>
                        <div className="flex items-center justify-center">
                          <div className="flex h-14 w-12 items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                            {variantImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={variantImageUrl}
                                alt={variantImageAlt}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <ImageIcon size={16} className="text-gray-400" />
                            )}
                          </div>
                        </div>
                        <div className="min-w-0 pr-3">
                          <div className="whitespace-normal break-words text-xs font-semibold leading-4 text-gray-900">
                            {row.size}
                          </div>
                        </div>
                        <div className="pr-2">
                          <Input
                            label=""
                            value={row.price}
                            onChange={(e) =>
                              updateVariantRow(row.id, { price: e.target.value })
                            }
                            placeholder="0.00"
                            leftAddon={<span className="text-xs font-medium">$</span>}
                          />
                        </div>
                        <Input
                          label=""
                          value={row.inventory}
                          onChange={(e) =>
                            updateVariantRow(row.id, { inventory: e.target.value })
                          }
                          placeholder="0"
                        />
                      </div>
                    );
                  })}
                  <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-700">
                    康桥仓 的总库存：{totalVariantInventory} 可用
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </ShopifySection>

      <ShopifySection className="border-purple-100 bg-purple-50/30">
        <div className="space-y-3">
          <ShopifySectionHeader
            title="类别 元字段"
            action={
              <Chip tone={filledCategoryMetafields > 0 ? "brand" : "gray"}>
                {filledCategoryMetafields}/{CATEGORY_METAFIELD_ROWS.length}
              </Chip>
            }
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex rounded bg-blue-600 px-1.5 py-0.5 text-xs font-semibold text-white">
              类别 元字段
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-gray-500 shadow-sm ring-1 ring-purple-100">
              {categoryMetafieldContext}
            </span>
          </div>
          <div className="flex items-center justify-end text-[11px] text-gray-500">
            {loadingCategoryMetafields ? (
              <span>正在读取 Shopify 官方选项</span>
            ) : categoryMetafieldLoadError ? (
              <span className="text-amber-600">
                未读取到官方选项：{categoryMetafieldLoadError}
              </span>
            ) : Object.keys(shopifyCategoryMetafields).length ? (
              <span>已映射 Shopify 官方类别元字段</span>
            ) : (
              <span>暂无 Shopify 官方选项</span>
            )}
          </div>
          <div className="space-y-2">
            {CATEGORY_METAFIELD_ROWS.map((row) => (
              <div
                key={row.key}
                className="grid grid-cols-[116px_minmax(0,1fr)] items-center gap-3 text-xs text-gray-700"
              >
                <span className="text-gray-700">{row.label}</span>
                {row.key === "categoryColor" ? (
                  <CategoryColorInput
                    value={form.categoryColor}
                    shopifyOptions={
                      shopifyCategoryMetafields.categoryColor?.options || []
                    }
                    sourceLabel={getCategoryMetafieldSourceLabel(
                      shopifyCategoryMetafields.categoryColor,
                    )}
                    onChange={(value) => update("categoryColor", value)}
                  />
                ) : (
                  <CategoryMetafieldMemoryInput
                    sourceLabel={getCategoryMetafieldSourceLabel(
                      shopifyCategoryMetafields[row.key],
                    )}
                    value={form[row.key]}
                    history={categoryMetafieldMemory[row.key] || []}
                    shopifyOptions={
                      shopifyCategoryMetafields[row.key]?.options || []
                    }
                    ariaLabel={`类别元字段${row.label}`}
                    onChange={(value) => update(row.key, value)}
                    onRemember={(value) =>
                      rememberCategoryMetafieldValue(row.key, value)
                    }
                    onDeleteHistory={(value) =>
                      deleteCategoryMetafieldMemoryValue(row.key, value)
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </ShopifySection>

      <ShopifySection>
        <div className="space-y-3">
          <ShopifySectionHeader title="搜索引擎列表" action={<ExternalLink size={14} />} />
          <p className="text-xs text-fg-secondary">
            添加标题和描述以查看此产品在搜索引擎列表中的显示效果。
          </p>
          <Input
            label="SEO 标题"
            value={form.seoTitle}
            onChange={(e) => update("seoTitle", e.target.value)}
          />
          <Textarea
            label="SEO 描述"
            value={form.seoDescription}
            onChange={(e) => update("seoDescription", e.target.value)}
            rows={3}
          />
        </div>
      </ShopifySection>

      <Dialog
        open={variantDialogOpen}
        onClose={() => setVariantDialogOpen(false)}
        title="添加多属性"
        description="输入选项值，每行一个；也可以导入 txt 或 csv 文件。"
        width="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setVariantDialogOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={parsedVariantSizes.length === 0}
              onClick={confirmVariantRows}
            >
              确认添加
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="选项名称"
            value={form.variantOptionName}
            onChange={(e) => update("variantOptionName", e.target.value)}
            placeholder="Size / Color / Fabric"
          />
          <Textarea
            label="选项值"
            value={variantSizeText}
            onChange={(e) => setVariantSizeText(e.target.value)}
            rows={8}
            placeholder={
              variantOptionName === "Size"
                ? "US 2 / UK 6 / EU 32\nUS 4 / UK 8 / EU 34\nUS 6 / UK 10 / EU 36"
                : `${variantOptionName} 1\n${variantOptionName} 2`
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={variantFileInputRef}
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              className="hidden"
              onChange={(e) => {
                importVariantSizeFile(e.target.files);
                e.currentTarget.value = "";
              }}
            />
            <Button
              variant="outline"
              leftIcon={<Upload size={14} />}
              onClick={() => variantFileInputRef.current?.click()}
            >
              文件输入
            </Button>
            {variantFileName ? (
              <span className="text-xs text-fg-tertiary">{variantFileName}</span>
            ) : null}
            <span className="text-xs text-fg-tertiary">
              已识别 {parsedVariantSizes.length} 个尺码
            </span>
          </div>
          {parsedVariantSizes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 rounded-md border border-gray-200 bg-gray-50 p-3">
              {parsedVariantSizes.map((size) => (
                <span
                  key={size}
                  className="rounded bg-white px-2 py-1 text-[11px] font-medium text-gray-800 shadow-sm"
                >
                  {size}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}

function ShopifySection({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${className}`}
    >
      {children}
    </section>
  );
}

function ShopifySectionHeader({
  title,
  action,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {action ? <div className="shrink-0 text-gray-500">{action}</div> : null}
    </div>
  );
}

function RightPanelRow({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-gray-700">
      <span className="text-gray-500">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function TagBox({
  label,
  tags = [],
  onRemoveTag,
}: {
  label: string;
  tags?: string[];
  onRemoveTag?: (tag: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-gray-700">
        <span>{label}</span>
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[11px] text-gray-600">
          +
        </span>
      </div>
      <div className="min-h-[54px] rounded-md border border-gray-300 bg-white p-2">
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="relative inline-flex items-center rounded bg-gray-200 py-0.5 pl-2 pr-5 text-[11px] font-medium text-gray-700"
            >
              {tag}
              {onRemoveTag ? (
                <button
                  type="button"
                  className="absolute right-1 top-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-gray-500 hover:bg-gray-300 hover:text-gray-800"
                  aria-label={`删除 ${tag}`}
                  onClick={() => onRemoveTag(tag)}
                >
                  <X size={10} />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function TagQuickOptions({
  options,
  activeTags,
  onAdd,
}: {
  options: string[];
  activeTags: string[];
  onAdd: (tag: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {options.map((option) => {
        const active = activeTags.some(
          (tag) => tag.toLowerCase() === option.toLowerCase(),
        );
        return (
          <button
            key={option}
            type="button"
            className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
              active
                ? "border-gray-200 bg-gray-50 text-gray-500"
                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
            }`}
            onClick={() => onAdd(option)}
          >
            <span>{option}</span>
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[11px] text-gray-600">
              +
            </span>
          </button>
        );
      })}
    </div>
  );
}

function getProductStatusOption(status: ProductStatus) {
  return (
    SHOPIFY_PRODUCT_STATUS_OPTIONS.find((option) => option.value === status) ||
    SHOPIFY_PRODUCT_STATUS_OPTIONS[1]
  );
}

function ProductStatusDropdown({
  value,
  onChange,
  disabled = false,
}: {
  value: ProductStatus;
  onChange: (value: ProductStatus) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = getProductStatusOption(value);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 text-left text-sm text-gray-900 transition-colors hover:border-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{selected.label}</span>
        <ChevronDown
          size={14}
          className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {SHOPIFY_PRODUCT_STATUS_OPTIONS.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className={`grid w-full grid-cols-[18px_minmax(0,1fr)] gap-2 px-3 py-2 text-left transition-colors ${
                  active ? "bg-gray-50" : "hover:bg-gray-50"
                }`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="pt-0.5 text-xs text-gray-900">
                  {active ? "✓" : ""}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-gray-500">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SyncPanel({
  form,
  syncState,
  syncAction,
  lastAction,
  shopifyProductUrl,
  warnings,
  onSaveDraft,
  onSync,
  onStatusChange,
  onProductTypeChange,
  onVendorChange,
  onTemplateStyleChange,
  onAddTag,
  onRemoveTag,
  onRemoveCollection,
}: {
  form: ProductForm;
  syncState: SyncState;
  syncAction: SyncAction;
  lastAction: string;
  shopifyProductUrl: string | null;
  warnings: string[];
  onSaveDraft: () => void;
  onSync: () => void;
  onStatusChange: (status: ProductStatus) => void;
  onProductTypeChange: (value: string) => void;
  onVendorChange: (value: string) => void;
  onTemplateStyleChange: (value: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onRemoveCollection: (collection: string) => void;
}) {
  const completed = [
    Boolean(form.title.trim()),
    Boolean(form.description.trim()),
    Boolean(form.productType.trim()),
    Boolean(form.price.trim()),
    Boolean(form.sku.trim()),
  ].filter(Boolean).length;
  const productCollections = splitProductTags(form.collections);
  const productTags = splitProductTags(form.tags);
  const canSaveDraft = Boolean(form.title.trim());
  const canPublish = completed >= 3;

  const status = {
    idle: { label: "未同步", tone: "gray" as const, icon: <Clock size={13} /> },
    draft: { label: "已存草稿", tone: "brand" as const, icon: <Save size={13} /> },
    syncing: { label: "同步中", tone: "warn" as const, icon: <RefreshCw size={13} className="animate-spin" /> },
    synced: { label: "已同步", tone: "success" as const, icon: <CheckCircle2 size={13} /> },
  }[syncState];

  return (
    <aside className="space-y-3 xl:sticky xl:top-4">
      <ShopifySection>
        <div className="space-y-2">
          <ShopifySectionHeader
            title="状态"
            action={<Chip tone={status.tone} icon={status.icon}>{status.label}</Chip>}
          />
          <ProductStatusDropdown
            value={form.status}
            onChange={onStatusChange}
            disabled={syncState === "syncing"}
          />
        </div>
      </ShopifySection>

      <ShopifySection>
        <div className="space-y-3">
          <ShopifySectionHeader title="发布" action={<ExternalLink size={14} />} />
          <RightPanelRow icon={<Store size={14} />} label="所有渠道" />
          <RightPanelRow icon={<Eye size={14} />} label="所有目录" />
          <RightPanelRow icon={<ShoppingBag size={14} />} label="Shopify Catalog" />
        </div>
      </ShopifySection>

      <ShopifySection>
        <div className="space-y-3">
          <ShopifySectionHeader title="销售数据" />
          <div className="space-y-2 text-xs text-fg-secondary">
            <div>此产品近期无销售记录</div>
            <button type="button" className="text-blue-600 hover:text-blue-700">
              查看详细信息
            </button>
          </div>
        </div>
      </ShopifySection>

      <ShopifySection>
        <div className="space-y-3">
          <ShopifySectionHeader
            title={
              <span className="inline-flex items-center gap-1">
                产品组织
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] text-gray-500">
                  i
                </span>
              </span>
            }
          />
          <Input
            label="类型"
            value={form.productType}
            onChange={(event) => onProductTypeChange(event.target.value)}
          />
          <Input
            label="厂商"
            value={form.vendor}
            onChange={(event) => onVendorChange(event.target.value)}
          />
          <TagBox
            label="产品系列"
            tags={productCollections}
            onRemoveTag={onRemoveCollection}
          />
          <TagBox label="标记" tags={productTags} onRemoveTag={onRemoveTag} />
          <TagQuickOptions
            options={PRODUCT_TAG_QUICK_OPTIONS}
            activeTags={productTags}
            onAdd={onAddTag}
          />
        </div>
      </ShopifySection>

      <ShopifySection>
        <div className="space-y-3">
          <ShopifySectionHeader title="模板样式" action={<Eye size={14} />} />
          <Input
            label=""
            value={form.templateStyle}
            placeholder="默认产品"
            onChange={(event) => onTemplateStyleChange(event.target.value)}
          />
        </div>
      </ShopifySection>

      <ShopifySection>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-fg-tertiary">
            <span>必填字段完成度</span>
            <span>{completed}/5</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-gray-900 transition-all"
              style={{ width: `${(completed / 5) * 100}%` }}
            />
          </div>
          <div className="space-y-2 text-xs">
            <CheckRow ok={Boolean(form.title.trim())} label="标题" />
            <CheckRow ok={Boolean(form.description.trim())} label="描述" />
            <CheckRow ok={Boolean(form.productType.trim())} label="类型" />
            <CheckRow ok={Boolean(form.sku.trim())} label="SKU" />
            <CheckRow ok={Boolean(form.price.trim())} label="售价" />
          </div>
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-fg-secondary">
            {lastAction}
          </div>
          {warnings.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 space-y-1">
              {warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}
          {shopifyProductUrl ? (
            <a
              href={shopifyProductUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-900 hover:bg-gray-50 transition-colors"
            >
              <span>打开 Shopify 商品页面</span>
              <ExternalLink size={13} />
            </a>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              leftIcon={<Save size={14} />}
              loading={syncAction === "draft"}
              disabled={!canSaveDraft || syncState === "syncing"}
              onClick={onSaveDraft}
            >
              保存草稿
            </Button>
            <Button
              variant="primary"
              leftIcon={<Send size={14} />}
              loading={syncAction === "publish"}
              disabled={!canPublish || syncState === "syncing"}
              onClick={onSync}
            >
              上架
            </Button>
          </div>
        </div>
      </ShopifySection>
    </aside>
  );
}

function AiField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-tertiary px-3 py-2">
      <div className="text-[11px] text-fg-tertiary">{label}</div>
      <div className="mt-0.5 text-xs text-fg-primary line-clamp-2">{value}</div>
    </div>
  );
}

function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-fg-primary">
      <span className="text-fg-tertiary">{icon}</span>
      {children}
    </div>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-fg-secondary">{label}</span>
      {ok ? (
        <CheckCircle2 size={14} strokeWidth={2.2} className="text-success" />
      ) : (
        <Clock size={14} strokeWidth={2} className="text-fg-tertiary" />
      )}
    </div>
  );
}

function Mapping({ from, to }: { from: string; to: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle px-2.5 py-2">
      <span className="text-fg-secondary">{from}</span>
      <span className="font-medium text-fg-primary">{to}</span>
    </div>
  );
}
