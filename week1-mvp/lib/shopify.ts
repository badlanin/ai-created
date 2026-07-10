import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import { DATA_DIR_PATH, getDb } from "./db";

const SHOPIFY_API_VERSION =
  process.env.SHOPIFY_API_VERSION?.trim() || "2026-04";
const SHOPIFY_TEST_DOMAIN = "test.myshopify.com";
const SHOPIFY_TEST_TOKEN = "shpat_test_buqiqi";
export const SHOPIFY_OAUTH_SCOPES = [
  "read_files",
  "write_files",
  "read_inventory",
  "write_inventory",
  "read_locations",
  "read_metaobject_definitions",
  "write_metaobject_definitions",
  "read_metaobjects",
  "write_metaobjects",
  "read_products",
  "write_products",
  "read_publications",
  "write_publications",
].join(",");

export type ShopifyAuthMode =
  | "access_token"
  | "oauth_app"
  | "client_credentials";

export type ShopifyConnectionRow = {
  id?: number;
  user_id: number;
  device_id?: string;
  shop_domain: string;
  access_token_enc: string;
  auth_mode?: ShopifyAuthMode | null;
  client_id?: string | null;
  token_expires_at?: number | null;
  shop_name: string | null;
  myshopify_domain: string | null;
  primary_domain: string | null;
  is_active?: number | null;
  created_at: number;
  updated_at: number;
  last_tested_at: number | null;
};

export type ShopifyConnectionSafe = {
  bound: true;
  shopDomain: string;
  authMode: ShopifyAuthMode;
  tokenPreview: string;
  clientIdPreview: string | null;
  tokenExpiresAt: number | null;
  shopName: string | null;
  myshopifyDomain: string | null;
  primaryDomain: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastTestedAt: number | null;
};

export type ShopifyConnectionTestResult = {
  shopName: string | null;
  myshopifyDomain: string | null;
  primaryDomain: string | null;
};

export type ShopifyProductDraftInput = {
  title: string;
  description: string;
  sourceType?: string;  // 'url_capture' | 'ai_generated' | 'local_upload'
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  vendor?: string;
  templateStyle?: string;
  templateSuffix?: string;
  collections?: string;
  tags?: string;
  color?: string;
  material?: string;
  neckline?: string;
  silhouette?: string;
  categoryColor?: string;
  categorySize?: string;
  categoryFabric?: string;
  categoryAgeGroup?: string;
  categoryOccasion?: string;
  categoryDressStyle?: string;
  categoryNeckline?: string;
  categoryDressLengthType?: string;
  categorySleeveLengthType?: string;
  categoryTargetGender?: string;
  sku?: string;
  compareAtPrice?: string;
  price?: string;
  inventory?: string;
  taxable?: boolean;
  requiresShipping?: boolean;
  weight?: string;
  weightUnit?: "GRAMS" | "KILOGRAMS" | "OUNCES" | "POUNDS";
  countryCodeOfOrigin?: string;
  harmonizedSystemCode?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  seoTitle?: string;
  seoDescription?: string;
  variantOptionName?: string;
  variantOptionMetafieldKey?: string;
  variantGroupByOptionName?: string;
  publicationIds?: string[];
  productMetafields?: Array<{
    name?: string;
    namespace: string;
    key: string;
    type: string;
    value: string;
  }>;
  optionGroups?: Array<{
    optionName: string;
    optionMetafieldKey?: string;
    values?: string[];
  }>;
  media?: Array<{
    url: string;
    alt?: string;
    role?: "main" | "detail" | "back";
  }>;
  variants?: Array<{
    size: string;
    linkedMetafieldValue?: string;
    sku?: string;
    price?: string;
    inventory?: string;
    imageUrl?: string;
    isMainImage?: boolean;
    optionValues?: Array<{
      optionName: string;
      optionMetafieldKey?: string;
      value: string;
      linkedMetafieldValue?: string;
    }>;
  }>;
};

type ShopifyProductWeightUnit = NonNullable<
  ShopifyProductDraftInput["weightUnit"]
>;

export type ShopifyCategoryMetafieldOption = {
  id: string;
  label: string;
  value: string;
  attributeName: string;
};

export type ShopifyCategoryMetafieldOptionField = {
  formKey: string;
  label: string;
  shopifyName: string | null;
  shopifyKey: string | null;
  shopifyType: string | null;
  source: "store" | "official" | "mixed" | "none";
  options: ShopifyCategoryMetafieldOption[];
};

export type ShopifyCategoryMetafieldOptionsResult = {
  categoryId: string;
  hierarchy: Array<{ id: string; name: string | null }>;
  fields: Record<string, ShopifyCategoryMetafieldOptionField>;
  productDefinitions?: ShopifyProductMetafieldDefinition[];
  warnings: string[];
};

export type ShopifyProductMetafieldDefinition = {
  id: string;
  name: string;
  namespace: string;
  key: string;
  type: string;
};

export type ShopifySalesChannelOption = {
  id: string;
  name: string;
  publicationId: string;
  autoPublish: boolean;
  supportsFuturePublishing: boolean;
  catalogId: string | null;
  catalogTitle: string | null;
  status: string | null;
  disabled?: boolean;
  disabledReason?: string | null;
};

export type ShopifyCatalogOption = {
  id: string;
  title: string;
  status: string | null;
  publicationId: string | null;
};

export type ShopifySellingContextsResult = {
  channels: ShopifySalesChannelOption[];
  catalogs: ShopifyCatalogOption[];
  warnings: string[];
};

export type ShopifyCustomsOption = {
  value: string;
  label: string;
  count: number;
};

export type ShopifyCustomsOptionsResult = {
  countries: ShopifyCustomsOption[];
  hsCodes: [];
  warnings: string[];
};

export type ShopifyProductOrganizationOption = {
  id?: string;
  value: string;
  label: string;
  handle?: string | null;
};

export type ShopifyProductOrganizationOptionsResult = {
  productTypes: ShopifyProductOrganizationOption[];
  vendors: ShopifyProductOrganizationOption[];
  collections: ShopifyProductOrganizationOption[];
  commonTags: ShopifyProductOrganizationOption[];
  tags: ShopifyProductOrganizationOption[];
  templateStyles: ShopifyProductOrganizationOption[];
  warnings: string[];
};

export type ShopifyProductSyncResult = {
  productId: string;
  title: string;
  handle: string | null;
  legacyResourceId: string | null;
  adminUrl: string | null;
  warnings: string[];
};

type ShopifyGraphqlResponse = {
  data?: {
    shop?: {
      name?: string;
      myshopifyDomain?: string;
      primaryDomain?: {
        host?: string;
        url?: string;
      } | null;
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyCountryCodeEnumResponse = {
  data?: {
    __type?: {
      enumValues?: Array<{
        name?: string | null;
        description?: string | null;
        isDeprecated?: boolean | null;
      }> | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyProductMediaNode = {
  id: string;
  status?: string | null;
  image?: { url?: string | null } | null;
};

type ShopifyProductOptionValueNode = {
  id: string;
  name?: string | null;
};

type ShopifyProductOptionNode = {
  id: string;
  name?: string | null;
  optionValues?: ShopifyProductOptionValueNode[] | null;
};

type ShopifyProductCreateResponse = {
  data?: {
    productCreate?: {
      product?: {
        id: string;
        title: string;
        handle?: string | null;
        legacyResourceId?: string | null;
        media?: {
          nodes?: ShopifyProductMediaNode[];
        };
        variants?: {
          nodes?: Array<{
            id: string;
            inventoryItem?: { id: string; sku?: string | null } | null;
          }>;
        };
        options?: ShopifyProductOptionNode[] | null;
      } | null;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyProductOptionsResponse = {
  data?: {
    product?: {
      options?: ShopifyProductOptionNode[] | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyProductOptionUpdateResponse = {
  data?: {
    productOptionUpdate?: {
      userErrors?: Array<{ field?: string[]; message?: string }>;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyStagedUploadsCreateResponse = {
  data?: {
    stagedUploadsCreate?: {
      stagedTargets?: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }>;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyMetafieldDefinitionNode = {
  id: string;
  name?: string | null;
  namespace?: string | null;
  key?: string | null;
  type?: { name?: string | null } | null;
  validations?: Array<{ name?: string | null; value?: string | null }> | null;
};

type ShopifyMetafieldDefinitionsResponse = {
  data?: {
    metafieldDefinitions?: {
      nodes?: ShopifyMetafieldDefinitionNode[];
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyStandardMetafieldDefinitionTemplatesResponse = {
  data?: {
    standardMetafieldDefinitionTemplates?: {
      nodes?: ShopifyMetafieldDefinitionNode[];
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyStandardMetafieldDefinitionEnableResponse = {
  data?: {
    standardMetafieldDefinitionEnable?: {
      createdDefinition?: ShopifyMetafieldDefinitionNode | null;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyMetafieldsSetResponse = {
  data?: {
    metafieldsSet?: {
      metafields?: Array<{
        id?: string | null;
        namespace?: string | null;
        key?: string | null;
        value?: string | null;
      }> | null;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyMetaobjectNode = {
  id: string;
  handle?: string | null;
  displayName?: string | null;
  fields?: Array<{ key?: string | null; value?: string | null }> | null;
};

type ShopifyMetaobjectsResponse = {
  data?: {
    metaobjects?: {
      nodes?: ShopifyMetaobjectNode[];
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyMetaobjectCreateResponse = {
  data?: {
    metaobjectCreate?: {
      metaobject?: {
        id?: string | null;
        displayName?: string | null;
      } | null;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyMetaobjectDefinitionNode = {
  id?: string | null;
  type?: string | null;
  displayNameKey?: string | null;
  fieldDefinitions?: Array<{
    key?: string | null;
    name?: string | null;
    required?: boolean | null;
    type?: { name?: string | null } | null;
  }> | null;
};

type ShopifyMetaobjectDefinitionByTypeResponse = {
  data?: {
    metaobjectDefinitionByType?: ShopifyMetaobjectDefinitionNode | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyPublicationsResponse = {
  data?: {
    publications?: {
      nodes?: Array<{
        id: string;
        name?: string | null;
        autoPublish?: boolean | null;
        supportsFuturePublishing?: boolean | null;
        catalog?: {
          id?: string | null;
          title?: string | null;
          status?: string | null;
        } | null;
      }>;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyCatalogsResponse = {
  data?: {
    catalogs?: {
      nodes?: Array<{
        id: string;
        title?: string | null;
        status?: string | null;
        publication?: {
          id?: string | null;
        } | null;
      }>;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyMetaobjectDefinitionByIdResponse = {
  data?: {
    metaobjectDefinition?: ShopifyMetaobjectDefinitionNode | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyStandardMetaobjectDefinitionEnableResponse = {
  data?: {
    standardMetaobjectDefinitionEnable?: {
      metaobjectDefinition?: ShopifyMetaobjectDefinitionNode | null;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyTaxonomyValueNode = {
  id: string;
  name?: string | null;
};

type ShopifyTaxonomyAttributeNode = {
  __typename?: string | null;
  id?: string | null;
  name?: string | null;
  values?: {
    nodes?: ShopifyTaxonomyValueNode[];
  } | null;
};

type ShopifyTaxonomyCategoryAttributeGroup = {
  id: string;
  name: string | null;
  attributes: ShopifyTaxonomyAttributeNode[];
};

type ShopifyTaxonomyCategoryAttributesResponse = {
  data?: {
    node?: {
      id?: string | null;
      name?: string | null;
      attributes?: {
        nodes?: ShopifyTaxonomyAttributeNode[];
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

export type ShopifyTaxonomyCategoryOption = {
  id: string;
  name: string;
  fullName: string;
  parentId: string | null;
  level: number;
  isRoot: boolean;
  isLeaf: boolean;
  childrenCount: number;
};

export type ShopifyTaxonomyCategoryOptionsResult = {
  categories: ShopifyTaxonomyCategoryOption[];
  warnings: string[];
};

type ShopifyTaxonomyCategoriesResponse = {
  data?: {
    taxonomy?: {
      categories?: {
        nodes?: Array<{
          id: string;
          name?: string | null;
          fullName?: string | null;
          parentId?: string | null;
          level?: number | null;
          isRoot?: boolean | null;
          isLeaf?: boolean | null;
          isArchived?: boolean | null;
          childrenIds?: string[] | null;
        }>;
      };
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyVariantUpdateResponse = {
  data?: {
    productVariantsBulkUpdate?: {
      userErrors?: Array<{ field?: string[]; message?: string }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyPublishablePublishResponse = {
  data?: {
    publishablePublish?: {
      userErrors?: Array<{ field?: string[]; message?: string }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyVariantsBulkCreateResponse = {
  data?: {
    productVariantsBulkCreate?: {
      productVariants?: Array<{
        id: string;
        title?: string | null;
        selectedOptions?: Array<{ name: string; value: string }> | null;
        inventoryItem?: { id: string; sku?: string | null } | null;
      }>;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyLocationsResponse = {
  data?: {
    locations?: {
      nodes?: Array<{
        id: string;
        name?: string | null;
        isActive?: boolean | null;
        shipsInventory?: boolean | null;
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyInventoryItemUpdateResponse = {
  data?: {
    inventoryItemUpdate?: {
      inventoryItem?: {
        id: string;
        tracked?: boolean | null;
      } | null;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyInventorySetQuantitiesResponse = {
  data?: {
    inventorySetQuantities?: {
      inventoryAdjustmentGroup?: {
        createdAt?: string | null;
        reason?: string | null;
      } | null;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyInventoryActivateResponse = {
  data?: {
    inventoryActivate?: {
      inventoryLevel?: {
        id: string;
      } | null;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyProductMediaResponse = {
  data?: {
    product?: {
      media?: {
        nodes?: ShopifyProductMediaNode[];
      };
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyVariantAppendMediaResponse = {
  data?: {
    productVariantAppendMedia?: {
      productVariants?: Array<{
        id: string;
      }>;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifySkuLookupResponse = {
  data?: {
    productVariants?: {
      nodes?: Array<{
        inventoryItem?: { sku?: string | null } | null;
      }>;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type InventorySyncTarget = {
  inventoryItemId: string;
  quantity: number;
  label: string;
};

type VariantMediaSyncTarget = {
  variantId: string;
  mediaIds: string[];
  label: string;
};

type ShopifyMediaInputWithSource = {
  mediaContentType: "IMAGE";
  originalSource: string;
  alt?: string;
  sourceUrl: string;
  filenameKey: string;
};

type ShopifyTaxonomySearchResponse = {
  data?: {
    taxonomy?: {
      categories?: {
        nodes?: Array<{
          id: string;
          name?: string | null;
          fullName?: string | null;
          isArchived?: boolean | null;
        }>;
      };
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyCollectionNode = {
  id: string;
  title?: string | null;
  handle?: string | null;
};

type ShopifyCollectionSearchResponse = {
  data?: {
    collections?: {
      nodes?: ShopifyCollectionNode[];
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyStringConnectionNode = {
  pageInfo?: {
    hasNextPage?: boolean | null;
    endCursor?: string | null;
  } | null;
  edges?: Array<{ node?: string | null }> | null;
  nodes?: Array<string | null> | null;
};

type ShopifyStringConnectionResponse = {
  data?: Record<string, ShopifyStringConnectionNode | null | undefined>;
  errors?: Array<{ message?: string }>;
};

type ShopifyCollectionsResponse = {
  data?: {
    collections?: {
      pageInfo?: {
        hasNextPage?: boolean | null;
        endCursor?: string | null;
      } | null;
      nodes?: ShopifyCollectionNode[];
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyProductsOrganizationResponse = {
  data?: {
    products?: {
      pageInfo?: {
        hasNextPage?: boolean | null;
        endCursor?: string | null;
      } | null;
      nodes?: Array<{
        id?: string | null;
        productType?: string | null;
        vendor?: string | null;
        tags?: string[] | null;
        templateSuffix?: string | null;
        collections?: {
          nodes?: ShopifyCollectionNode[];
        } | null;
      }>;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyThemeRestNode = {
  id?: number | string | null;
  role?: string | null;
  updated_at?: string | null;
};

type ShopifyThemesRestResponse = {
  themes?: ShopifyThemeRestNode[];
  errors?: unknown;
};

type ShopifyThemeAssetRestNode = {
  key?: string | null;
  updated_at?: string | null;
};

type ShopifyThemeAssetsRestResponse = {
  assets?: ShopifyThemeAssetRestNode[];
  errors?: unknown;
};

type ShopifyCollectionCreateResponse = {
  data?: {
    collectionCreate?: {
      collection?: ShopifyCollectionNode | null;
      userErrors?: Array<{ field?: string[]; message?: string }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyClientCredentialsResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type ShopifyOAuthAccessTokenResponse = {
  access_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

const SHOPIFY_UNCATEGORIZED_CATEGORY_ID =
  "gid://shopify/TaxonomyCategory/na";
const SHOPIFY_CATEGORY_METAFIELD_NAMESPACE = "shopify";

const SHOPIFY_CATEGORY_METAFIELD_MAPPINGS = [
  {
    field: "categoryColor",
    label: "颜色",
    keyHints: ["color-pattern", "color"],
    nameHints: ["color", "颜色"],
  },
  {
    field: "categorySize",
    label: "尺寸",
    keyHints: ["size", "clothing-size"],
    nameHints: ["size", "尺寸"],
  },
  {
    field: "categoryFabric",
    label: "织物",
    keyHints: ["fabric", "material"],
    nameHints: ["fabric", "material", "织物", "材质"],
  },
  {
    field: "categoryAgeGroup",
    label: "年龄段",
    keyHints: ["age-group"],
    nameHints: ["age group", "年龄段"],
  },
  {
    field: "categoryOccasion",
    label: "穿着场合",
    keyHints: ["occasion", "dress-occasion"],
    nameHints: ["occasion", "穿着场合", "场合"],
  },
  {
    field: "categoryDressStyle",
    label: "裙子风格",
    keyHints: ["dress-style"],
    nameHints: ["dress style", "style", "裙子风格", "裙型"],
  },
  {
    field: "categoryNeckline",
    label: "领口",
    keyHints: ["neckline"],
    nameHints: ["neckline", "领口"],
  },
  {
    field: "categoryDressLengthType",
    label: "裙子/连衣裙长度类型",
    keyHints: ["skirt-dress-length-type", "dress-length-type"],
    nameHints: [
      "skirt/dress length type",
      "dress length",
      "length",
      "裙子/连衣裙长度类型",
      "裙长",
    ],
  },
  {
    field: "categorySleeveLengthType",
    label: "袖长类型",
    keyHints: ["sleeve-length-type", "sleeve-length"],
    nameHints: ["sleeve length", "袖长类型", "袖长"],
  },
  {
    field: "categoryTargetGender",
    label: "目标性别",
    keyHints: ["target-gender"],
    nameHints: ["target gender", "gender", "目标性别", "性别"],
  },
] as const satisfies ReadonlyArray<{
  field: keyof Pick<
    ShopifyProductDraftInput,
    | "categoryColor"
    | "categorySize"
    | "categoryFabric"
    | "categoryAgeGroup"
    | "categoryOccasion"
    | "categoryDressStyle"
    | "categoryNeckline"
    | "categoryDressLengthType"
    | "categorySleeveLengthType"
    | "categoryTargetGender"
  >;
  label: string;
  keyHints: readonly string[];
  nameHints: readonly string[];
}>;

type ShopifyCategoryMetafieldMapping =
  (typeof SHOPIFY_CATEGORY_METAFIELD_MAPPINGS)[number];

const SHOPIFY_CATEGORY_VALUE_ALIASES: Record<string, string[]> = {
  "海军蓝": ["Navy"],
  "青铜色": ["Bronze"],
  "黑色": ["Black"],
  "金色": ["Gold"],
  "橙色": ["Orange"],
  "白": ["White"],
  "白色": ["White"],
  "紫色": ["Purple"],
  "黄色": ["Yellow"],
  "粉红色": ["Pink"],
  "棕色": ["Brown"],
  "红酒": ["Burgundy", "Red"],
  "灰色": ["Gray"],
  "茶色": ["Beige", "Brown"],
  "绿色": ["Green"],
  "蓝色": ["Blue"],
  "女": ["Women", "Female"],
  "女性": ["Women", "Female"],
  "女士": ["Women", "Female"],
  "成人": ["Adult"],
  "无袖": ["Sleeveless"],
  "及踝": ["Floor-Length"],
  "及地": ["Floor-Length"],
  "荷叶边": ["Ruffle"],
  "甜心领": ["Sweetheart"],
};

const shopifyTaxonomyCategoryAttributesCache = new Map<
  string,
  Promise<ShopifyTaxonomyAttributeNode[]>
>();

function shopifyTokenCacheKeyPart(accessToken: string) {
  return crypto.createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
}

export function normalizeShopDomain(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("店铺域名不能为空");
  const withoutProtocol = raw.replace(/^https?:\/\//i, "");
  const host = withoutProtocol.split(/[/?#]/)[0]?.trim().toLowerCase() || "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(host)) {
    throw new Error("店铺域名需填写 xxx.myshopify.com");
  }
  return host;
}

export function maskToken(token: string): string {
  const value = token.trim();
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `••••••••••••${value.slice(-4)}`;
}

export function maskClientId(clientId: string): string {
  const value = clientId.trim();
  if (!value) return "";
  if (value.length <= 10) return `${value.slice(0, 4)}••••`;
  return `${value.slice(0, 6)}••••${value.slice(-4)}`;
}

export function getShopifyConnection(
  userId: number,
  deviceId: string,
): ShopifyConnectionSafe | null {
  const row = getActiveShopifyConnectionRow(userId, deviceId);
  if (!row) return null;
  return toShopifyConnectionSafe(row);
}

export function getShopifyConnections(
  userId: number,
  deviceId: string,
): ShopifyConnectionSafe[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
         FROM shopify_connections
        WHERE user_id = ? AND device_id = ?
        ORDER BY is_active DESC, updated_at DESC, id DESC`,
    )
    .all(userId, deviceId) as ShopifyConnectionRow[];
  return rows.map(toShopifyConnectionSafe);
}

function getActiveShopifyConnectionRow(
  userId: number,
  deviceId: string,
): ShopifyConnectionRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT *
         FROM shopify_connections
        WHERE user_id = ? AND device_id = ?
        ORDER BY is_active DESC, updated_at DESC, id DESC
        LIMIT 1`,
    )
    .get(userId, deviceId) as ShopifyConnectionRow | undefined;
  return row || null;
}

function toShopifyConnectionSafe(row: ShopifyConnectionRow): ShopifyConnectionSafe {
  const authMode = normalizeAuthMode(row.auth_mode);
  const secret = decryptToken(row.access_token_enc);
  return {
    bound: true,
    shopDomain: row.shop_domain,
    authMode,
    tokenPreview: maskToken(secret),
    clientIdPreview:
      authMode !== "access_token" ? maskClientId(row.client_id || "") : null,
    tokenExpiresAt: row.token_expires_at || null,
    shopName: row.shop_name,
    myshopifyDomain: row.myshopify_domain,
    primaryDomain: row.primary_domain,
    isActive: Boolean(row.is_active ?? 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastTestedAt: row.last_tested_at,
  };
}

export function saveShopifyConnection(opts: {
  userId: number;
  deviceId: string;
  shopDomain: string;
  authMode?: ShopifyAuthMode;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  tokenExpiresAt?: number | null;
  testResult: ShopifyConnectionTestResult;
}) {
  const db = getDb();
  const domain = normalizeShopDomain(opts.shopDomain);
  const authMode = normalizeAuthMode(opts.authMode);
  const clientId = cleanField(opts.clientId);
  const secret = cleanField(opts.accessToken);
  const tokenExpiresAt =
    typeof opts.tokenExpiresAt === "number" && opts.tokenExpiresAt > 0
      ? Math.floor(opts.tokenExpiresAt)
      : null;
  if (authMode === "client_credentials") {
    throw new Error("新版 Dev Dashboard 应用不能用客户端密钥直接绑定，请使用 OAuth 授权安装。");
  }
  if (authMode === "oauth_app" && !clientId) {
    throw new Error("客户端 ID 不能为空");
  }
  if (!secret) {
    throw new Error(
      authMode === "oauth_app"
        ? "Shopify OAuth 未返回 Admin API Access Token"
        : "Admin API Access Token 不能为空",
    );
  }
  const encrypted = encryptToken(secret);
  const save = db.transaction(() => {
    db.prepare(
      `UPDATE shopify_connections
          SET is_active = 0
        WHERE user_id = ? AND device_id = ?`,
    ).run(opts.userId, opts.deviceId);
    db.prepare(
      `INSERT INTO shopify_connections (
         user_id,
         device_id,
         shop_domain,
         access_token_enc,
         auth_mode,
         client_id,
         token_expires_at,
         shop_name,
         myshopify_domain,
         primary_domain,
         is_active,
         created_at,
         updated_at,
         last_tested_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, unixepoch(), unixepoch(), unixepoch())
       ON CONFLICT(user_id, device_id, shop_domain) DO UPDATE SET
         access_token_enc = excluded.access_token_enc,
         auth_mode = excluded.auth_mode,
         client_id = excluded.client_id,
         token_expires_at = excluded.token_expires_at,
         shop_name = excluded.shop_name,
         myshopify_domain = excluded.myshopify_domain,
         primary_domain = excluded.primary_domain,
         is_active = 1,
         updated_at = unixepoch(),
         last_tested_at = unixepoch()`,
    ).run(
      opts.userId,
      opts.deviceId,
      domain,
      encrypted,
      authMode,
      authMode === "oauth_app" ? clientId : null,
      tokenExpiresAt,
      opts.testResult.shopName,
      opts.testResult.myshopifyDomain,
      opts.testResult.primaryDomain,
    );
  });
  save();
}

export function selectShopifyConnection(
  userId: number,
  deviceId: string,
  shopDomain: string,
) {
  const db = getDb();
  const domain = normalizeShopDomain(shopDomain);
  const row = db
    .prepare(
      `SELECT id
         FROM shopify_connections
        WHERE user_id = ? AND device_id = ? AND shop_domain = ?`,
    )
    .get(userId, deviceId, domain) as { id: number } | undefined;
  if (!row) throw new Error("未找到这个 Shopify 店铺绑定");
  const select = db.transaction(() => {
    db.prepare(
      `UPDATE shopify_connections
          SET is_active = 0
        WHERE user_id = ? AND device_id = ?`,
    ).run(userId, deviceId);
    db.prepare(
      `UPDATE shopify_connections
          SET is_active = 1,
              updated_at = unixepoch()
        WHERE id = ?`,
    ).run(row.id);
  });
  select();
}

export function deleteShopifyConnection(
  userId: number,
  deviceId: string,
  shopDomain?: string,
) {
  const db = getDb();
  const domain = shopDomain ? normalizeShopDomain(shopDomain) : null;
  if (domain) {
    db.prepare(
      `DELETE FROM shopify_connections
        WHERE user_id = ? AND device_id = ? AND shop_domain = ?`,
    ).run(userId, deviceId, domain);
  } else {
    db.prepare(
      `DELETE FROM shopify_connections
        WHERE id = (
          SELECT id
            FROM shopify_connections
           WHERE user_id = ? AND device_id = ?
           ORDER BY is_active DESC, updated_at DESC, id DESC
           LIMIT 1
        )`,
    ).run(userId, deviceId);
  }
  ensureActiveShopifyConnection(userId, deviceId);
}

function ensureActiveShopifyConnection(userId: number, deviceId: string) {
  const db = getDb();
  const active = db
    .prepare(
      `SELECT id
         FROM shopify_connections
        WHERE user_id = ? AND device_id = ? AND is_active = 1
        LIMIT 1`,
    )
    .get(userId, deviceId) as { id: number } | undefined;
  if (active) return;
  db.prepare(
    `UPDATE shopify_connections
        SET is_active = 1
      WHERE id = (
        SELECT id
          FROM shopify_connections
         WHERE user_id = ? AND device_id = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 1
      )`,
  ).run(userId, deviceId);
}

export function updateShopifyLastTested(
  userId: number,
  deviceId: string,
  testResult: ShopifyConnectionTestResult,
) {
  const db = getDb();
  db.prepare(
    `UPDATE shopify_connections
     SET shop_name = ?,
         myshopify_domain = ?,
         primary_domain = ?,
         last_tested_at = unixepoch(),
         updated_at = unixepoch()
     WHERE user_id = ? AND device_id = ? AND is_active = 1`,
  ).run(
    testResult.shopName,
    testResult.myshopifyDomain,
    testResult.primaryDomain,
    userId,
    deviceId,
  );
}

export function getStoredShopifyToken(userId: number, deviceId: string): {
  shopDomain: string;
  accessToken: string;
} | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT shop_domain, access_token_enc
         FROM shopify_connections
        WHERE user_id = ? AND device_id = ?
        ORDER BY is_active DESC, updated_at DESC, id DESC
        LIMIT 1`,
    )
    .get(userId, deviceId) as
    | { shop_domain: string; access_token_enc: string }
    | undefined;
  if (!row) return null;
  return {
    shopDomain: row.shop_domain,
    accessToken: decryptToken(row.access_token_enc),
  };
}

export async function getStoredShopifyAccessToken(
  userId: number,
  deviceId: string,
  shopDomain?: string,
): Promise<{
  shopDomain: string;
  accessToken: string;
} | null> {
  const db = getDb();
  const requestedDomain = shopDomain ? normalizeShopDomain(shopDomain) : null;
  const row = db
    .prepare(
      `SELECT shop_domain, access_token_enc, auth_mode, client_id
         FROM shopify_connections
        WHERE user_id = ? AND device_id = ?
          AND (? IS NULL OR shop_domain = ?)
        ORDER BY is_active DESC, updated_at DESC, id DESC
        LIMIT 1`,
    )
    .get(userId, deviceId, requestedDomain, requestedDomain) as
    | {
        shop_domain: string;
        access_token_enc: string;
        auth_mode?: ShopifyAuthMode | null;
        client_id?: string | null;
      }
    | undefined;
  if (!row) return null;

  const domain = normalizeShopDomain(row.shop_domain);
  const secret = decryptToken(row.access_token_enc);
  if (normalizeAuthMode(row.auth_mode) === "client_credentials") {
    throw new Error("旧的客户端密钥直连方式不可用，请解除绑定后重新走 Shopify OAuth 授权。");
  }

  return {
    shopDomain: domain,
    accessToken: secret,
  };
}

function normalizeAuthMode(value?: string | null): ShopifyAuthMode {
  if (value === "oauth_app") return "oauth_app";
  if (value === "client_credentials") return "client_credentials";
  return "access_token";
}

async function createClientCredentialsAccessToken(opts: {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ accessToken: string; expiresIn: number | null }> {
  const domain = normalizeShopDomain(opts.shopDomain);
  const clientId = cleanField(opts.clientId);
  const clientSecret = cleanField(opts.clientSecret);
  if (!clientId) throw new Error("客户端 ID 不能为空");
  if (!clientSecret) throw new Error("客户端密钥不能为空");

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  const response = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let json: ShopifyClientCredentialsResponse | null = null;
  try {
    json = text ? (JSON.parse(text) as ShopifyClientCredentialsResponse) : null;
  } catch {
    json = null;
  }

  if (!response.ok || !json?.access_token) {
    let message =
      json?.error_description ||
      json?.error ||
      text.slice(0, 300) ||
      response.statusText;
    if (looksLikeHtml(text)) {
      message =
        "Shopify 返回了网页而不是 token。请确认店铺域名是 Shopify 后台“设置 > 域名”里的原始 *.myshopify.com 域名，不是 www 自定义域名。";
    }
    throw new Error(`Shopify client_credentials 换取 token 失败：HTTP ${response.status} ${message}`);
  }

  return {
    accessToken: json.access_token,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : null,
  };
}

export async function exchangeShopifyClientCredentialsToken(opts: {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ accessToken: string; expiresIn: number | null }> {
  return createClientCredentialsAccessToken(opts);
}

export function buildShopifyOAuthAuthorizeUrl(opts: {
  shopDomain: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string;
}): string {
  const domain = normalizeShopDomain(opts.shopDomain);
  const clientId = cleanField(opts.clientId);
  const redirectUri = cleanField(opts.redirectUri);
  const state = cleanField(opts.state);
  if (!clientId) throw new Error("客户端 ID 不能为空");
  if (!redirectUri) throw new Error("OAuth 回调地址不能为空");
  if (!state) throw new Error("OAuth state 不能为空");

  const url = new URL(`https://${domain}/admin/oauth/authorize`);
  url.searchParams.set("client_id", clientId);
  // Shopify managed installation stores required scopes in the app config.
  if (opts.scopes) {
    url.searchParams.set("scope", opts.scopes);
  }
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export function verifyShopifyOAuthHmac(
  searchParams: URLSearchParams,
  clientSecret: string,
): boolean {
  const receivedHmac = searchParams.get("hmac") || "";
  const secret = cleanField(clientSecret);
  if (!receivedHmac || !secret) return false;

  const params = new URLSearchParams(searchParams);
  params.delete("hmac");
  params.delete("signature");
  params.sort();
  const message = params.toString();

  const generatedHmac = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");
  const received = Buffer.from(receivedHmac, "hex");
  const generated = Buffer.from(generatedHmac, "hex");
  return (
    received.length === generated.length &&
    crypto.timingSafeEqual(received, generated)
  );
}

export async function exchangeShopifyOAuthCode(opts: {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  code: string;
}): Promise<{ accessToken: string; scope: string | null }> {
  const domain = normalizeShopDomain(opts.shopDomain);
  const clientId = cleanField(opts.clientId);
  const clientSecret = cleanField(opts.clientSecret);
  const code = cleanField(opts.code);
  if (!clientId) throw new Error("客户端 ID 不能为空");
  if (!clientSecret) throw new Error("客户端密钥不能为空");
  if (!code) throw new Error("Shopify OAuth code 为空");

  const response = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  let json: ShopifyOAuthAccessTokenResponse | null = null;
  try {
    json = text ? (JSON.parse(text) as ShopifyOAuthAccessTokenResponse) : null;
  } catch {
    json = null;
  }

  if (!response.ok || !json?.access_token) {
    let message =
      json?.error_description ||
      json?.error ||
      text.slice(0, 300) ||
      response.statusText;
    if (looksLikeHtml(text)) {
      message =
        "Shopify 返回了网页而不是 token。请确认店铺域名是 Shopify 后台“设置 > 域名”里的原始 *.myshopify.com 域名，不是 www 自定义域名。";
    }
    throw new Error(
      `Shopify OAuth 换取访问令牌失败：HTTP ${response.status} ${message}`,
    );
  }

  return {
    accessToken: json.access_token,
    scope: json.scope || null,
  };
}

function looksLikeHtml(value: string): boolean {
  return /^\s*<!doctype html/i.test(value) || /^\s*<html/i.test(value);
}

export async function testShopifyConnection(opts: {
  shopDomain: string;
  authMode?: ShopifyAuthMode;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
}): Promise<ShopifyConnectionTestResult> {
  const domain = normalizeShopDomain(opts.shopDomain);
  const authMode = normalizeAuthMode(opts.authMode);
  if (authMode === "client_credentials") {
    throw new Error("新版 Dev Dashboard 应用需要 OAuth 授权安装，不能只用客户端 ID 和密钥测试连接。");
  }
  const token = cleanField(opts.accessToken);
  if (!token) throw new Error("Admin API Access Token 不能为空");

  if (isTestShopifyCredentials(domain, token)) {
    return {
      shopName: "BUQIQI 测试店铺",
      myshopifyDomain: SHOPIFY_TEST_DOMAIN,
      primaryDomain: "preview.buqiqi.test",
    };
  }

  const endpoint = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({
      query: `query ShopifyConnectionTest {
        shop {
          name
          myshopifyDomain
          primaryDomain {
            host
            url
          }
        }
      }`,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();
  let json: ShopifyGraphqlResponse | null = null;
  try {
    json = text ? (JSON.parse(text) as ShopifyGraphqlResponse) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Shopify 鉴权失败，请检查店铺域名和 Admin API Access Token。");
    }
    if (looksLikeHtml(text)) {
      throw new Error(
        "Shopify 返回了网页而不是 Admin API JSON。请确认店铺域名是后台“设置 > 域名”里的原始 *.myshopify.com 域名。",
      );
    }
    throw new Error(`Shopify 连接失败：HTTP ${response.status} ${text.slice(0, 300)}`);
  }

  if (json?.errors?.length) {
    throw new Error(
      `Shopify 返回错误：${json.errors
        .map((err) => err.message)
        .filter(Boolean)
        .join("；")}`,
    );
  }

  const shop = json?.data?.shop;
  if (!shop) throw new Error("Shopify 未返回店铺信息，请检查 Token 权限。");

  return {
    shopName: shop.name || null,
    myshopifyDomain: shop.myshopifyDomain || null,
    primaryDomain: shop.primaryDomain?.host || shop.primaryDomain?.url || null,
  };
}

function normalizeShopifyProductStatus(
  status?: ShopifyProductDraftInput["status"],
): "DRAFT" | "ACTIVE" | "ARCHIVED" {
  if (status === "ACTIVE" || status === "ARCHIVED") return status;
  return "DRAFT";
}

function normalizeShopifyTemplateSuffix(value?: string): string {
  const cleaned = cleanField(value);
  if (!cleaned) return "";
  if (/^(默认|默认产品|默认模板|default|default product)$/i.test(cleaned)) {
    return "";
  }
  // 只移除 "product." 或 "product-" 前缀，但保留单独的 "product"
  if (cleaned.toLowerCase() === "product") return "";
  return cleaned.replace(/^product[.-]/i, "").trim();
}

type ShopifyVariantDraft = NonNullable<ShopifyProductDraftInput["variants"]>[number];

type NormalizedVariantOptionValue = {
  optionName: string;
  optionMetafieldKey: string;
  value: string;
  linkedMetafieldValue: string;
};

type NormalizedProductVariantDraft = {
  size: string;
  sku: string;
  price: string;
  inventory: string;
  imageUrl: string;
  optionValues: NormalizedVariantOptionValue[];
};

type NormalizedProductOptionDraft = {
  optionName: string;
  optionMetafieldKey: string;
  values: string[];
  linkedMetafield: { namespace: string; key: string; values: string[] } | null;
  linkedValueByValue: Map<string, string>;
};

function normalizedVariantOptionsKey(
  values: Array<{ optionName?: string; name?: string; value?: string }> | null | undefined,
) {
  return (values || [])
    .map((item) => ({
      name: cleanField(item.optionName || item.name).toLowerCase(),
      value: cleanField(item.value).toLowerCase(),
    }))
    .filter((item) => item.name && item.value)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => `${item.name}:${item.value}`)
    .join("|");
}

function findShopifyCategoryMetafieldMappingByField(field?: string) {
  const normalized = cleanField(field);
  if (!normalized) return null;
  return (
    SHOPIFY_CATEGORY_METAFIELD_MAPPINGS.find(
      (mapping) => mapping.field === normalized,
    ) || null
  );
}

function findShopifyCategoryMetafieldMappingByShopifyKey(key?: string) {
  const normalized = cleanField(key).toLowerCase();
  if (!normalized) return null;
  return (
    SHOPIFY_CATEGORY_METAFIELD_MAPPINGS.find((mapping) =>
      mapping.keyHints.some((hint) => cleanField(hint).toLowerCase() === normalized),
    ) || null
  );
}

function buildVariantOptionLinkedMetafieldInput(
  input: ShopifyProductDraftInput,
  variants: ShopifyVariantDraft[],
  warnings: string[],
): { namespace: string; key: string; values: string[] } | null {
  const mapping = findShopifyCategoryMetafieldMappingByField(
    input.variantOptionMetafieldKey,
  );
  if (!mapping) return null;

  const key = cleanField(mapping.keyHints[0]);
  if (!key) return null;

  const missingLinkedValues = variants.some(
    (variant) => cleanField(variant.size) && !cleanField(variant.linkedMetafieldValue),
  );
  if (missingLinkedValues) {
    warnings.push(
      "已跳过多属性选项与 Shopify 类别元字段的关联：部分选项值不是 Shopify 标准元字段值。",
    );
    return null;
  }

  const values = Array.from(
    new Set(
      variants
        .map((variant) => cleanField(variant.linkedMetafieldValue))
        .filter(Boolean),
    ),
  );
  if (!values.length) return null;

  warnings.push(`已将多属性选项关联到 Shopify 类别元字段：shopify.${key}`);
  return {
    namespace: SHOPIFY_CATEGORY_METAFIELD_NAMESPACE,
    key,
    values,
  };
}

function buildProductOptionDrafts(
  input: ShopifyProductDraftInput,
  variants: NormalizedProductVariantDraft[],
  warnings: string[],
): NormalizedProductOptionDraft[] {
  const fallbackOptionName =
    cleanField(input.variantGroupByOptionName) ||
    cleanField(input.variantOptionName) ||
    "Size";
  const fallbackOptionMetafieldKey = cleanField(input.variantOptionMetafieldKey);
  const groups = new Map<
    string,
    { optionName: string; optionMetafieldKey: string; values: string[] }
  >();

  const ensureGroup = (optionName: string, optionMetafieldKey = "") => {
    const name = cleanField(optionName) || fallbackOptionName;
    const key = name.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      if (!existing.optionMetafieldKey && optionMetafieldKey) {
        existing.optionMetafieldKey = optionMetafieldKey;
      }
      return existing;
    }
    const group = {
      optionName: name,
      optionMetafieldKey: cleanField(optionMetafieldKey),
      values: [] as string[],
    };
    groups.set(key, group);
    return group;
  };
  const addValue = (
    optionName: string,
    value: string,
    optionMetafieldKey = "",
  ) => {
    const cleanedValue = cleanField(value);
    if (!cleanedValue) return;
    const group = ensureGroup(optionName, optionMetafieldKey);
    if (
      !group.values.some(
        (item) => item.toLowerCase() === cleanedValue.toLowerCase(),
      )
    ) {
      group.values.push(cleanedValue);
    }
  };

  for (const group of input.optionGroups || []) {
    const optionName = cleanField(group.optionName);
    if (!optionName) continue;
    ensureGroup(optionName, cleanField(group.optionMetafieldKey));
  }

  const firstVariant = variants[0];
  for (const option of firstVariant?.optionValues || []) {
    addValue(option.optionName, option.value, option.optionMetafieldKey);
  }

  for (const variant of variants) {
    if (variant.optionValues.length) {
      for (const option of variant.optionValues) {
        addValue(option.optionName, option.value, option.optionMetafieldKey);
      }
    } else {
      addValue(fallbackOptionName, variant.size, fallbackOptionMetafieldKey);
    }
  }

  if (!groups.size && variants.length) {
    for (const variant of variants) {
      addValue(fallbackOptionName, variant.size, fallbackOptionMetafieldKey);
    }
  }

  return Array.from(groups.values())
    .filter((group) => group.optionName && group.values.length)
    .map((group) => {
      const linkedValueByValue = buildLinkedValueMapForOption(
        group.optionName,
        variants,
      );
      const linkedMetafield = buildOptionLinkedMetafieldInput(
        group.optionName,
        group.optionMetafieldKey,
        group.values,
        linkedValueByValue,
        warnings,
      );
      return {
        ...group,
        linkedMetafield,
        linkedValueByValue,
      };
    });
}

function buildLinkedValueMapForOption(
  optionName: string,
  variants: NormalizedProductVariantDraft[],
) {
  const target = cleanField(optionName).toLowerCase();
  const result = new Map<string, string>();
  for (const variant of variants) {
    const option = variant.optionValues.find(
      (item) => cleanField(item.optionName).toLowerCase() === target,
    );
    if (!option?.value || !option.linkedMetafieldValue) continue;
    result.set(option.value.toLowerCase(), option.linkedMetafieldValue);
  }
  return result;
}

function buildOptionLinkedMetafieldInput(
  optionName: string,
  optionMetafieldKey: string,
  values: string[],
  linkedValueByValue: Map<string, string>,
  warnings: string[],
): { namespace: string; key: string; values: string[] } | null {
  const mapping = findShopifyCategoryMetafieldMappingByField(optionMetafieldKey);
  if (!mapping) return null;

  const key = cleanField(mapping.keyHints[0]);
  if (!key) return null;

  const missing = values.some(
    (value) => !linkedValueByValue.get(value.toLowerCase()),
  );
  if (missing) {
    warnings.push(
      `已跳过多属性「${optionName}」与 Shopify 类别元字段的关联：部分选项值不是 Shopify 标准元字段值。`,
    );
    return null;
  }

  const linkedValues = Array.from(
    new Set(
      values
        .map((value) => cleanField(linkedValueByValue.get(value.toLowerCase())))
        .filter(Boolean),
    ),
  );
  if (!linkedValues.length) return null;

  warnings.push(`已将多属性「${optionName}」关联到 Shopify 类别元字段：shopify.${key}`);
  return {
    namespace: SHOPIFY_CATEGORY_METAFIELD_NAMESPACE,
    key,
    values: linkedValues,
  };
}

function buildVariantOptionCreateValueInput(
  variant: ShopifyVariantDraft,
  linkedMetafield: { namespace: string; key: string; values: string[] } | null,
) {
  const name = cleanField(variant.size);
  const linkedMetafieldValue = cleanField(variant.linkedMetafieldValue);
  return {
    name,
    ...(linkedMetafield && linkedMetafieldValue
      ? { linkedMetafieldValue }
      : {}),
  };
}

function buildVariantOptionValueInput(
  optionName: string,
  variant: ShopifyVariantDraft,
  linkedMetafield: { namespace: string; key: string; values: string[] } | null,
) {
  const name = cleanField(variant.size);
  const linkedMetafieldValue = cleanField(variant.linkedMetafieldValue);
  return {
    optionName,
    name,
    ...(linkedMetafield && linkedMetafieldValue
      ? { linkedMetafieldValue }
      : {}),
  };
}

function buildProductOptionCreateValueInput(
  option: NormalizedProductOptionDraft,
  value: string,
) {
  const name = cleanField(value);
  return { name };
}

function buildVariantOptionValueInputForSelection(
  selection: NormalizedVariantOptionValue,
  optionByName: Map<string, NormalizedProductOptionDraft>,
  useLinkedMetafieldValues = false,
) {
  const optionName = cleanField(selection.optionName);
  const option = optionByName.get(optionName.toLowerCase());
  const linkedMetafieldValue = cleanField(selection.linkedMetafieldValue);
  const base = {
    optionName,
  };
  if (useLinkedMetafieldValues && option?.linkedMetafield && linkedMetafieldValue) {
    return {
      ...base,
      linkedMetafieldValue,
    };
  }
  return {
    ...base,
    name: cleanField(selection.value),
  };
}

function buildVariantOptionValueInputsForVariant(
  variant: NormalizedProductVariantDraft,
  productOptions: NormalizedProductOptionDraft[],
  opts: { useLinkedMetafieldValues?: boolean } = {},
) {
  const optionByName = new Map(
    productOptions.map((option) => [option.optionName.toLowerCase(), option]),
  );
  return productOptions
    .map((option, index) => {
      const selection =
        variant.optionValues.find(
          (item) =>
            cleanField(item.optionName).toLowerCase() ===
            option.optionName.toLowerCase(),
        ) ||
        (productOptions.length === 1
          ? {
              optionName: option.optionName,
              optionMetafieldKey: option.optionMetafieldKey,
              value: variant.size,
              linkedMetafieldValue: variant.optionValues[0]?.linkedMetafieldValue || "",
            }
          : {
              optionName: option.optionName,
              optionMetafieldKey: option.optionMetafieldKey,
              value: option.values[index] || option.values[0] || "",
              linkedMetafieldValue: "",
            });
      return buildVariantOptionValueInputForSelection(
        selection,
        optionByName,
        Boolean(opts.useLinkedMetafieldValues),
      );
    })
    .filter(
      (item) =>
        item.optionName &&
        ("linkedMetafieldValue" in item ? item.linkedMetafieldValue : item.name),
    );
}

export async function getShopifyCategoryMetafieldOptions(
  userId: number,
  deviceId: string,
  categoryId: string,
  shopDomain?: string,
): Promise<ShopifyCategoryMetafieldOptionsResult> {
  const cleanedCategoryId = cleanField(categoryId);
  if (
    !cleanedCategoryId ||
    cleanedCategoryId === SHOPIFY_UNCATEGORIZED_CATEGORY_ID ||
    !isShopifyTaxonomyCategoryId(cleanedCategoryId)
  ) {
    return {
      categoryId: cleanedCategoryId || SHOPIFY_UNCATEGORIZED_CATEGORY_ID,
      hierarchy: [],
      fields: {},
      warnings: [],
    };
  }

  const stored = await getStoredShopifyAccessToken(userId, deviceId, shopDomain);
  if (!stored) throw new Error("尚未绑定 Shopify");

  const warnings: string[] = [];
  if (isTestShopifyCredentials(stored.shopDomain, stored.accessToken)) {
    return buildFallbackShopifyCategoryMetafieldOptions(cleanedCategoryId);
  }

  const customDefinitionsPromise = fetchShopifyProductCustomMetafieldDefinitions(
    stored.shopDomain,
    stored.accessToken,
    warnings,
  ).catch((err) => {
    warnings.push(
      `读取 Shopify 产品自定义元字段失败：${err instanceof Error ? err.message : String(err)}`,
    );
    return [] as ShopifyMetafieldDefinitionNode[];
  });
  const [definitions, templates, customDefinitions, attributeGroups] = await Promise.all([
    fetchShopifyCategoryMetafieldDefinitionsForHierarchy(
      stored.shopDomain,
      stored.accessToken,
      cleanedCategoryId,
      warnings,
    ),
    fetchShopifyCategoryMetafieldDefinitionTemplatesForHierarchy(
      stored.shopDomain,
      stored.accessToken,
      cleanedCategoryId,
      warnings,
    ),
    customDefinitionsPromise,
    fetchShopifyTaxonomyCategoryAttributeGroupsForHierarchy(
      stored.shopDomain,
      stored.accessToken,
      cleanedCategoryId,
      warnings,
    ),
  ]);

  const effectiveDefinitions = dedupeShopifyMetafieldDefinitions([
    ...definitions,
    ...templates,
  ]);
  const attributes = dedupeShopifyTaxonomyAttributes(
    attributeGroups.flatMap((group) => group.attributes),
  );
  const fields: Record<string, ShopifyCategoryMetafieldOptionField> = {};

  const fieldEntries = await mapWithConcurrency(
    [...SHOPIFY_CATEGORY_METAFIELD_MAPPINGS],
    4,
    async (mapping) => {
    const definition = findShopifyCategoryMetafieldDefinition(
      effectiveDefinitions,
      mapping,
    );
    const customMatches = findShopifyCustomMetafieldDefinitions(
      customDefinitions,
      mapping,
    );
    const matchedAttributes = findShopifyTaxonomyAttributesForMapping(
      attributes,
      mapping,
      definition,
    );
      const storeDefinitionOptions = definition
        ? await buildShopifyMetafieldDefinitionStoreOptions(
            stored.shopDomain,
            stored.accessToken,
            definition,
            warnings,
          )
        : [];
      const customOptions = (
        await mapWithConcurrency(customMatches, 3, (customDefinition) =>
          buildShopifyMetafieldDefinitionStoreOptions(
            stored.shopDomain,
            stored.accessToken,
            customDefinition,
            warnings,
          ),
        )
      ).flat();
      const storeOptions = mergeShopifyCategoryMetafieldOptions([
        ...storeDefinitionOptions,
        ...customOptions,
      ]);
      const officialOptions =
        buildShopifyCategoryMetafieldValueOptions(matchedAttributes);
      const options = mergeShopifyCategoryMetafieldOptions([
        ...storeOptions,
        ...officialOptions,
      ]);
      const source: ShopifyCategoryMetafieldOptionField["source"] =
        storeOptions.length && officialOptions.length
          ? "mixed"
          : storeOptions.length
            ? "store"
            : officialOptions.length
              ? "official"
              : "none";
      if (!definition && !customMatches.length && !options.length) return null;
      return {
        key: mapping.field,
        field: {
          formKey: mapping.field,
          label: mapping.label,
          shopifyName:
            cleanField(customMatches[0]?.name) ||
            cleanField(definition?.name) ||
            cleanField(matchedAttributes[0]?.name) ||
            null,
          shopifyKey:
            cleanField(customMatches[0]?.key) || cleanField(definition?.key) || null,
          shopifyType:
            cleanField(customMatches[0]?.type?.name) ||
            cleanField(definition?.type?.name) ||
            null,
          source,
          options,
        },
      };
    },
  );

  for (const entry of fieldEntries) {
    if (entry) fields[entry.key] = entry.field;
  }

  return {
    categoryId: cleanedCategoryId,
    hierarchy: attributeGroups.map((group) => ({
      id: group.id,
      name: group.name,
    })),
    fields,
    productDefinitions: customDefinitions
      .map((definition) => ({
        id: cleanField(definition.id),
        name: cleanField(definition.name) || cleanField(definition.key),
        namespace: cleanField(definition.namespace),
        key: cleanField(definition.key),
        type: cleanField(definition.type?.name) || "single_line_text_field",
      }))
      .filter(
        (definition) =>
          definition.id &&
          definition.name &&
          definition.namespace &&
          definition.key,
      ),
    warnings,
  };
}

function normalizeShopifySalesChannelDisplayName(name: string) {
  const normalized = name.trim().toLowerCase();
  if (normalized === "online store") return "在线商店";
  if (normalized === "point of sale" || normalized === "pos") return "POS";
  return name;
}

function getShopifySalesChannelSortOrder(name: string) {
  const normalized = name.trim().toLowerCase();
  if (normalized === "在线商店" || normalized === "online store") return 10;
  if (normalized === "inbox") return 20;
  if (normalized === "pinterest") return 30;
  if (normalized === "pos" || normalized === "point of sale") return 90;
  return 50;
}

function isUnsupportedShopifyVariantPublicationChannel(name: string) {
  const normalized = name.trim().toLowerCase();
  return normalized === "pos" || normalized === "point of sale";
}

function isShopifyInternalChannelCatalogTitle(title: string) {
  return /^channel catalog(?:\s+\d+)?$/i.test(title.trim());
}

export async function getShopifySellingContexts(
  userId: number,
  deviceId: string,
): Promise<ShopifySellingContextsResult> {
  const stored = await getStoredShopifyAccessToken(userId, deviceId);
  if (!stored) throw new Error("尚未绑定 Shopify");

  if (isTestShopifyCredentials(stored.shopDomain, stored.accessToken)) {
    return {
      channels: [],
      catalogs: [],
      warnings: ["当前使用测试密钥，销售渠道和目录需要真实店铺读取。"],
    };
  }

  const warnings: string[] = [];
  const channels: ShopifySalesChannelOption[] = [];
  const catalogs: ShopifyCatalogOption[] = [];

  const publicationsJson = await shopifyGraphql<ShopifyPublicationsResponse>(
    stored.shopDomain,
    stored.accessToken,
    `query BuqiqiShopifyPublications {
      publications(first: 50) {
        nodes {
          id
          name
          autoPublish
          supportsFuturePublishing
          catalog {
            id
            title
            status
          }
        }
      }
    }`,
  );
  const publicationErrors = formatGraphqlMessages(publicationsJson.errors);
  if (publicationErrors) {
    warnings.push(
      `读取 Shopify 销售渠道失败：${publicationErrors}。如使用 OAuth，请确认应用权限包含 read_publications/write_publications 并重新授权。`,
    );
  } else {
    const seenChannels = new Set<string>();
    for (const publication of publicationsJson.data?.publications?.nodes || []) {
      const catalogId = cleanField(publication.catalog?.id) || null;
      const catalogTitle = cleanField(publication.catalog?.title) || null;
      const status = cleanField(publication.catalog?.status) || null;
      const publicationId = cleanField(publication.id);
      const channelNodes = publicationId
        ? [
            {
              id: publicationId,
              name: cleanField(publication.name) || catalogTitle || "",
            },
          ]
        : [];

      if (!channelNodes.length && publicationId) {
        const key = `publication:${publicationId}`;
        if (seenChannels.has(key)) continue;
        seenChannels.add(key);
        const rawName = catalogTitle || "未命名销售渠道";
        const disabled = isUnsupportedShopifyVariantPublicationChannel(rawName);
        channels.push({
          id: publicationId,
          name: normalizeShopifySalesChannelDisplayName(rawName),
          publicationId,
          autoPublish: Boolean(publication.autoPublish),
          supportsFuturePublishing: Boolean(publication.supportsFuturePublishing),
          catalogId,
          catalogTitle,
          status,
          disabled,
          disabledReason: disabled ? "目前不支持发布多属性。" : null,
        });
      }

      for (const channel of channelNodes) {
        const channelId = cleanField(channel.id);
        if (!channelId || seenChannels.has(channelId)) continue;
        seenChannels.add(channelId);
        const rawName =
          cleanField(channel.name) || catalogTitle || "未命名销售渠道";
        const disabled = isUnsupportedShopifyVariantPublicationChannel(rawName);
        channels.push({
          id: channelId,
          name: normalizeShopifySalesChannelDisplayName(rawName),
          publicationId,
          autoPublish: Boolean(publication.autoPublish),
          supportsFuturePublishing: Boolean(publication.supportsFuturePublishing),
          catalogId,
          catalogTitle,
          status,
          disabled,
          disabledReason: disabled ? "目前不支持发布多属性。" : null,
        });
      }
    }
    channels.sort(
      (a, b) =>
        getShopifySalesChannelSortOrder(a.name) -
          getShopifySalesChannelSortOrder(b.name) ||
        a.name.localeCompare(b.name, "zh-CN"),
    );
  }

  const catalogsJson = await shopifyGraphql<ShopifyCatalogsResponse>(
    stored.shopDomain,
    stored.accessToken,
    `query BuqiqiShopifyCatalogs {
      catalogs(first: 50) {
        nodes {
          id
          title
          status
          publication {
            id
          }
        }
      }
    }`,
  );
  const catalogErrors = formatGraphqlMessages(catalogsJson.errors);
  if (catalogErrors) {
    warnings.push(`读取 Shopify 目录失败：${catalogErrors}`);
  } else {
    const seenCatalogs = new Set<string>();
    for (const catalog of catalogsJson.data?.catalogs?.nodes || []) {
      const id = cleanField(catalog.id);
      const title = cleanField(catalog.title) || "未命名目录";
      if (!id || seenCatalogs.has(id)) continue;
      if (isShopifyInternalChannelCatalogTitle(title)) continue;
      seenCatalogs.add(id);
      catalogs.push({
        id,
        title,
        status: cleanField(catalog.status) || null,
        publicationId: cleanField(catalog.publication?.id) || null,
      });
    }
    catalogs.sort((a, b) => {
      const priority = (title: string) => {
        if (title === "国际") return 10;
        if (title === "美国") return 20;
        return 50;
      };
      return (
        priority(a.title) - priority(b.title) ||
        a.title.localeCompare(b.title, "zh-CN")
      );
    });
  }

  return { channels, catalogs, warnings };
}

export async function getShopifyCustomsOptions(
  userId: number,
  deviceId: string,
): Promise<ShopifyCustomsOptionsResult> {
  const stored = await getStoredShopifyAccessToken(userId, deviceId);
  if (!stored) throw new Error("尚未绑定 Shopify");

  const warnings: string[] = [];
  const countries = isTestShopifyCredentials(stored.shopDomain, stored.accessToken)
    ? buildFallbackShopifyCountryCodeOptions()
    : await readShopifyCountryCodeOptions(
        stored.shopDomain,
        stored.accessToken,
        warnings,
      );

  return {
    countries,
    hsCodes: [],
    warnings,
  };
}

export async function getShopifyProductOrganizationOptions(
  userId: number,
  deviceId: string,
  opts: { categoryId?: string } = {},
): Promise<ShopifyProductOrganizationOptionsResult> {
  const stored = await getStoredShopifyAccessToken(userId, deviceId);
  if (!stored) throw new Error("尚未绑定 Shopify");
  const categorySearchId = normalizeShopifyCategorySearchId(opts.categoryId);
  if (!categorySearchId) {
    return {
      productTypes: [],
      vendors: [],
      collections: [],
      commonTags: [],
      tags: [],
      templateStyles: [],
      warnings: ["请先选择 Shopify 类别，再读取该类别下的产品组织条目。"],
    };
  }

  if (isTestShopifyCredentials(stored.shopDomain, stored.accessToken)) {
    return {
      productTypes: [],
      vendors: [],
      collections: [],
      commonTags: [],
      tags: [],
      templateStyles: [
        { value: "collage-s1", label: "collage-s1" },
        { value: "collage-s2", label: "collage-s2" },
        { value: "des-tabcenter", label: "des-tabcenter" },
        { value: "list-grid", label: "list-grid" },
        { value: "list-stacked", label: "list-stacked" },
        { value: "product-bundle", label: "product-bundle" },
        { value: "tab-accordion", label: "tab-accordion" },
        { value: "thumb-bottom", label: "thumb-bottom" },
        { value: "thumb-left", label: "thumb-left" },
        { value: "thumb-right", label: "thumb-right" },
        { value: "variant-dropdown", label: "variant-dropdown" },
        { value: "variant-image-square", label: "variant-image-square" },
        { value: "variant-image", label: "variant-image" },
        { value: "without-thumb", label: "without-thumb" },
      ],
      warnings: [
        "当前使用测试密钥，显示模拟的模板样式选项。真实店铺会显示实际使用的模板。",
      ],
    };
  }

  const warnings: string[] = [];
  const productTypes: string[] = [];
  const vendors: string[] = [];
  const templateStyles: string[] = [];
  const categoryTagCounts = new Map<string, number>();

  let collections: ShopifyProductOrganizationOption[] = [];
  let tags: ShopifyProductOrganizationOption[] = [];

  const collectionsPromise = readShopifyCollectionOptions(
    stored.shopDomain,
    stored.accessToken,
    warnings,
  ).catch((err) => {
    warnings.push(`读取 Shopify 集合失败：${err instanceof Error ? err.message : String(err)}`);
    return [] as ShopifyProductOrganizationOption[];
  });
  const tagsPromise = readShopifyStringConnectionOptions(
    stored.shopDomain,
    stored.accessToken,
    "productTags",
    "标记",
    warnings,
  ).catch((err) => {
    warnings.push(`读取 Shopify 标记失败：${err instanceof Error ? err.message : String(err)}`);
    return [] as ShopifyProductOrganizationOption[];
  });
  const themeTemplateStylesPromise = readShopifyThemeProductTemplateOptions(
    stored.shopDomain,
    stored.accessToken,
    warnings,
  ).catch((err) => {
    warnings.push(
      `读取 Shopify 主题产品模板失败：${err instanceof Error ? err.message : String(err)}。如需读取最新主题模板，请确认 Shopify 授权包含 read_themes 并重新授权。`,
    );
    return [] as ShopifyProductOrganizationOption[];
  });
  let after: string | null = null;
  let page = 0;
  const maxPages = 5;

  console.log(`[Shopify] 开始查询类别 ${categorySearchId} 的产品组织信息...`);

  do {
    const json: ShopifyProductsOrganizationResponse =
      await shopifyGraphql<ShopifyProductsOrganizationResponse>(
        stored.shopDomain,
        stored.accessToken,
        `query BuqiqiShopifyProductOrganizationByCategory($query: String!, $first: Int!, $after: String) {
          products(first: $first, after: $after, query: $query) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              productType
              vendor
              tags
              templateSuffix
            }
          }
        }`,
        {
          query: `category_id:${categorySearchId}`,
          first: 100,
          after,
        },
      );
    const topLevelErrors = formatGraphqlMessages(json.errors);
    if (topLevelErrors) {
      warnings.push(`读取 Shopify 当前类别产品组织失败：${topLevelErrors}`);
      break;
    }

    const productCount = json.data?.products?.nodes?.length || 0;
    console.log(`[Shopify] 第 ${page + 1} 页：读取到 ${productCount} 个产品`);

    for (const product of json.data?.products?.nodes || []) {
      const productType = cleanField(product.productType);
      if (productType) productTypes.push(productType);
      const vendor = cleanField(product.vendor);
      if (vendor) vendors.push(vendor);
      const rawTemplateSuffix = product.templateSuffix;
      if (product.id && page === 0 && templateStyles.length === 0) {
        console.log(`[Shopify] 前3个产品 templateSuffix:`, (json.data?.products?.nodes || []).slice(0, 3).map(p => `${p.id?.slice(-8)}: "${p.templateSuffix}"`));
      }
      const templateStyle = normalizeShopifyTemplateSuffix(rawTemplateSuffix || "");
      if (templateStyle) templateStyles.push(templateStyle);
      for (const tag of product.tags || []) {
        const cleanedTag = cleanField(tag);
        if (!cleanedTag) continue;
        const key = cleanedTag.toLowerCase();
        categoryTagCounts.set(key, (categoryTagCounts.get(key) || 0) + 1);
      }
    }

    page += 1;
    after = cleanField(json.data?.products?.pageInfo?.endCursor) || null;
    if (!json.data?.products?.pageInfo?.hasNextPage) break;
  } while (after && page < maxPages);

  if (after && page >= maxPages) {
    warnings.push("当前类别商品较多，本次只读取前 500 个商品来生成组织条目。");
  }

  const resolved = await Promise.all([
    collectionsPromise,
    tagsPromise,
    themeTemplateStylesPromise,
  ]);

  collections = resolved[0];
  tags = resolved[1];
  const themeTemplateStyles = resolved[2];

  console.log(`[Shopify] 类别 ${categorySearchId} 模板样式收集结果: ${templateStyles.length} 个原始值 -> ${buildShopifyProductOrganizationStringOptions(templateStyles).length} 个选项`);

  const templateStylesOptions = mergeShopifyProductOrganizationOptions(
    themeTemplateStyles,
    buildShopifyProductOrganizationStringOptions(templateStyles),
  );

  return {
    productTypes: buildShopifyProductOrganizationStringOptions(productTypes),
    vendors: buildShopifyProductOrganizationStringOptions(vendors),
    collections,
    commonTags: buildShopifyCommonTagOptions(categoryTagCounts, tags),
    tags,
    templateStyles: templateStylesOptions.length > 0
      ? templateStylesOptions
      : SHOPIFY_DEFAULT_TEMPLATE_STYLES,
    warnings,
  };
}

async function readShopifyThemeProductTemplateOptions(
  shopDomain: string,
  accessToken: string,
  warnings: string[],
): Promise<ShopifyProductOrganizationOption[]> {
  const themes = await shopifyRestGet<ShopifyThemesRestResponse>(
    shopDomain,
    accessToken,
    "/themes.json",
  );
  const theme =
    (themes.themes || []).find((item) => item.role === "main") ||
    (themes.themes || [])[0];
  const themeId = theme?.id ? String(theme.id) : "";
  if (!themeId) return [];

  const assets = await shopifyRestGet<ShopifyThemeAssetsRestResponse>(
    shopDomain,
    accessToken,
    `/themes/${encodeURIComponent(themeId)}/assets.json`,
  );
  const templateAssets = (assets.assets || [])
    .map((asset) => ({
      suffix: normalizeShopifyProductTemplateAssetKey(asset.key || ""),
      updatedAt: asset.updated_at || "",
    }))
    .filter((asset) => asset.suffix)
    .sort((a, b) => {
      const bTime = Date.parse(b.updatedAt || "");
      const aTime = Date.parse(a.updatedAt || "");
      if (Number.isFinite(bTime) && Number.isFinite(aTime) && bTime !== aTime) {
        return bTime - aTime;
      }
      return a.suffix.localeCompare(b.suffix);
    });

  const options = buildShopifyProductOrganizationStringOptionsInOrder(
    templateAssets.map((asset) => asset.suffix),
  );
  if (!options.length) {
    warnings.push("当前主题未读取到自定义产品模板，已使用商品记录中的模板样式。");
  }
  return options;
}

function normalizeShopifyProductTemplateAssetKey(key: string): string {
  const cleaned = cleanField(key);
  const match = cleaned.match(/^templates\/product(?:\.([^/]+))?\.(json|liquid)$/i);
  if (!match?.[1]) return "";
  return normalizeShopifyTemplateSuffix(match[1]);
}

function mergeShopifyProductOrganizationOptions(
  ...groups: ShopifyProductOrganizationOption[][]
): ShopifyProductOrganizationOption[] {
  const seen = new Set<string>();
  const options: ShopifyProductOrganizationOption[] = [];
  for (const group of groups) {
    for (const option of group) {
      const value = cleanField(option.value);
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      options.push({ ...option, value, label: option.label || value });
    }
  }
  return options;
}

const SHOPIFY_DEFAULT_TEMPLATE_STYLES: ShopifyProductOrganizationOption[] = [
  { value: "collage-s1", label: "collage-s1" },
  { value: "collage-s2", label: "collage-s2" },
  { value: "des-tabcenter", label: "des-tabcenter" },
  { value: "list-grid", label: "list-grid" },
  { value: "list-stacked", label: "list-stacked" },
  { value: "product-bundle", label: "product-bundle" },
  { value: "tab-accordion", label: "tab-accordion" },
  { value: "thumb-bottom", label: "thumb-bottom" },
  { value: "thumb-left", label: "thumb-left" },
  { value: "thumb-right", label: "thumb-right" },
  { value: "variant-dropdown", label: "variant-dropdown" },
  { value: "variant-image-square", label: "variant-image-square" },
  { value: "variant-image", label: "variant-image" },
  { value: "without-thumb", label: "without-thumb" },
];

export async function getShopifyTaxonomyCategoryOptions(
  userId: number,
  deviceId: string,
  opts: { search?: string; childrenOf?: string } = {},
): Promise<ShopifyTaxonomyCategoryOptionsResult> {
  const stored = await getStoredShopifyAccessToken(userId, deviceId);
  if (!stored) throw new Error("尚未绑定 Shopify");

  if (isTestShopifyCredentials(stored.shopDomain, stored.accessToken)) {
    return {
      categories: [],
      warnings: ["当前使用测试密钥，Shopify 类别需要真实店铺读取。"],
    };
  }

  const warnings: string[] = [];
  const search = cleanField(opts.search).slice(0, 80);
  const childrenOf = cleanField(opts.childrenOf);
  const variables: Record<string, unknown> = {};
  const args = ["first: 250"];

  if (search) {
    args.push("search: $search");
    variables.search = search;
  } else if (childrenOf && isShopifyTaxonomyCategoryId(childrenOf)) {
    args.push("childrenOf: $childrenOf");
    variables.childrenOf = childrenOf;
  }

  const json = await shopifyGraphql<ShopifyTaxonomyCategoriesResponse>(
    stored.shopDomain,
    stored.accessToken,
    `query BuqiqiShopifyTaxonomyCategories${search ? "($search: String!)" : variables.childrenOf ? "($childrenOf: ID!)" : ""} {
      taxonomy {
        categories(${args.join(", ")}) {
          nodes {
            id
            name
            fullName
            parentId
            level
            isRoot
            isLeaf
            isArchived
            childrenIds
          }
        }
      }
    }`,
    variables,
  );
  const topLevelErrors = formatGraphqlMessages(json.errors);
  if (topLevelErrors) {
    warnings.push(`读取 Shopify 类别失败：${topLevelErrors}`);
    return { categories: [], warnings };
  }

  const categories = (json.data?.taxonomy?.categories?.nodes || [])
    .filter((node) => node.id && !node.isArchived)
    .map((node) => {
      const name = cleanField(node.name) || cleanField(node.fullName) || node.id;
      const fullName = cleanField(node.fullName) || name;
      const childrenCount = node.childrenIds?.length || 0;
      return {
        id: node.id,
        name,
        fullName,
        parentId: cleanField(node.parentId) || null,
        level: Number.isFinite(node.level) ? Number(node.level) : 0,
        isRoot: Boolean(node.isRoot),
        isLeaf: node.isLeaf === true || childrenCount === 0,
        childrenCount,
      } satisfies ShopifyTaxonomyCategoryOption;
    });

  return { categories, warnings };
}

/**
 * 推断产品来源类型（用于上架统计）
 *
 * 规则：
 * - 如果产品有 metadata 或特定标记，从中提取
 * - 否则根据产品特征推断：
 *   - 有批量变体 → 可能是 AI 生成
 *   - 描述中含特定关键词 → URL 抓取
 *   - 默认 → 本地上传
 */
function inferProductSourceType(input: ShopifyProductDraftInput): 'url_capture' | 'ai_generated' | 'local_upload' {
  // 优先使用前端明确传入的来源类型
  if (input.sourceType === 'url_capture') return 'url_capture';
  if (input.sourceType === 'ai_generated') return 'ai_generated';
  if (input.sourceType === 'local_upload') return 'local_upload';
  // 兜底默认本地上传
  return 'local_upload';
}

export async function syncShopifyProduct(
  userId: number,
  deviceId: string,
  input: ShopifyProductDraftInput,
): Promise<ShopifyProductSyncResult> {
  const stored = await getStoredShopifyAccessToken(userId, deviceId);
  if (!stored) throw new Error("尚未绑定 Shopify");
  if (isTestShopifyCredentials(stored.shopDomain, stored.accessToken)) {
    const title = cleanField(input.title) || "BUQIQI Test Product";
    const hasInventoryQuantity =
      Boolean(cleanField(input.inventory)) ||
      Boolean(input.variants?.some((variant) => cleanField(variant.inventory)));
    return {
      productId: "gid://shopify/Product/buqiqi-local-test",
      title,
      handle: "buqiqi-local-test-product",
      legacyResourceId: "buqiqi-local-test",
      adminUrl: null,
      warnings: [
        "当前使用测试密钥，已模拟同步成功，没有调用 Shopify 官方接口。",
        ...(input.media?.length
          ? [`已模拟同步 ${input.media.length} 张 Media。`]
          : []),
        ...(cleanField(input.collections)
          ? [`已模拟同步产品系列：${cleanField(input.collections)}。`]
          : []),
        ...(hasInventoryQuantity ? ["已模拟同步库存数量到 Shopify 库存。"] : []),
      ],
    };
  }

  const title = cleanField(input.title);
  if (!title) throw new Error("商品标题不能为空");

  const warnings: string[] = [];
  const variantDrafts = normalizeProductVariantDrafts(input);
  const categoryId = await resolveShopifyProductCategoryId(
    stored.shopDomain,
    stored.accessToken,
    input,
    warnings,
  );
  const collectionIds = await resolveShopifyCollectionIds(
    stored.shopDomain,
    stored.accessToken,
    input.collections,
    warnings,
  );
  const templateSuffix = normalizeShopifyTemplateSuffix(
    input.templateStyle || input.templateSuffix,
  );
  const productOptionDrafts = buildProductOptionDrafts(
    input,
    variantDrafts,
    warnings,
  );
  const resolvedVariantSkus = await resolveSharedShopifyVariantSkus(
    stored.shopDomain,
    stored.accessToken,
    input,
    variantDrafts,
    warnings,
  );
  const variantOptionName =
    productOptionDrafts[0]?.optionName ||
    cleanField(input.variantGroupByOptionName) ||
    cleanField(input.variantOptionName) ||
    "Size";
  const productInput = {
    title,
    descriptionHtml: textToHtml(input.description),
    ...(categoryId ? { category: categoryId } : {}),
    ...(collectionIds.length ? { collectionsToJoin: collectionIds } : {}),
    ...(templateSuffix ? { templateSuffix } : {}),
    productType: cleanField(input.productType),
    vendor: cleanField(input.vendor),
    tags: normalizeTags(input.tags),
    status: normalizeShopifyProductStatus(input.status),
    seo: {
      title: cleanField(input.seoTitle) || title,
      description: cleanField(input.seoDescription),
    },
    metafields: buildProductMetafields(input),
    ...(variantDrafts.length && productOptionDrafts.length
      ? {
          productOptions: productOptionDrafts.map((option) => ({
            name: option.optionName,
            values: option.values.map((value) =>
              buildProductOptionCreateValueInput(option, value),
            ),
          })),
        }
      : {}),
  };
  let mediaInput: ShopifyMediaInputWithSource[] = [];
  try {
    mediaInput = await buildProductMediaInput(
      stored.shopDomain,
      stored.accessToken,
      title,
      input.media || [],
    );
  } catch (e) {
    if (!isStagedUploadAccessDeniedError(e)) throw e;
    warnings.push(
      "Shopify 当前授权缺少文件上传权限，已先创建商品但跳过图片同步。请确认应用含 write_files/read_files/write_products，并重新安装或重新授权。",
    );
  }

  const createJson = await shopifyGraphql<ShopifyProductCreateResponse>(
    stored.shopDomain,
    stored.accessToken,
    `mutation CreateBuqiqiProduct(
      $product: ProductCreateInput!
      $media: [CreateMediaInput!]
    ) {
      productCreate(product: $product, media: $media) {
        product {
          id
          title
          handle
          legacyResourceId
          media(first: 100) {
            nodes {
              id
              status
              ... on MediaImage {
                image {
                  url
                }
              }
            }
          }
          variants(first: 1) {
            nodes {
              id
              inventoryItem {
                id
                sku
              }
            }
          }
          options {
            id
            name
            optionValues {
              id
              name
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      product: productInput,
      media: mediaInput.map(
        ({ sourceUrl: _sourceUrl, filenameKey: _filenameKey, ...item }) => item,
      ),
    },
  );

  assertNoTopLevelGraphqlErrors(createJson.errors);
  const createPayload = createJson.data?.productCreate;
  const createErrors = normalizeUserErrors(createPayload?.userErrors);
  if (createErrors.length) {
    throw new Error(`Shopify 创建商品失败：${createErrors.join("；")}`);
  }
  const product = createPayload?.product;
  if (!product?.id) throw new Error("Shopify 未返回已创建商品 ID");

  await syncShopifyProductPublications(
    stored.shopDomain,
    stored.accessToken,
    product.id,
    input.publicationIds,
    warnings,
  );

  const categoryMetafieldsPromise = syncShopifyCategoryMetafields(
    stored.shopDomain,
    stored.accessToken,
    product.id,
    categoryId,
    input,
    productOptionDrafts,
    warnings,
  );

  const firstVariant = product.variants?.nodes?.[0];
  const firstVariantDraft = variantDrafts[0];
  const inventoryTargets: InventorySyncTarget[] = [];
  const readyMediaNodes = mediaInput.length
    ? await waitForShopifyReadyProductMediaNodes(
        stored.shopDomain,
        stored.accessToken,
        product.id,
        product.media?.nodes || [],
        mediaInput.length,
        warnings,
      )
    : [];
  const fallbackMediaIds = readyMediaNodes.map((node) => node.id);
  if (mediaInput.length && !fallbackMediaIds.length) {
    warnings.push("Shopify 商品图片仍在处理中，多属性图片本次未关联到变体；稍后重新同步即可。");
  }
  const mediaIdBySource = buildMediaIdBySource(
    mediaInput,
    readyMediaNodes,
  );
  const variantMediaTargets: VariantMediaSyncTarget[] = [];
  const firstInventoryQuantity = normalizeInventoryQuantity(
    firstVariantDraft?.inventory || input.inventory,
  );
  if (firstVariant?.inventoryItem?.id && firstInventoryQuantity !== null) {
    inventoryTargets.push({
      inventoryItemId: firstVariant.inventoryItem.id,
      quantity: firstInventoryQuantity,
      label: firstVariantDraft?.size || "默认变体",
    });
  }
  pushVariantMediaTarget(
    variantMediaTargets,
    firstVariant?.id,
    firstVariantDraft,
    mediaIdBySource,
    fallbackMediaIds,
  );
  const variantInput: Record<string, unknown> = {
    taxable: input.taxable === true,
  };
  if (firstVariant?.id) variantInput.id = firstVariant.id;
  const compareAtPrice = normalizePrice(input.compareAtPrice);
  const price = normalizeVariantPrice(firstVariantDraft?.price, input.price);
  if (compareAtPrice) variantInput.compareAtPrice = compareAtPrice;
  if (price) variantInput.price = price;
  const sku = resolvedVariantSkus[0] || "";
  variantInput.inventoryItem = buildInventoryItemInput(input, sku);
  const firstVariantMediaId = resolveVariantMediaId(
    firstVariantDraft,
    mediaIdBySource,
    fallbackMediaIds,
  );
  if (firstVariantMediaId) variantInput.mediaId = firstVariantMediaId;
  const firstVariantOptionValues = firstVariantDraft
    ? buildVariantOptionValueInputsForVariant(
        firstVariantDraft,
        productOptionDrafts,
      )
    : [];
  if (firstVariantOptionValues.length) {
    variantInput.optionValues = firstVariantOptionValues;
  }

  if (
    firstVariant?.id &&
    (compareAtPrice ||
      price ||
      sku ||
      firstInventoryQuantity !== null ||
      firstVariantOptionValues.length ||
      variantInput.inventoryItem)
  ) {
    const updateJson = await shopifyGraphql<ShopifyVariantUpdateResponse>(
      stored.shopDomain,
      stored.accessToken,
      `mutation UpdateBuqiqiProductVariant(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors {
            field
            message
          }
        }
      }`,
      {
        productId: product.id,
        variants: [variantInput],
      },
    );
    if (updateJson.errors?.length) {
      warnings.push(...updateJson.errors.map((err) => err.message || "变体更新失败"));
    }
    warnings.push(
      ...normalizeUserErrors(
        updateJson.data?.productVariantsBulkUpdate?.userErrors,
      ),
    );
  }

  const extraVariantDrafts = variantDrafts.slice(1);
  if (extraVariantDrafts.length) {
    const createVariantInput = extraVariantDrafts.map((variant, index) => {
      const inputVariant: Record<string, unknown> = {
        optionValues: buildVariantOptionValueInputsForVariant(
          variant,
          productOptionDrafts,
        ),
        taxable: input.taxable === true,
      };
      const variantPrice = normalizeVariantPrice(variant.price, input.price);
      if (variantPrice) inputVariant.price = variantPrice;
      if (compareAtPrice) inputVariant.compareAtPrice = compareAtPrice;
      const variantSku = resolvedVariantSkus[index + 1] || "";
      inputVariant.inventoryItem = buildInventoryItemInput(input, variantSku);
      const variantMediaId = resolveVariantMediaId(
        variant,
        mediaIdBySource,
        fallbackMediaIds,
      );
      if (variantMediaId) inputVariant.mediaId = variantMediaId;
      return inputVariant;
    });
    const variantsJson = await shopifyGraphql<ShopifyVariantsBulkCreateResponse>(
      stored.shopDomain,
      stored.accessToken,
      `mutation CreateBuqiqiProductVariants(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkCreate(productId: $productId, variants: $variants) {
          productVariants {
            id
            title
            selectedOptions {
              name
              value
            }
            inventoryItem {
              id
              sku
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        productId: product.id,
        variants: createVariantInput,
      },
    );
    if (variantsJson.errors?.length) {
      warnings.push(
        ...variantsJson.errors.map((err) => err.message || "多属性变体创建失败"),
      );
    }
    warnings.push(
      ...normalizeUserErrors(
        variantsJson.data?.productVariantsBulkCreate?.userErrors,
      ),
    );
    const createdVariants =
      variantsJson.data?.productVariantsBulkCreate?.productVariants || [];
    const createdVariantByOptions = new Map(
      createdVariants
        .map((variant) => [
          normalizedVariantOptionsKey(variant.selectedOptions),
          variant,
        ] as const)
        .filter(([key]) => Boolean(key)),
    );
    for (let index = 0; index < extraVariantDrafts.length; index += 1) {
      const draft = extraVariantDrafts[index];
      const variant =
        createdVariantByOptions.get(
          normalizedVariantOptionsKey(draft.optionValues),
        ) || createdVariants[index];
      const quantity = normalizeInventoryQuantity(draft.inventory || input.inventory);
      if (variant?.inventoryItem?.id && quantity !== null) {
        inventoryTargets.push({
          inventoryItemId: variant.inventoryItem.id,
          quantity,
          label: draft.size || variant.title || `变体 ${index + 2}`,
        });
      }
      pushVariantMediaTarget(
        variantMediaTargets,
        variant?.id,
        draft,
        mediaIdBySource,
        fallbackMediaIds,
      );
    }
  }

  await syncShopifyLinkedProductOptions(
    stored.shopDomain,
    stored.accessToken,
    product.id,
    categoryId,
    productOptionDrafts,
    warnings,
  );

  await syncShopifyVariantMedia(
    stored.shopDomain,
    stored.accessToken,
    product.id,
    variantMediaTargets,
    warnings,
  );

  await syncShopifyInventoryQuantities(
    stored.shopDomain,
    stored.accessToken,
    inventoryTargets,
    warnings,
  );

  await categoryMetafieldsPromise;

  // 记录上架统计（独立事务，失败不影响上架）
  try {
    const sourceType = inferProductSourceType(input);
    const db = getDb();
    db.prepare(
      `INSERT INTO shopify_upload_stats (user_id, source_type, product_count, shopify_product_id, status)
       VALUES (?, ?, 1, ?, 'success')`
    ).run(userId, sourceType, product.legacyResourceId || product.id);
  } catch (err) {
    console.warn('[shopify] 上架统计记录失败（不影响上架）:', err);
  }

  return {
    productId: product.id,
    title: product.title,
    handle: product.handle || null,
    legacyResourceId: product.legacyResourceId || null,
    adminUrl: product.legacyResourceId
      ? `https://${stored.shopDomain}/admin/products/${product.legacyResourceId}`
      : null,
    warnings,
  };
}

async function waitForShopifyReadyProductMediaNodes(
  shopDomain: string,
  accessToken: string,
  productId: string,
  initialNodes: ShopifyProductMediaNode[],
  expectedCount: number,
  warnings: string[],
): Promise<ShopifyProductMediaNode[]> {
  let nodes = initialNodes;
  let lastStateText = describeShopifyMediaStates(nodes);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const readyNodes = nodes.filter(
      (media) => media.id && media.status === "READY" && media.image?.url,
    );
    if (readyNodes.length >= expectedCount) return readyNodes;
    if (attempt > 0 || !nodes.length) {
      nodes = await fetchShopifyProductMediaNodes(
        shopDomain,
        accessToken,
        productId,
        warnings,
      );
      lastStateText = describeShopifyMediaStates(nodes);
      const fetchedReadyNodes = nodes.filter(
        (media) => media.id && media.status === "READY" && media.image?.url,
      );
      if (fetchedReadyNodes.length >= expectedCount) return fetchedReadyNodes;
    }
    if (attempt < 11) {
      await delay(attempt === 0 ? 700 : 1_200);
    }
  }
  if (lastStateText) {
    warnings.push(`Shopify 媒体状态：${lastStateText}`);
  }
  return nodes.filter(
    (media) => media.id && media.status === "READY" && media.image?.url,
  );
}

async function fetchShopifyProductMediaNodes(
  shopDomain: string,
  accessToken: string,
  productId: string,
  warnings: string[],
): Promise<ShopifyProductMediaNode[]> {
    const mediaJson = await shopifyGraphql<ShopifyProductMediaResponse>(
      shopDomain,
      accessToken,
      `query BuqiqiProductMedia($id: ID!) {
        product(id: $id) {
          media(first: 100) {
            nodes {
              id
              status
              ... on MediaImage {
                image {
                  url
                }
              }
            }
          }
        }
      }`,
      { id: productId },
    );
    const topLevelErrors = formatGraphqlMessages(mediaJson.errors);
    if (topLevelErrors) {
      warnings.push(`读取 Shopify 商品媒体失败：${topLevelErrors}`);
      return [];
    }
    return mediaJson.data?.product?.media?.nodes || [];
}

function describeShopifyMediaStates(nodes: ShopifyProductMediaNode[]): string {
  const states = nodes
    .map((media) => media.status || "UNKNOWN")
    .filter(Boolean);
  if (!states.length) return "";
  return Array.from(new Set(states)).join("、");
}

function pushVariantMediaTarget(
  targets: VariantMediaSyncTarget[],
  variantId: string | undefined,
  draft:
    | {
        size: string;
        imageUrl: string;
      }
    | undefined,
  mediaIdBySource: Map<string, string>,
  mediaIds: string[],
) {
  if (!variantId || !mediaIds.length) return;
  const mediaId = resolveVariantMediaId(draft, mediaIdBySource, mediaIds);
  if (!mediaId) return;
  targets.push({
    variantId,
    mediaIds: [mediaId],
    label: draft?.size || "默认变体",
  });
}

function resolveVariantMediaId(
  draft:
    | {
        imageUrl: string;
      }
    | undefined,
  mediaIdBySource: Map<string, string>,
  mediaIds: string[],
): string {
  if (!draft || !cleanField(draft.imageUrl)) return "";
  const matchedMediaId = mediaIdBySource.get(normalizeMediaSourceKey(draft.imageUrl));
  return matchedMediaId || "";
}

function buildMediaIdBySource(
  mediaInput: ShopifyMediaInputWithSource[],
  nodes: ShopifyProductMediaNode[],
) {
  const result = new Map<string, string>();
  const mediaIdByFilename = new Map<string, string>();
  for (const node of nodes) {
    const filenameKey = normalizeMediaFilenameKey(node.image?.url || "");
    if (filenameKey && node.id) mediaIdByFilename.set(filenameKey, node.id);
  }
  for (let index = 0; index < mediaInput.length; index += 1) {
    const item = mediaInput[index];
    const mediaId = mediaIdByFilename.get(item.filenameKey) || "";
    if (!mediaId) continue;
    result.set(normalizeMediaSourceKey(item.sourceUrl), mediaId);
    result.set(normalizeMediaSourceKey(item.originalSource), mediaId);
  }
  return result;
}

function normalizeMediaFilenameKey(value: string): string {
  const cleanUrl = cleanField(value).split("?")[0] || "";
  if (!cleanUrl) return "";
  let filename = cleanUrl;
  try {
    filename = new URL(cleanUrl, "https://media.local").pathname.split("/").pop() || "";
    filename = decodeURIComponent(filename);
  } catch {
    filename = cleanUrl.split("/").pop() || "";
  }
  return filename.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeMediaSourceKey(value: string): string {
  const cleaned = cleanField(value).split("?")[0] || "";
  return cleaned.toLowerCase();
}

async function syncShopifyVariantMedia(
  shopDomain: string,
  accessToken: string,
  productId: string,
  targets: VariantMediaSyncTarget[],
  warnings: string[],
): Promise<void> {
  const mediaTargets = dedupeVariantMediaTargets(targets);
  if (!mediaTargets.length) return;

  try {
    const mediaJson = await shopifyGraphql<ShopifyVariantAppendMediaResponse>(
      shopDomain,
      accessToken,
      `mutation AppendBuqiqiVariantMedia(
        $productId: ID!
        $variantMedia: [ProductVariantAppendMediaInput!]!
      ) {
        productVariantAppendMedia(
          productId: $productId
          variantMedia: $variantMedia
        ) {
          productVariants {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        productId,
        variantMedia: mediaTargets.map((target) => ({
          variantId: target.variantId,
          mediaIds: target.mediaIds,
        })),
      },
    );

    const topLevelErrors = formatGraphqlMessages(mediaJson.errors);
    if (topLevelErrors) {
      warnings.push(`多属性图片同步到 Shopify 失败：${topLevelErrors}`);
    }
    const appendMediaErrors = normalizeUserErrors(
      mediaJson.data?.productVariantAppendMedia?.userErrors,
    );
    if (appendMediaErrors.some((message) => /non-ready media/i.test(message))) {
      warnings.push(
        "Shopify 商品图片仍在处理中，多属性图片本次未关联到变体；稍后重新同步即可。",
      );
    }
    const actionableAppendMediaErrors = appendMediaErrors.filter(
      (message) =>
        !/non-ready media/i.test(message) &&
        !/already has attached media/i.test(message),
    );
    warnings.push(
      ...actionableAppendMediaErrors.map(
        (message) => `多属性图片同步到 Shopify 失败：${message}`,
      ),
    );
  } catch (e) {
    warnings.push(`多属性图片同步到 Shopify 失败：${formatUnknownError(e)}`);
  }
}

async function fetchShopifyProductOptions(
  shopDomain: string,
  accessToken: string,
  productId: string,
  warnings: string[],
): Promise<ShopifyProductOptionNode[]> {
  try {
    const json = await shopifyGraphql<ShopifyProductOptionsResponse>(
      shopDomain,
      accessToken,
      `query BuqiqiProductOptions($id: ID!) {
        product(id: $id) {
          options {
            id
            name
            optionValues {
              id
              name
            }
          }
        }
      }`,
      { id: productId },
    );
    const topLevelErrors = formatGraphqlMessages(json.errors);
    if (topLevelErrors) {
      warnings.push(`读取 Shopify 多属性选项失败：${topLevelErrors}`);
      return [];
    }
    return json.data?.product?.options || [];
  } catch (e) {
    warnings.push(`读取 Shopify 多属性选项失败：${formatUnknownError(e)}`);
    return [];
  }
}

async function syncShopifyLinkedProductOptions(
  shopDomain: string,
  accessToken: string,
  productId: string,
  categoryId: string | null,
  productOptions: NormalizedProductOptionDraft[],
  warnings: string[],
) {
  const linkedOptions = productOptions.filter((option) => option.linkedMetafield);
  if (!linkedOptions.length) return;

  const shopifyOptions = await fetchShopifyProductOptions(
    shopDomain,
    accessToken,
    productId,
    warnings,
  );
  if (!shopifyOptions.length) return;

  const shopifyOptionByName = new Map(
    shopifyOptions
      .map((option) => [cleanField(option.name).toLowerCase(), option] as const)
      .filter(([name]) => Boolean(name)),
  );

  for (const option of linkedOptions) {
    const linkedMetafield = option.linkedMetafield;
    if (!linkedMetafield) continue;

    const shopifyOption = shopifyOptionByName.get(option.optionName.toLowerCase());
    if (!shopifyOption?.id) {
      warnings.push(
        `Shopify 多属性「${option.optionName}」官方元字段映射失败：未找到对应选项。`,
      );
      continue;
    }

    const optionValueByName = new Map(
      (shopifyOption.optionValues || [])
        .map((value) => [cleanField(value.name).toLowerCase(), value] as const)
        .filter(([name, value]) => Boolean(name && value.id)),
    );
    const optionValuesToUpdate = (
      await Promise.all(
        option.values.map(async (value) => {
        const name = cleanField(value);
        const shopifyValue = optionValueByName.get(name.toLowerCase());
          const rawLinkedMetafieldValue = cleanField(
          option.linkedValueByValue.get(name.toLowerCase()),
        );
          const linkedMetafieldValue = await resolveLinkedProductOptionMetafieldValue(
            shopDomain,
            accessToken,
            categoryId,
            linkedMetafield,
            rawLinkedMetafieldValue,
            name,
            warnings,
          );
        if (!shopifyValue?.id || !linkedMetafieldValue) return null;
        return {
          id: shopifyValue.id,
          linkedMetafieldValue,
        };
        }),
      )
    )
      .filter(
        (
          value,
        ): value is {
          id: string;
          linkedMetafieldValue: string;
        } => Boolean(value),
      );

    if (optionValuesToUpdate.length !== option.values.length) {
      warnings.push(
        `Shopify 多属性「${option.optionName}」官方元字段映射失败：部分选项值未找到官方条目。`,
      );
      continue;
    }

    try {
      const json = await shopifyGraphql<ShopifyProductOptionUpdateResponse>(
        shopDomain,
        accessToken,
        `mutation UpdateBuqiqiLinkedProductOption(
          $productId: ID!
          $option: OptionUpdateInput!
          $optionValuesToUpdate: [OptionValueUpdateInput!]
        ) {
          productOptionUpdate(
            productId: $productId
            option: $option
            optionValuesToUpdate: $optionValuesToUpdate
          ) {
            userErrors {
              field
              message
            }
          }
        }`,
        {
          productId,
          option: {
            id: shopifyOption.id,
            name: option.optionName,
            linkedMetafield: {
              namespace: linkedMetafield.namespace,
              key: linkedMetafield.key,
            },
          },
          optionValuesToUpdate,
        },
      );
      const topLevelErrors = formatGraphqlMessages(json.errors);
      if (topLevelErrors) {
        warnings.push(
          `Shopify 多属性「${option.optionName}」官方元字段映射失败：${topLevelErrors}`,
        );
        continue;
      }
      const userErrors = normalizeUserErrors(
        json.data?.productOptionUpdate?.userErrors,
      );
      if (userErrors.length) {
        warnings.push(
          `Shopify 多属性「${option.optionName}」官方元字段映射失败：${userErrors.join("；")}`,
        );
        continue;
      }
      warnings.push(
        `已将 Shopify 多属性「${option.optionName}」映射到官方元字段：shopify.${linkedMetafield.key}`,
      );
    } catch (e) {
      warnings.push(
        `Shopify 多属性「${option.optionName}」官方元字段映射失败：${formatUnknownError(e)}`,
      );
    }
  }
}

async function resolveLinkedProductOptionMetafieldValue(
  shopDomain: string,
  accessToken: string,
  categoryId: string | null,
  linkedMetafield: { namespace: string; key: string; values: string[] },
  rawValue: string,
  fallbackValue: string,
  warnings: string[],
): Promise<string | null> {
  const sourceValue =
    rawValue && !isShopifyTaxonomyValueId(rawValue) ? rawValue : fallbackValue;
  if (!sourceValue) return null;
  if (!categoryId || categoryId === SHOPIFY_UNCATEGORIZED_CATEGORY_ID) {
    return cleanField(sourceValue);
  }

  const mapping = findShopifyCategoryMetafieldMappingByShopifyKey(
    linkedMetafield.key,
  );
  if (!mapping) return cleanField(sourceValue);

  const definitions = await ensureShopifyCategoryMetafieldDefinitions(
    shopDomain,
    accessToken,
    categoryId,
    [mapping],
    warnings,
  );
  const definition = findShopifyCategoryMetafieldDefinition(definitions, mapping);
  const type = cleanField(definition?.type?.name);
  const fieldKey = cleanField(definition?.key) || "taxonomy_reference";

  if (/metaobject_reference$/.test(type)) {
    if (isShopifyMetaobjectId(sourceValue)) return sourceValue;
    const metaobjectType = definition
      ? getShopifyCategoryMetaobjectType(definition)
      : "";
    if (!metaobjectType) return null;
    return findOrCreateShopifyCategoryMetaobject(
      shopDomain,
      accessToken,
      categoryId,
      metaobjectType,
      sourceValue,
      warnings,
    );
  }

  if (isShopifyTaxonomyValueReferenceType(type)) {
    if (isShopifyTaxonomyValueId(sourceValue)) return sourceValue;
    return resolveShopifyTaxonomyValueId(
      shopDomain,
      accessToken,
      categoryId,
      type,
      fieldKey,
      sourceValue,
      inferShopifyCategoryValueForField(type, fieldKey, sourceValue),
      warnings,
    );
  }

  return cleanField(sourceValue);
}

async function syncShopifyProductPublications(
  shopDomain: string,
  accessToken: string,
  productId: string,
  publicationIds: string[] | undefined,
  warnings: string[],
) {
  const ids = Array.from(
    new Set((publicationIds || []).map(cleanField).filter(Boolean)),
  );
  if (!ids.length) return;

  try {
    const json = await shopifyGraphql<ShopifyPublishablePublishResponse>(
      shopDomain,
      accessToken,
      `mutation PublishBuqiqiProduct(
        $id: ID!
        $input: [PublicationInput!]!
      ) {
        publishablePublish(id: $id, input: $input) {
          userErrors {
            field
            message
          }
        }
      }`,
      {
        id: productId,
        input: ids.map((publicationId) => ({ publicationId })),
      },
    );
    const topLevelErrors = formatGraphqlMessages(json.errors);
    if (topLevelErrors) {
      warnings.push(
        `发布到 Shopify 销售渠道/目录失败：${topLevelErrors}。请确认授权包含 write_publications，并重新授权/重新安装应用后再发布。`,
      );
    }
    const userErrors = normalizeUserErrors(
      json.data?.publishablePublish?.userErrors,
    );
    warnings.push(
      ...userErrors.map(
        (message) =>
          `发布到 Shopify 销售渠道/目录失败：${message}。请确认授权包含 write_publications，并重新授权/重新安装应用后再发布。`,
      ),
    );
    if (!topLevelErrors && !userErrors.length) {
      warnings.push(`已匹配发布到 Shopify 销售渠道/目录：${ids.length} 个。`);
    }
  } catch (e) {
    warnings.push(
      `发布到 Shopify 销售渠道/目录失败：${
        e instanceof Error ? e.message : String(e)
      }。请确认授权包含 write_publications，并重新授权/重新安装应用后再发布。`,
    );
  }
}

function dedupeVariantMediaTargets(
  targets: VariantMediaSyncTarget[],
): VariantMediaSyncTarget[] {
  const byVariantId = new Map<string, VariantMediaSyncTarget>();
  for (const target of targets) {
    if (!target.variantId || !target.mediaIds.length) continue;
    byVariantId.set(target.variantId, target);
  }
  return Array.from(byVariantId.values());
}

async function syncShopifyInventoryQuantities(
  shopDomain: string,
  accessToken: string,
  targets: InventorySyncTarget[],
  warnings: string[],
): Promise<void> {
  const inventoryTargets = dedupeInventoryTargets(targets);
  if (!inventoryTargets.length) return;

  try {
    const location = await resolveShopifyInventoryLocation(
      shopDomain,
      accessToken,
      warnings,
    );
    if (!location?.id) {
      warnings.push("未找到 Shopify 库存地点，库存数量未同步。");
      return;
    }

    const trackedResults = await mapWithConcurrency(inventoryTargets, 4, async (target) => {
      const localWarnings: string[] = [];
      const tracked = await enableShopifyInventoryTracking(
        shopDomain,
        accessToken,
        target,
        localWarnings,
      );
      if (!tracked) return { target: null, warnings: localWarnings };
      await activateShopifyInventoryAtLocation(
        shopDomain,
        accessToken,
        target,
        location.id,
        localWarnings,
      );
      return { target, warnings: localWarnings };
    });
    const trackedTargets: InventorySyncTarget[] = [];
    for (const result of trackedResults) {
      warnings.push(...result.warnings);
      if (result.target) trackedTargets.push(result.target);
    }
    if (!trackedTargets.length) return;

    const setJson =
      await shopifyGraphql<ShopifyInventorySetQuantitiesResponse>(
        shopDomain,
        accessToken,
        `mutation SetBuqiqiInventoryQuantities(
          $input: InventorySetQuantitiesInput!
          $idempotencyKey: String!
        ) {
          inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
            inventoryAdjustmentGroup {
              createdAt
              reason
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          idempotencyKey: crypto.randomUUID(),
          input: {
            name: "available",
            reason: "correction",
            referenceDocumentUri: `buqiqi://shopify/product-inventory/${Date.now()}`,
            quantities: trackedTargets.map((target) => ({
              inventoryItemId: target.inventoryItemId,
              locationId: location.id,
              quantity: target.quantity,
              changeFromQuantity: null,
            })),
          },
        },
      );

    const topLevelErrors = formatGraphqlMessages(setJson.errors);
    if (topLevelErrors) {
      warnings.push(`库存数量同步到 Shopify 失败：${topLevelErrors}`);
    }
    warnings.push(
      ...normalizeUserErrors(setJson.data?.inventorySetQuantities?.userErrors).map(
        (message) => `库存数量同步到 Shopify 失败：${message}`,
      ),
    );
  } catch (e) {
    warnings.push(`库存数量同步到 Shopify 失败：${formatUnknownError(e)}`);
  }
}

async function resolveShopifyInventoryLocation(
  shopDomain: string,
  accessToken: string,
  warnings: string[],
): Promise<{ id: string; name?: string | null } | null> {
  const locationsJson = await shopifyGraphql<ShopifyLocationsResponse>(
    shopDomain,
    accessToken,
    `query BuqiqiInventoryLocations {
      locations(first: 20) {
        nodes {
          id
          name
        }
      }
    }`,
  );

  const topLevelErrors = formatGraphqlMessages(locationsJson.errors);
  if (topLevelErrors) {
    throw new Error(topLevelErrors);
  }

  const locations = (locationsJson.data?.locations?.nodes || []).filter(
    (location): location is { id: string; name?: string | null } =>
      Boolean(location?.id),
  );
  if (!locations.length) return null;

  const preferred = locations.find((location) => {
    const name = cleanField(location.name || "");
    return name === "康桥仓" || /康桥|kangqiao/i.test(name);
  });
  const selected = preferred || locations[0];
  if (!preferred) {
    warnings.push(
      `未找到 Shopify 库存地点「康桥仓」，已使用「${selected.name || selected.id}」同步库存。`,
    );
  }
  return selected;
}

async function enableShopifyInventoryTracking(
  shopDomain: string,
  accessToken: string,
  target: InventorySyncTarget,
  warnings: string[],
): Promise<boolean> {
  const updateJson = await shopifyGraphql<ShopifyInventoryItemUpdateResponse>(
    shopDomain,
    accessToken,
    `mutation UpdateBuqiqiInventoryItem(
      $id: ID!
      $input: InventoryItemInput!
    ) {
      inventoryItemUpdate(id: $id, input: $input) {
        inventoryItem {
          id
          tracked
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      id: target.inventoryItemId,
      input: { tracked: true },
    },
  );

  const topLevelErrors = formatGraphqlMessages(updateJson.errors);
  if (topLevelErrors) {
    warnings.push(`${target.label} 开启 Shopify 库存跟踪失败：${topLevelErrors}`);
    return false;
  }
  const userErrors = normalizeUserErrors(
    updateJson.data?.inventoryItemUpdate?.userErrors,
  );
  if (userErrors.length) {
    warnings.push(
      `${target.label} 开启 Shopify 库存跟踪失败：${userErrors.join("；")}`,
    );
    return false;
  }
  return true;
}

async function activateShopifyInventoryAtLocation(
  shopDomain: string,
  accessToken: string,
  target: InventorySyncTarget,
  locationId: string,
  warnings: string[],
): Promise<void> {
  const activateJson = await shopifyGraphql<ShopifyInventoryActivateResponse>(
    shopDomain,
    accessToken,
    `mutation ActivateBuqiqiInventory(
      $inventoryItemId: ID!
      $locationId: ID!
      $available: Int!
      $idempotencyKey: String!
    ) {
      inventoryActivate(
        inventoryItemId: $inventoryItemId
        locationId: $locationId
        available: $available
      ) @idempotent(key: $idempotencyKey) {
        inventoryLevel {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      inventoryItemId: target.inventoryItemId,
      locationId,
      available: target.quantity,
      idempotencyKey: crypto.randomUUID(),
    },
  );

  const topLevelErrors = formatGraphqlMessages(activateJson.errors);
  if (topLevelErrors) {
    warnings.push(`${target.label} 库存地点启用失败：${topLevelErrors}`);
    return;
  }

  const userErrors = normalizeUserErrors(
    activateJson.data?.inventoryActivate?.userErrors,
  ).filter((message) => !/already|active|stocked/i.test(message));
  if (userErrors.length) {
    warnings.push(`${target.label} 库存地点启用失败：${userErrors.join("；")}`);
  }
}

function dedupeInventoryTargets(targets: InventorySyncTarget[]): InventorySyncTarget[] {
  const byInventoryItemId = new Map<string, InventorySyncTarget>();
  for (const target of targets) {
    if (!target.inventoryItemId || target.quantity < 0) continue;
    byInventoryItemId.set(target.inventoryItemId, target);
  }
  return Array.from(byInventoryItemId.values());
}

async function resolveShopifyProductCategoryId(
  shopDomain: string,
  accessToken: string,
  input: ShopifyProductDraftInput,
  warnings: string[],
): Promise<string | null> {
  const selectedCategory = cleanField(input.categoryId);
  if (
    selectedCategory &&
    selectedCategory !== SHOPIFY_UNCATEGORIZED_CATEGORY_ID &&
    isShopifyTaxonomyCategoryId(selectedCategory)
  ) {
    return selectedCategory;
  }

  const searchTerms = buildCategorySearchTerms(input);
  if (!searchTerms.length) {
    return selectedCategory === SHOPIFY_UNCATEGORIZED_CATEGORY_ID
      ? selectedCategory
      : null;
  }

  for (const term of searchTerms) {
    try {
      const match = await searchShopifyTaxonomyCategory(
        shopDomain,
        accessToken,
        term,
      );
      if (match?.id) {
        warnings.push(`已按商品内容自动匹配 Shopify 类别：${match.fullName || match.name || term}`);
        return match.id;
      }
    } catch (e) {
      warnings.push(
        `Shopify 类别自动匹配失败：${e instanceof Error ? e.message : String(e)}`,
      );
      return selectedCategory || null;
    }
  }

  if (selectedCategory === SHOPIFY_UNCATEGORIZED_CATEGORY_ID) {
    warnings.push("未找到更准确的 Shopify 类别，已保持未分类。");
    return selectedCategory;
  }
  return null;
}

async function searchShopifyTaxonomyCategory(
  shopDomain: string,
  accessToken: string,
  search: string,
): Promise<{
  id: string;
  name?: string | null;
  fullName?: string | null;
} | null> {
  const json = await shopifyGraphql<ShopifyTaxonomySearchResponse>(
    shopDomain,
    accessToken,
    `query SearchBuqiqiProductCategory($search: String!) {
      taxonomy {
        categories(first: 10, search: $search) {
          nodes {
            id
            name
            fullName
            isArchived
          }
        }
      }
    }`,
    { search },
  );
  assertNoTopLevelGraphqlErrors(json.errors);
  const nodes = json.data?.taxonomy?.categories?.nodes || [];
  return nodes.find((node) => !node.isArchived && node.id) || null;
}

function buildCategorySearchTerms(input: ShopifyProductDraftInput): string[] {
  const rawText = [
    input.categoryName,
    input.productType,
    input.title,
    input.tags,
    input.description,
  ]
    .map(cleanField)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const terms: string[] = [];
  const add = (term?: string) => {
    const value = cleanField(term);
    if (value && !terms.includes(value)) terms.push(value);
  };

  if (
    /bridal|bride|bridesmaid|wedding|婚纱|新娘|伴娘/.test(rawText)
  ) {
    add("Wedding & Bridal Party Dresses");
  }
  if (/prom|evening|gown|dress|礼服|晚礼服|连衣裙|裙/.test(rawText)) {
    add("Dresses");
    add("Apparel & Accessories");
  }
  if (/shoe|heels|sandal|鞋/.test(rawText)) {
    add("Shoes");
  }
  if (/jewelry|necklace|ring|earring|首饰|珠宝|戒指|耳环/.test(rawText)) {
    add("Jewelry");
  }
  if (/bag|handbag|luggage|箱包|包/.test(rawText)) {
    add("Luggage & Bags");
  }
  if (/beauty|cosmetic|护肤|美容|化妆/.test(rawText)) {
    add("Health & Beauty");
  }
  add(input.productType);
  add(input.categoryName);
  add(input.title);

  return terms.filter((term) => term !== "未分类" && term.toLowerCase() !== "uncategorized");
}

function isShopifyTaxonomyCategoryId(value: string): boolean {
  return /^gid:\/\/shopify\/TaxonomyCategory\/[a-z0-9-]+$/i.test(value);
}

async function resolveShopifyCollectionIds(
  shopDomain: string,
  accessToken: string,
  rawCollections: string | undefined,
  warnings: string[],
): Promise<string[]> {
  const names = normalizeCollectionNames(rawCollections);
  if (!names.length) return [];

  const ids: string[] = [];
  const seenIds = new Set<string>();
  for (const name of names) {
    try {
      const existing = await findShopifyCollectionByName(
        shopDomain,
        accessToken,
        name,
      );
      const collection =
        existing ||
        (await createShopifyCollection(shopDomain, accessToken, name));
      if (!collection?.id || seenIds.has(collection.id)) continue;
      ids.push(collection.id);
      seenIds.add(collection.id);
      warnings.push(
        existing
          ? `已关联 Shopify 产品系列：${collection.title || name}`
          : `已新建并关联 Shopify 产品系列：${collection.title || name}`,
      );
    } catch (e) {
      warnings.push(
        `产品系列「${name}」同步失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return ids;
}

async function findShopifyCollectionByName(
  shopDomain: string,
  accessToken: string,
  name: string,
): Promise<ShopifyCollectionNode | null> {
  const targetTitle = cleanField(name).toLowerCase();
  const targetHandle = collectionHandleFromTitle(name);
  const json = await shopifyGraphql<ShopifyCollectionSearchResponse>(
    shopDomain,
    accessToken,
    `query SearchBuqiqiCollection($query: String!) {
      collections(first: 20, query: $query) {
        nodes {
          id
          title
          handle
        }
      }
    }`,
    { query: name },
  );
  assertNoTopLevelGraphqlErrors(json.errors);
  const nodes = json.data?.collections?.nodes || [];
  return (
    nodes.find(
      (node) => cleanField(node.title || "").toLowerCase() === targetTitle,
    ) ||
    nodes.find(
      (node) =>
        targetHandle &&
        cleanField(node.handle || "").toLowerCase() === targetHandle,
    ) ||
    null
  );
}

async function createShopifyCollection(
  shopDomain: string,
  accessToken: string,
  name: string,
): Promise<ShopifyCollectionNode> {
  const title = cleanField(name).slice(0, 255);
  if (!title) throw new Error("产品系列名称为空");
  const json = await shopifyGraphql<ShopifyCollectionCreateResponse>(
    shopDomain,
    accessToken,
    `mutation CreateBuqiqiCollection($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection {
          id
          title
          handle
        }
        userErrors {
          field
          message
        }
      }
    }`,
    { input: { title } },
  );
  assertNoTopLevelGraphqlErrors(json.errors);
  const payload = json.data?.collectionCreate;
  const errors = normalizeUserErrors(payload?.userErrors);
  if (errors.length) {
    throw new Error(errors.join("；"));
  }
  if (!payload?.collection?.id) {
    throw new Error("Shopify 未返回产品系列 ID");
  }
  return payload.collection;
}

function normalizeCollectionNames(value?: string): string[] {
  const ignored = new Set(["无", "没有", "未提供", "n/a", "none", "null"]);
  const seen = new Set<string>();
  return cleanField(value)
    .split(/[，,、;\n]/)
    .map((item) => cleanField(item).slice(0, 255))
    .filter((item) => item && !ignored.has(item.toLowerCase()))
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

function collectionHandleFromTitle(value: string): string {
  return cleanField(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function buildProductMediaInput(
  shopDomain: string,
  accessToken: string,
  productTitle: string,
  media: NonNullable<ShopifyProductDraftInput["media"]>,
): Promise<ShopifyMediaInputWithSource[]> {
  const result: ShopifyMediaInputWithSource[] = [];
  for (const [index, item] of media.entries()) {
    const url = cleanField(item.url);
    if (!url) continue;
    const localPath = resolveLocalAssetPath(url);
    const uploadFilename = localPath
      ? buildProductMediaFilename(productTitle, index, localPath)
      : "";
    const originalSource = localPath
      ? await uploadLocalImageToShopify(
          shopDomain,
          accessToken,
          localPath,
          uploadFilename,
        )
      : url;
    result.push({
      mediaContentType: "IMAGE",
      originalSource,
      sourceUrl: url,
      filenameKey: normalizeMediaFilenameKey(uploadFilename || url),
    });
  }
  return result;
}

function buildProductMediaFilename(
  productTitle: string,
  index: number,
  filePath: string,
): string {
  const ext = path.extname(filePath) || ".jpg";
  const title = cleanField(productTitle)
    .replace(/[/\\?%*:|"<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return `${title || path.basename(filePath, ext)}${index + 1}${ext}`;
}

function resolveLocalAssetPath(url: string): string | null {
  const cleanUrl = url.split("?")[0] || "";
  if (!cleanUrl.startsWith("/assets/")) return null;
  const rel = decodeURIComponent(cleanUrl.slice("/assets/".length)).replace(
    /\\/g,
    "/",
  );
  if (!rel || rel.includes("..")) {
    throw new Error("Media 图片路径无效");
  }
  return path.join(DATA_DIR_PATH, rel);
}

async function uploadLocalImageToShopify(
  shopDomain: string,
  accessToken: string,
  filePath: string,
  filenameOverride?: string,
): Promise<string> {
  const filename = filenameOverride || path.basename(filePath);
  const mimeType = mimeTypeFromFilename(filename);
  const createJson = await shopifyGraphql<ShopifyStagedUploadsCreateResponse>(
    shopDomain,
    accessToken,
    `mutation CreateMediaUploadTarget($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      input: [
        {
          filename,
          mimeType,
          httpMethod: "POST",
          resource: "IMAGE",
        },
      ],
    },
  );
  assertNoTopLevelGraphqlErrors(createJson.errors);
  const payload = createJson.data?.stagedUploadsCreate;
  const uploadErrors = normalizeUserErrors(payload?.userErrors);
  if (uploadErrors.length) {
    throw new Error(`Shopify Media 暂存失败：${uploadErrors.join("；")}`);
  }
  const target = payload?.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) {
    throw new Error("Shopify 未返回 Media 上传地址");
  }

  const file = await fs.readFile(filePath);
  const form = new FormData();
  for (const param of target.parameters || []) {
    form.append(param.name, param.value);
  }
  form.append("file", new Blob([file], { type: mimeType }), filename);

  const uploadRes = await fetch(target.url, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(
      `Shopify Media 上传失败：HTTP ${uploadRes.status} ${text.slice(0, 200)}`,
    );
  }
  return target.resourceUrl;
}

function mimeTypeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function isStagedUploadAccessDeniedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /access denied/i.test(message) && /stagedUploadsCreate/i.test(message);
}

async function shopifyGraphql<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const domain = normalizeShopDomain(shopDomain);
  const endpoint = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`[Shopify GraphQL] HTTP ${response.status} 错误响应:`, text.slice(0, 500));
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Shopify 鉴权失败 (HTTP ${response.status})，请检查 Token 权限。响应: ${text.slice(0, 200)}`);
    }
    throw new Error(`Shopify 请求失败：HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Shopify 返回不是有效 JSON：${text.slice(0, 300)}`);
  }
}

async function shopifyRestGet<T>(
  shopDomain: string,
  accessToken: string,
  pathWithQuery: string,
): Promise<T> {
  const domain = normalizeShopDomain(shopDomain);
  const path = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const endpoint = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`[Shopify REST] HTTP ${response.status} 错误响应:`, text.slice(0, 500));
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Shopify 鉴权失败 (HTTP ${response.status})，请检查 Token 权限。响应: ${text.slice(0, 200)}`);
    }
    throw new Error(`Shopify 请求失败：HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Shopify 返回不是有效 JSON：${text.slice(0, 300)}`);
  }
}

function assertNoTopLevelGraphqlErrors(errors?: Array<{ message?: string }>) {
  if (!errors?.length) return;
  const messages = errors.map((err) => err.message || "").filter(Boolean);
  const joined = messages.join("；");
  if (/productCreate/i.test(joined) && /write_products/i.test(joined)) {
    throw new Error(
      "Shopify 授权缺少 write_products，无法创建产品。请把 write_products 放到应用的必需权限范围，发布新版本后卸载并重新安装/重新授权应用。",
    );
  }
  throw new Error(
    `Shopify GraphQL 错误：${joined}`,
  );
}

function normalizeUserErrors(
  errors?: Array<{ field?: string[]; message?: string }>,
): string[] {
  return (errors || [])
    .map((err) => {
      const field = err.field?.length ? `${err.field.join(".")}：` : "";
      return `${field}${err.message || "未知错误"}`;
    })
    .filter(Boolean);
}

function buildLinkedProductOptionMetafieldKeySet(
  productOptions: NormalizedProductOptionDraft[],
) {
  const keys = new Set<string>();
  for (const option of productOptions) {
    if (option.linkedMetafield?.namespace !== SHOPIFY_CATEGORY_METAFIELD_NAMESPACE) {
      continue;
    }
    const key = cleanField(option.linkedMetafield.key).toLowerCase();
    if (key) keys.add(key);
  }
  return keys;
}

function isCategoryMetafieldMappingLinkedToProductOption(
  mapping: ShopifyCategoryMetafieldMapping,
  linkedMetafieldKeys: Set<string>,
) {
  return mapping.keyHints.some((key) =>
    linkedMetafieldKeys.has(cleanField(key).toLowerCase()),
  );
}

async function syncShopifyCategoryMetafields(
  shopDomain: string,
  accessToken: string,
  productId: string,
  categoryId: string | null,
  input: ShopifyProductDraftInput,
  productOptions: NormalizedProductOptionDraft[],
  warnings: string[],
) {
  const initialDrafts = SHOPIFY_CATEGORY_METAFIELD_MAPPINGS.map((mapping) => ({
    mapping,
    value: cleanCategoryMetafieldValue(input[mapping.field]),
  })).filter(
    (
      draft,
    ): draft is {
      mapping: (typeof SHOPIFY_CATEGORY_METAFIELD_MAPPINGS)[number];
      value: string;
    } => Boolean(draft.value),
  );

  const linkedMetafieldKeys =
    buildLinkedProductOptionMetafieldKeySet(productOptions);
  const drafts = initialDrafts.filter((draft) => {
    if (
      !isCategoryMetafieldMappingLinkedToProductOption(
        draft.mapping,
        linkedMetafieldKeys,
      )
    ) {
      return true;
    }
    warnings.push(
      `已跳过 Shopify 类别元字段「${draft.mapping.label}」直接同步：该字段已连接到多属性选项。`,
    );
    return false;
  });

  if (!drafts.length) return;
  if (!categoryId || categoryId === SHOPIFY_UNCATEGORIZED_CATEGORY_ID) {
    warnings.push("已跳过 Shopify 类别元字段同步：商品未设置有效 Shopify 分类。");
    return;
  }

  try {
    const definitions = await ensureShopifyCategoryMetafieldDefinitions(
      shopDomain,
      accessToken,
      categoryId,
      drafts.map((draft) => draft.mapping),
      warnings,
    );
    const metafields: Array<{
      ownerId: string;
      namespace: string;
      key: string;
      type: string;
      value: string;
    }> = [];

    const builtMetafields = await mapWithConcurrency(drafts, 4, async (draft) => {
      const localWarnings: string[] = [];
      const definition = findShopifyCategoryMetafieldDefinition(
        definitions,
        draft.mapping,
      );
      if (!definition?.key) {
        localWarnings.push(
          `未在 Shopify 分类定义中找到「${draft.mapping.label}」类别元字段，已跳过该字段。`,
        );
        return { metafield: null, warnings: localWarnings };
      }
      const type = cleanField(definition.type?.name) || "single_line_text_field";
      const value = await buildShopifyCategoryMetafieldValue(
        shopDomain,
        accessToken,
        categoryId,
        definition,
        draft.value,
        localWarnings,
      );
      if (!value) return { metafield: null, warnings: localWarnings };
      return {
        metafield: {
          ownerId: productId,
          namespace:
            definition.namespace || SHOPIFY_CATEGORY_METAFIELD_NAMESPACE,
          key: definition.key,
          type,
          value,
        },
        warnings: localWarnings,
      };
    });
    for (const built of builtMetafields) {
      warnings.push(...built.warnings);
      if (built.metafield) metafields.push(built.metafield);
    }

    if (!metafields.length) return;

    let syncedCount = 0;
    for (const metafield of metafields) {
      const json = await shopifyGraphql<ShopifyMetafieldsSetResponse>(
        shopDomain,
        accessToken,
        `mutation SetBuqiqiCategoryMetafield($metafields: [MetafieldsSetInput!]!) {
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
            }
          }
        }`,
        { metafields: [metafield] },
      );
      const topLevelErrors = formatGraphqlMessages(json.errors);
      if (topLevelErrors) {
        warnings.push(
          `Shopify category metafield ${metafield.key} sync failed, skipped: ${topLevelErrors}`,
        );
        continue;
      }
      const userErrors = normalizeUserErrors(json.data?.metafieldsSet?.userErrors);
      if (userErrors.length) {
        warnings.push(
          `Shopify category metafield ${metafield.key} sync failed, skipped: ${userErrors.join("; ")}`,
        );
        continue;
      }
      syncedCount += json.data?.metafieldsSet?.metafields?.length || 0;
    }
    if (syncedCount > 0) {
      warnings.push(`Synced ${syncedCount} Shopify category metafields.`);
    }
  } catch (e) {
    warnings.push(
      `Shopify 类别元字段同步失败：${formatUnknownError(e)}。如果提示 Access denied，请在应用权限中加入 read/write_metaobjects 与 read/write_metaobject_definitions 后重新授权。`,
    );
  }
}

export async function syncShopifyProductCategorySizeMetafield(opts: {
  shopDomain: string;
  accessToken: string;
  productId: string;
  categoryId: string | null;
  categorySize: string;
}) {
  const warnings: string[] = [];
  await syncShopifyCategoryMetafields(
    opts.shopDomain,
    opts.accessToken,
    opts.productId,
    opts.categoryId,
    {
      title: "",
      description: "",
      categorySize: opts.categorySize,
    },
    [],
    warnings,
  );
  return { ok: true, warnings };
}

async function ensureShopifyCategoryMetafieldDefinitions(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  mappings: ReadonlyArray<(typeof SHOPIFY_CATEGORY_METAFIELD_MAPPINGS)[number]>,
  warnings: string[],
): Promise<ShopifyMetafieldDefinitionNode[]> {
  const definitions = await fetchShopifyCategoryMetafieldDefinitions(
    shopDomain,
    accessToken,
    categoryId,
    warnings,
  );
  const missing = mappings.filter(
    (mapping) =>
      !findShopifyCategoryMetafieldDefinition(definitions, mapping),
  );
  if (!missing.length) return dedupeShopifyMetafieldDefinitions(definitions);

  const templates = await fetchShopifyCategoryMetafieldDefinitionTemplates(
    shopDomain,
    accessToken,
    categoryId,
    warnings,
  );
  const enabledDefinitions = await mapWithConcurrency(missing, 4, async (mapping) => {
    const template = findShopifyCategoryMetafieldDefinition(templates, mapping);
    if (!template?.id) return null;
    return enableShopifyStandardMetafieldDefinition(
      shopDomain,
      accessToken,
      template.id,
      warnings,
    );
  });
  for (const enabled of enabledDefinitions) {
    if (enabled) definitions.push(enabled);
  }
  return dedupeShopifyMetafieldDefinitions(definitions);
}

async function fetchShopifyCategoryMetafieldDefinitionsForHierarchy(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  warnings: string[],
): Promise<ShopifyMetafieldDefinitionNode[]> {
  const categoryIds = buildShopifyCategoryHierarchyIds(categoryId).reverse();
  const results = await mapWithConcurrency(categoryIds, 3, (id) =>
    fetchShopifyCategoryMetafieldDefinitions(shopDomain, accessToken, id, warnings),
  );
  return dedupeShopifyMetafieldDefinitions(results.flat());
}

async function fetchShopifyCategoryMetafieldDefinitions(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  warnings: string[],
): Promise<ShopifyMetafieldDefinitionNode[]> {
  const json = await shopifyGraphql<ShopifyMetafieldDefinitionsResponse>(
    shopDomain,
    accessToken,
    `query BuqiqiCategoryMetafieldDefinitions(
      $constraintSubtype: MetafieldDefinitionConstraintSubtypeIdentifier!
    ) {
      metafieldDefinitions(
        first: 250
        ownerType: PRODUCT
        namespace: "shopify"
        constraintSubtype: $constraintSubtype
        constraintStatus: CONSTRAINED_ONLY
      ) {
        nodes {
          id
          name
          namespace
          key
          type {
            name
          }
          validations {
            name
            value
          }
        }
      }
    }`,
    { constraintSubtype: { key: "category", value: categoryId } },
  );
  const topLevelErrors = formatGraphqlMessages(json.errors);
  if (topLevelErrors) {
    warnings.push(`读取 Shopify 类别元字段定义失败：${topLevelErrors}`);
    return [];
  }
  return json.data?.metafieldDefinitions?.nodes || [];
}

async function fetchShopifyCategoryMetafieldDefinitionTemplatesForHierarchy(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  warnings: string[],
): Promise<ShopifyMetafieldDefinitionNode[]> {
  const categoryIds = buildShopifyCategoryHierarchyIds(categoryId).reverse();
  const results = await mapWithConcurrency(categoryIds, 3, (id) =>
    fetchShopifyCategoryMetafieldDefinitionTemplates(
      shopDomain,
      accessToken,
      id,
      warnings,
    ),
  );
  return dedupeShopifyMetafieldDefinitions(results.flat());
}

async function fetchShopifyCategoryMetafieldDefinitionTemplates(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  warnings: string[],
): Promise<ShopifyMetafieldDefinitionNode[]> {
  const json =
    await shopifyGraphql<ShopifyStandardMetafieldDefinitionTemplatesResponse>(
      shopDomain,
      accessToken,
      `query BuqiqiCategoryMetafieldTemplates(
        $constraintSubtype: MetafieldDefinitionConstraintSubtypeIdentifier!
      ) {
        standardMetafieldDefinitionTemplates(
          first: 250
          constraintSubtype: $constraintSubtype
          constraintStatus: CONSTRAINED_ONLY
          excludeActivated: false
        ) {
          nodes {
            id
            name
            namespace
            key
            type {
              name
            }
          }
        }
      }`,
      { constraintSubtype: { key: "category", value: categoryId } },
    );
  const topLevelErrors = formatGraphqlMessages(json.errors);
  if (topLevelErrors) {
    warnings.push(`读取 Shopify 标准类别元字段模板失败：${topLevelErrors}`);
    return [];
  }
  return json.data?.standardMetafieldDefinitionTemplates?.nodes || [];
}

async function fetchShopifyProductCustomMetafieldDefinitions(
  shopDomain: string,
  accessToken: string,
  warnings: string[],
): Promise<ShopifyMetafieldDefinitionNode[]> {
  const json = await shopifyGraphql<ShopifyMetafieldDefinitionsResponse>(
    shopDomain,
    accessToken,
    `query BuqiqiProductCustomMetafieldDefinitions {
      metafieldDefinitions(first: 250, ownerType: PRODUCT) {
        nodes {
          id
          name
          namespace
          key
          type {
            name
          }
          validations {
            name
            value
          }
        }
      }
    }`,
  );
  const topLevelErrors = formatGraphqlMessages(json.errors);
  if (topLevelErrors) {
    warnings.push(`读取 Shopify 自定义元字段定义失败：${topLevelErrors}`);
    return [];
  }
  return (json.data?.metafieldDefinitions?.nodes || []).filter(
    (definition) => definition.namespace !== SHOPIFY_CATEGORY_METAFIELD_NAMESPACE,
  );
}

async function enableShopifyStandardMetafieldDefinition(
  shopDomain: string,
  accessToken: string,
  templateId: string,
  warnings: string[],
): Promise<ShopifyMetafieldDefinitionNode | null> {
  const json = await shopifyGraphql<ShopifyStandardMetafieldDefinitionEnableResponse>(
    shopDomain,
    accessToken,
    `mutation EnableBuqiqiCategoryMetafield(
      $id: ID!
      $ownerType: MetafieldOwnerType!
      $pin: Boolean!
    ) {
      standardMetafieldDefinitionEnable(
        id: $id
        ownerType: $ownerType
        pin: $pin
      ) {
        createdDefinition {
          id
          name
          namespace
          key
          type {
            name
          }
          validations {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    { id: templateId, ownerType: "PRODUCT", pin: false },
  );
  const topLevelErrors = formatGraphqlMessages(json.errors);
  if (topLevelErrors) {
    warnings.push(`启用 Shopify 标准类别元字段失败：${topLevelErrors}`);
    return null;
  }
  const userErrors = normalizeUserErrors(
    json.data?.standardMetafieldDefinitionEnable?.userErrors,
  );
  if (userErrors.length) {
    warnings.push(`启用 Shopify 标准类别元字段失败：${userErrors.join("；")}`);
    return null;
  }
  return json.data?.standardMetafieldDefinitionEnable?.createdDefinition || null;
}

async function buildShopifyCategoryMetafieldValue(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  definition: ShopifyMetafieldDefinitionNode,
  rawValue: string,
  warnings: string[],
): Promise<string | null> {
  const type = cleanField(definition.type?.name) || "single_line_text_field";
  const values = splitCategoryMetafieldValues(rawValue);
  if (!values.length) return null;

  if (isShopifyTaxonomyValueReferenceType(type)) {
    const ids: string[] = [];
    const fieldKey = cleanField(definition.key) || "taxonomy_reference";
    for (const value of values) {
      if (isShopifyTaxonomyValueId(value)) {
        ids.push(value);
        continue;
      }
      const inferredValue = inferShopifyCategoryValueForField(
        type,
        fieldKey,
        value,
      );
      const id = await resolveShopifyTaxonomyValueId(
        shopDomain,
        accessToken,
        categoryId,
        type,
        fieldKey,
        value,
        inferredValue,
        warnings,
      );
      if (id) ids.push(id);
    }
    if (!ids.length) {
      warnings.push(
        `Skipped Shopify category metafield ${definition.name || definition.key}: no product taxonomy value matched "${rawValue}".`,
      );
      return null;
    }
    return type.startsWith("list.") ? JSON.stringify(ids) : ids[0];
  }

  if (/metaobject_reference$/.test(type)) {
    const metaobjectType = getShopifyCategoryMetaobjectType(definition);
    if (!metaobjectType) {
      warnings.push(`无法识别 Shopify 类别元字段「${definition.name || definition.key}」的值类型。`);
      return null;
    }
    const ids: string[] = [];
    for (const value of values) {
      if (isShopifyMetaobjectId(value)) {
        ids.push(value);
        continue;
      }
      const id = await findOrCreateShopifyCategoryMetaobject(
        shopDomain,
        accessToken,
        categoryId,
        metaobjectType,
        value,
        warnings,
      );
      if (id) ids.push(id);
    }
    if (!ids.length) return null;
    return type.startsWith("list.") ? JSON.stringify(ids) : ids[0];
  }

  if (type.startsWith("list.")) {
    return JSON.stringify(values);
  }
  return cleanField(rawValue);
}

async function findOrCreateShopifyCategoryMetaobject(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  type: string,
  value: string,
  warnings: string[],
): Promise<string | null> {
  const definition = await ensureShopifyCategoryMetaobjectDefinition(
    shopDomain,
    accessToken,
    type,
    warnings,
  );
  if (!definition?.id) return null;

  const candidates = getCategoryValueCandidates(value);
  const existing = await fetchShopifyCategoryMetaobjects(
    shopDomain,
    accessToken,
    type,
    warnings,
  );
  const match = existing.find((node) =>
    candidates.some((candidate) => shopifyMetaobjectMatchesValue(node, candidate)),
  );
  if (match?.id) return match.id;

  const fields = await buildShopifyCategoryMetaobjectFields(
    shopDomain,
    accessToken,
    categoryId,
    definition,
    type,
    value,
    warnings,
  );
  if (!fields.length) return null;
  const json = await shopifyGraphql<ShopifyMetaobjectCreateResponse>(
    shopDomain,
    accessToken,
    `mutation CreateBuqiqiCategoryMetaobject($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
          displayName
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      metaobject: {
        type,
        handle: makeShopifyMetaobjectHandle(type, value),
        fields,
      },
    },
  );
  const topLevelErrors = formatGraphqlMessages(json.errors);
  if (topLevelErrors) {
    warnings.push(`创建 Shopify 类别元字段值「${value}」失败：${topLevelErrors}`);
    return null;
  }
  const userErrors = normalizeUserErrors(json.data?.metaobjectCreate?.userErrors);
  if (userErrors.length) {
    const retry = await fetchShopifyCategoryMetaobjects(
      shopDomain,
      accessToken,
      type,
      warnings,
    );
    const retryMatch = retry.find((node) =>
      candidates.some((candidate) => shopifyMetaobjectMatchesValue(node, candidate)),
    );
    if (retryMatch?.id) return retryMatch.id;
    warnings.push(`创建 Shopify 类别元字段值「${value}」失败：${userErrors.join("；")}`);
    return null;
  }
  return json.data?.metaobjectCreate?.metaobject?.id || null;
}

async function ensureShopifyCategoryMetaobjectDefinition(
  shopDomain: string,
  accessToken: string,
  type: string,
  warnings: string[],
): Promise<ShopifyMetaobjectDefinitionNode | null> {
  const existing = await fetchShopifyCategoryMetaobjectDefinition(
    shopDomain,
    accessToken,
    type,
    warnings,
  );
  if (existing?.id) return existing;

  const json =
    await shopifyGraphql<ShopifyStandardMetaobjectDefinitionEnableResponse>(
      shopDomain,
      accessToken,
      `mutation EnableBuqiqiCategoryMetaobjectDefinition($type: String!) {
        standardMetaobjectDefinitionEnable(type: $type) {
          metaobjectDefinition {
            id
            type
            displayNameKey
            fieldDefinitions {
              key
              name
              required
              type {
                name
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { type },
    );
  const topLevelErrors = formatGraphqlMessages(json.errors);
  if (topLevelErrors) {
    warnings.push(`启用 Shopify 类别元字段值定义「${type}」失败：${topLevelErrors}`);
    return null;
  }
  const userErrors = normalizeUserErrors(
    json.data?.standardMetaobjectDefinitionEnable?.userErrors,
  );
  if (userErrors.length) {
    const retry = await fetchShopifyCategoryMetaobjectDefinition(
      shopDomain,
      accessToken,
      type,
      warnings,
    );
    if (retry?.id) return retry;
    warnings.push(
      `启用 Shopify 类别元字段值定义「${type}」失败：${userErrors.join("；")}`,
    );
    return null;
  }
  return (
    json.data?.standardMetaobjectDefinitionEnable?.metaobjectDefinition ||
    (await fetchShopifyCategoryMetaobjectDefinition(
      shopDomain,
      accessToken,
      type,
      warnings,
    ))
  );
}

async function fetchShopifyCategoryMetaobjectDefinition(
  shopDomain: string,
  accessToken: string,
  type: string,
  warnings: string[],
): Promise<ShopifyMetaobjectDefinitionNode | null> {
  const json = await shopifyGraphql<ShopifyMetaobjectDefinitionByTypeResponse>(
    shopDomain,
    accessToken,
    `query BuqiqiCategoryMetaobjectDefinition($type: String!) {
      metaobjectDefinitionByType(type: $type) {
        id
        type
        displayNameKey
        fieldDefinitions {
          key
          name
          required
          type {
            name
          }
        }
      }
    }`,
    { type },
  );
  const topLevelErrors = formatGraphqlMessages(json.errors);
  if (topLevelErrors) {
    warnings.push(`读取 Shopify 类别元字段值定义「${type}」失败：${topLevelErrors}`);
    return null;
  }
  return json.data?.metaobjectDefinitionByType || null;
}

async function fetchShopifyMetaobjectDefinitionById(
  shopDomain: string,
  accessToken: string,
  id: string,
  warnings: string[],
): Promise<ShopifyMetaobjectDefinitionNode | null> {
  const json = await shopifyGraphql<ShopifyMetaobjectDefinitionByIdResponse>(
    shopDomain,
    accessToken,
    `query BuqiqiMetaobjectDefinitionById($id: ID!) {
      metaobjectDefinition(id: $id) {
        id
        type
        displayNameKey
        fieldDefinitions {
          key
          name
          required
          type {
            name
          }
        }
      }
    }`,
    { id },
  );
  const topLevelErrors = formatGraphqlMessages(json.errors);
  if (topLevelErrors) {
    warnings.push(`读取 Shopify Metaobject 定义失败：${topLevelErrors}`);
    return null;
  }
  return json.data?.metaobjectDefinition || null;
}

async function fetchShopifyCategoryMetaobjects(
  shopDomain: string,
  accessToken: string,
  type: string,
  warnings: string[],
): Promise<ShopifyMetaobjectNode[]> {
  const json = await shopifyGraphql<ShopifyMetaobjectsResponse>(
    shopDomain,
    accessToken,
    `query BuqiqiCategoryMetaobjects($type: String!) {
      metaobjects(type: $type, first: 250) {
        nodes {
          id
          handle
          displayName
          fields {
            key
            value
          }
        }
      }
    }`,
    { type },
  );
  const topLevelErrors = formatGraphqlMessages(json.errors);
  if (topLevelErrors) {
    warnings.push(`读取 Shopify 类别元字段值失败：${topLevelErrors}`);
    return [];
  }
  return json.data?.metaobjects?.nodes || [];
}

function findShopifyCategoryMetafieldDefinition(
  definitions: ShopifyMetafieldDefinitionNode[],
  mapping: (typeof SHOPIFY_CATEGORY_METAFIELD_MAPPINGS)[number],
): ShopifyMetafieldDefinitionNode | null {
  const exactKey = definitions.find(
    (definition) =>
      definition.namespace === SHOPIFY_CATEGORY_METAFIELD_NAMESPACE &&
      mapping.keyHints.some((key) => normalizeMetafieldMatchText(definition.key) === normalizeMetafieldMatchText(key)),
  );
  if (exactKey) return exactKey;

  return (
    definitions.find((definition) => {
      if (definition.namespace !== SHOPIFY_CATEGORY_METAFIELD_NAMESPACE) return false;
      const key = normalizeMetafieldMatchText(definition.key);
      const name = normalizeMetafieldMatchText(definition.name);
      return [...mapping.keyHints, ...mapping.nameHints].some((hint) => {
        const normalized = normalizeMetafieldMatchText(hint);
        return key.includes(normalized) || name.includes(normalized);
      });
    }) || null
  );
}

function findShopifyCustomMetafieldDefinitions(
  definitions: ShopifyMetafieldDefinitionNode[],
  mapping: ShopifyCategoryMetafieldMapping,
): ShopifyMetafieldDefinitionNode[] {
  return definitions.filter((definition) => {
    if (definition.namespace === SHOPIFY_CATEGORY_METAFIELD_NAMESPACE) {
      return false;
    }
    const key = normalizeMetafieldMatchText(definition.key);
    const name = normalizeMetafieldMatchText(definition.name);
    return [...mapping.keyHints, ...mapping.nameHints].some((hint) => {
      const normalizedHint = normalizeMetafieldMatchText(hint);
      return key.includes(normalizedHint) || name.includes(normalizedHint);
    });
  });
}

async function buildShopifyMetafieldDefinitionStoreOptions(
  shopDomain: string,
  accessToken: string,
  definition: ShopifyMetafieldDefinitionNode,
  warnings: string[],
): Promise<ShopifyCategoryMetafieldOption[]> {
  const choiceOptions = parseShopifyMetafieldChoiceOptions(definition);
  if (choiceOptions.length) return choiceOptions;

  const type = cleanField(definition.type?.name);
  if (!/metaobject_reference$/.test(type)) return [];

  const metaobjectType = await resolveShopifyMetaobjectDefinitionType(
    shopDomain,
    accessToken,
    definition,
    warnings,
  );
  if (!metaobjectType) return [];

  const metaobjects = await fetchShopifyCategoryMetaobjects(
    shopDomain,
    accessToken,
    metaobjectType,
    warnings,
  );
  return metaobjects
    .map((node) => {
      const label = cleanField(node.displayName) || cleanField(node.handle);
      if (!label) return null;
      return {
        id: node.id,
        label,
        value: label,
        attributeName: cleanField(definition.name) || cleanField(definition.key),
      } satisfies ShopifyCategoryMetafieldOption;
    })
    .filter((option): option is ShopifyCategoryMetafieldOption => Boolean(option));
}

function parseShopifyMetafieldChoiceOptions(
  definition: ShopifyMetafieldDefinitionNode,
): ShopifyCategoryMetafieldOption[] {
  const validation = definition.validations?.find((item) => {
    const name = normalizeMetafieldMatchText(item.name);
    return name === "choices" || name === "choice";
  });
  const choices = parseShopifyChoiceValidationValue(validation?.value);
  const attributeName = cleanField(definition.name) || cleanField(definition.key);
  return choices.map((choice, index) => ({
    id: `${definition.id}:choice:${index}:${choice}`,
    label: choice,
    value: choice,
    attributeName,
  }));
}

function parseShopifyChoiceValidationValue(value?: string | null): string[] {
  const cleaned = cleanField(value);
  if (!cleaned) return [];

  const fromJson = parseShopifyChoiceJson(cleaned);
  if (fromJson.length) return fromJson;

  return Array.from(
    new Set(
      cleaned
        .split(/[，,;；\n|]/)
        .map((item) => cleanField(item).replace(/^["']|["']$/g, ""))
        .filter(Boolean),
    ),
  );
}

function parseShopifyChoiceJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return Array.from(
        new Set(
          parsed
            .map((item) =>
              typeof item === "string"
                ? item
                : item && typeof item === "object"
                  ? String(
                      (item as { value?: unknown; label?: unknown; name?: unknown })
                        .value ??
                        (item as { label?: unknown }).label ??
                        (item as { name?: unknown }).name ??
                        "",
                    )
                  : "",
            )
            .map(cleanField)
            .filter(Boolean),
        ),
      );
    }
  } catch {
    return [];
  }
  return [];
}

async function resolveShopifyMetaobjectDefinitionType(
  shopDomain: string,
  accessToken: string,
  definition: ShopifyMetafieldDefinitionNode,
  warnings: string[],
): Promise<string> {
  const type = getShopifyCategoryMetaobjectType(definition);
  if (type) return type;

  const idValidation = definition.validations?.find(
    (validation) =>
      validation.name === "metaobject_definition_id" &&
      cleanField(validation.value),
  );
  const definitionId = cleanField(idValidation?.value);
  if (!definitionId) return "";

  const metaobjectDefinition = await fetchShopifyMetaobjectDefinitionById(
    shopDomain,
    accessToken,
    definitionId,
    warnings,
  );
  return cleanField(metaobjectDefinition?.type);
}

function mergeShopifyCategoryMetafieldOptions(
  options: ShopifyCategoryMetafieldOption[],
): ShopifyCategoryMetafieldOption[] {
  const byValue = new Map<string, ShopifyCategoryMetafieldOption>();
  for (const option of options) {
    const key = normalizeMetafieldMatchText(option.value || option.label);
    if (!key || byValue.has(key)) continue;
    byValue.set(key, option);
  }
  return Array.from(byValue.values());
}

function dedupeShopifyMetafieldDefinitions(
  definitions: ShopifyMetafieldDefinitionNode[],
) {
  const byKey = new Map<string, ShopifyMetafieldDefinitionNode>();
  for (const definition of definitions) {
    if (!definition.namespace || !definition.key) continue;
    const key = `${definition.namespace}.${definition.key}`;
    if (!byKey.has(key)) byKey.set(key, definition);
  }
  return Array.from(byKey.values());
}

function getShopifyCategoryMetaobjectType(
  definition: ShopifyMetafieldDefinitionNode,
): string {
  const typedValidation = definition.validations?.find(
    (validation) =>
      validation.name === "metaobject_definition_type" &&
      cleanField(validation.value),
  );
  if (typedValidation?.value) return typedValidation.value;
  if (definition.namespace === SHOPIFY_CATEGORY_METAFIELD_NAMESPACE) {
    return definition.key ? `shopify--${definition.key}` : "";
  }
  return "";
}

function getShopifyMetaobjectDisplayFieldKey(
  definition: ShopifyMetaobjectDefinitionNode,
): string {
  const displayNameKey = cleanField(definition.displayNameKey);
  if (displayNameKey) return displayNameKey;

  const labelField = definition.fieldDefinitions?.find(
    (field) => cleanField(field.key) === "label",
  );
  if (labelField?.key) return labelField.key;

  const requiredTextField = definition.fieldDefinitions?.find(
    (field) =>
      field.required &&
      cleanField(field.key) &&
      cleanField(field.type?.name) === "single_line_text_field",
  );
  if (requiredTextField?.key) return requiredTextField.key;

  const firstTextField = definition.fieldDefinitions?.find(
    (field) =>
      cleanField(field.key) &&
      cleanField(field.type?.name) === "single_line_text_field",
  );
  return firstTextField?.key || "label";
}

type ShopifyCategoryMetaobjectFieldInput = { key: string; value: string };

type ShopifyCategoryMetaobjectCreateRecipe = {
  name: string;
  matches: (normalizedType: string) => boolean;
  baseFieldKeys: (type: string) => string[];
  inferFieldValue: (type: string, fieldKey: string, value: string) => string;
  shouldSkipField: (type: string, fieldKey: string, value: string) => boolean;
};

const DEFAULT_SHOPIFY_CATEGORY_METAOBJECT_CREATE_RECIPE: ShopifyCategoryMetaobjectCreateRecipe = {
  name: "generic",
  matches: () => true,
  baseFieldKeys: getShopifyCategoryBaseFieldKeys,
  inferFieldValue: inferShopifyCategoryBaseValue,
  shouldSkipField: shouldSkipShopifyCategoryMetaobjectField,
};

function createShopifyBaseMetaobjectRecipe(
  name: string,
  typeHints: string[],
  baseFieldKeys: string[],
): ShopifyCategoryMetaobjectCreateRecipe {
  return {
    name,
    matches: (normalizedType) =>
      typeHints.some((hint) => normalizedType.includes(hint)),
    baseFieldKeys: () => [...baseFieldKeys],
    inferFieldValue: inferShopifyCategoryBaseValue,
    shouldSkipField: () => false,
  };
}

const SHOPIFY_CATEGORY_METAOBJECT_CREATE_RECIPES: ShopifyCategoryMetaobjectCreateRecipe[] = [
  {
    name: "color-pattern",
    matches: (normalizedType) => normalizedType.includes("colorpattern"),
    baseFieldKeys: () => ["base_color", "base_pattern"],
    inferFieldValue: inferShopifyColorPatternFieldValue,
    shouldSkipField: () => false,
  },
  createShopifyBaseMetaobjectRecipe("fabric", ["fabric", "material"], [
    "base_fabric",
  ]),
  createShopifyBaseMetaobjectRecipe("age-group", ["agegroup"], [
    "base_age_group",
  ]),
  createShopifyBaseMetaobjectRecipe("dress-occasion", ["dressoccasion"], [
    "base_dress_occasion",
  ]),
  createShopifyBaseMetaobjectRecipe("dress-style", ["dressstyle"], [
    "base_dress_style",
  ]),
  createShopifyBaseMetaobjectRecipe("neckline", ["neckline"], [
    "base_neckline",
  ]),
  createShopifyBaseMetaobjectRecipe(
    "skirt-dress-length-type",
    ["skirtdresslengthtype", "dresslengthtype", "dresslength"],
    ["base_skirt_dress_length_type"],
  ),
  createShopifyBaseMetaobjectRecipe("sleeve-length-type", ["sleevelengthtype"], [
    "base_sleeve_length_type",
  ]),
  DEFAULT_SHOPIFY_CATEGORY_METAOBJECT_CREATE_RECIPE,
];

function getShopifyCategoryMetaobjectCreateRecipe(
  type: string,
): ShopifyCategoryMetaobjectCreateRecipe {
  const normalizedType = normalizeMetafieldMatchText(type);
  return (
    SHOPIFY_CATEGORY_METAOBJECT_CREATE_RECIPES.find((recipe) =>
      recipe.matches(normalizedType),
    ) || DEFAULT_SHOPIFY_CATEGORY_METAOBJECT_CREATE_RECIPE
  );
}

async function buildShopifyCategoryMetaobjectFields(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  definition: ShopifyMetaobjectDefinitionNode,
  type: string,
  value: string,
  warnings: string[],
): Promise<ShopifyCategoryMetaobjectFieldInput[]> {
  const recipe = getShopifyCategoryMetaobjectCreateRecipe(type);
  const fields = new Map<string, string>();
  const displayFieldKey = getShopifyMetaobjectDisplayFieldKey(definition);
  const displayValue = cleanField(value);
  if (displayFieldKey && displayValue) fields.set(displayFieldKey, displayValue);

  const fieldDefinitions = definition.fieldDefinitions || [];
  const hasFieldDefinitions = fieldDefinitions.length > 0;
  const requiredKeys = new Set<string>();
  for (const field of fieldDefinitions) {
    const key = cleanField(field.key);
    if (!key) continue;
    if (field.required) requiredKeys.add(key);
  }
  for (const key of recipe.baseFieldKeys(type)) {
    if (
      !hasFieldDefinitions ||
      fieldDefinitions.some((field) => cleanField(field.key) === key)
    ) {
      requiredKeys.add(key);
    }
  }

  for (const key of requiredKeys) {
    if (key === displayFieldKey && fields.get(key)) continue;
    if (recipe.shouldSkipField(type, key, value)) continue;
    const fieldDefinition = fieldDefinitions.find(
      (field) => cleanField(field.key) === key,
    );
    const fieldType = cleanField(fieldDefinition?.type?.name);
    const inferredValue = recipe.inferFieldValue(type, key, value);
    const fieldValue = await buildShopifyCategoryMetaobjectFieldValue(
      shopDomain,
      accessToken,
      categoryId,
      type,
      key,
      fieldType,
      value,
      inferredValue,
      warnings,
    );
    if (!fieldValue) return [];
    fields.set(key, fieldValue);
  }

  return Array.from(fields.entries())
    .filter(([, fieldValue]) => cleanField(fieldValue))
    .map(([key, fieldValue]) => ({ key, value: fieldValue }));
}

async function buildShopifyCategoryMetaobjectFieldValue(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  type: string,
  fieldKey: string,
  fieldType: string,
  rawValue: string,
  inferredValue: string,
  warnings: string[],
): Promise<string | null> {
  const value = cleanField(inferredValue);
  if (!value) return null;

  const mustUseTaxonomyValue =
    fieldKey.startsWith("base_") || isShopifyTaxonomyValueReferenceType(fieldType);
  if (!mustUseTaxonomyValue) return value;

  const taxonomyRawValue = fieldKey === "base_pattern" ? value : rawValue;
  const taxonomyValueId = await resolveShopifyTaxonomyValueId(
    shopDomain,
    accessToken,
    categoryId,
    type,
    fieldKey,
    taxonomyRawValue,
    value,
    warnings,
  );
  if (!taxonomyValueId) {
    warnings.push(
      `Skipped Shopify category value ${type}.${fieldKey}: no product taxonomy value matched "${value}".`,
    );
    return null;
  }

  return fieldType.startsWith("list.")
    ? JSON.stringify([taxonomyValueId])
    : taxonomyValueId;
}

function isShopifyTaxonomyValueReferenceType(type: string): boolean {
  const normalized = normalizeMetafieldMatchText(type);
  return (
    normalized.includes("taxonomyvaluereference") ||
    normalized.includes("producttaxonomyvaluereference")
  );
}

function isShopifyMetaobjectId(value: string): boolean {
  return /^gid:\/\/shopify\/Metaobject\//.test(cleanField(value));
}

function isShopifyTaxonomyValueId(value: string): boolean {
  return /^gid:\/\/shopify\/TaxonomyValue\//.test(cleanField(value));
}

async function resolveShopifyTaxonomyValueId(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  type: string,
  fieldKey: string,
  rawValue: string,
  inferredValue: string,
  warnings: string[],
): Promise<string | null> {
  const attributes = await fetchShopifyTaxonomyCategoryAttributesForHierarchy(
    shopDomain,
    accessToken,
    categoryId,
    warnings,
  );
  if (!attributes.length) return null;

  const candidates = buildShopifyTaxonomyValueCandidates(
    rawValue,
    inferredValue,
    type,
    fieldKey,
  );
  const hintedAttributes = attributes.filter((attribute) =>
    shopifyTaxonomyAttributeMatchesField(attribute, fieldKey, type),
  );

  if (hintedAttributes.length) {
    const hintedMatch = findShopifyTaxonomyValueInAttributes(
      hintedAttributes,
      candidates,
    );
    if (hintedMatch?.id) return hintedMatch.id;
  }
  return findShopifyTaxonomyValueInAttributes(attributes, candidates)?.id || null;
}

async function fetchShopifyTaxonomyCategoryAttributesForHierarchy(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  warnings: string[],
): Promise<ShopifyTaxonomyAttributeNode[]> {
  const groups = await fetchShopifyTaxonomyCategoryAttributeGroupsForHierarchy(
    shopDomain,
    accessToken,
    categoryId,
    warnings,
  );
  return dedupeShopifyTaxonomyAttributes(groups.flatMap((group) => group.attributes));
}

async function fetchShopifyTaxonomyCategoryAttributeGroupsForHierarchy(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  warnings: string[],
): Promise<ShopifyTaxonomyCategoryAttributeGroup[]> {
  const ids = buildShopifyCategoryHierarchyIds(categoryId);
  const groups = await mapWithConcurrency(ids, 3, async (id) => {
    const attributes = await fetchShopifyTaxonomyCategoryAttributes(
      shopDomain,
      accessToken,
      id,
      warnings,
    );
    return {
      id,
      name: await fetchShopifyTaxonomyCategoryName(
        shopDomain,
        accessToken,
        id,
        warnings,
      ),
      attributes,
    };
  });
  return groups.filter((group) => group.attributes.length > 0 || group.name);
}

async function fetchShopifyTaxonomyCategoryAttributes(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  warnings: string[],
): Promise<ShopifyTaxonomyAttributeNode[]> {
  const cacheKey = `${shopDomain}:${categoryId}:${shopifyTokenCacheKeyPart(accessToken)}`;
  let cached = shopifyTaxonomyCategoryAttributesCache.get(cacheKey);
  if (!cached) {
    cached = fetchShopifyTaxonomyCategoryAttributesUncached(
      shopDomain,
      accessToken,
      categoryId,
      warnings,
    ).catch((err) => {
      shopifyTaxonomyCategoryAttributesCache.delete(cacheKey);
      throw err;
    });
    shopifyTaxonomyCategoryAttributesCache.set(cacheKey, cached);
  }
  return cached;
}

async function fetchShopifyTaxonomyCategoryAttributesUncached(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  warnings: string[],
): Promise<ShopifyTaxonomyAttributeNode[]> {
  const json = await shopifyGraphql<ShopifyTaxonomyCategoryAttributesResponse>(
    shopDomain,
    accessToken,
    `query BuqiqiTaxonomyCategoryAttributes($id: ID!) {
      node(id: $id) {
        ... on TaxonomyCategory {
          id
          name
          attributes(first: 100) {
            nodes {
              __typename
              ... on TaxonomyChoiceListAttribute {
                id
                name
                values(first: 250) {
                  nodes {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { id: categoryId },
  );
  const topLevelErrors = formatGraphqlMessages(json.errors);
  if (topLevelErrors) {
    warnings.push(`Read Shopify taxonomy category attributes failed: ${topLevelErrors}`);
    return [];
  }
  return json.data?.node?.attributes?.nodes || [];
}

async function fetchShopifyTaxonomyCategoryName(
  shopDomain: string,
  accessToken: string,
  categoryId: string,
  warnings: string[],
): Promise<string | null> {
  const json = await shopifyGraphql<ShopifyTaxonomyCategoryAttributesResponse>(
    shopDomain,
    accessToken,
    `query BuqiqiTaxonomyCategoryName($id: ID!) {
      node(id: $id) {
        ... on TaxonomyCategory {
          id
          name
        }
      }
    }`,
    { id: categoryId },
  );
  const topLevelErrors = formatGraphqlMessages(json.errors);
  if (topLevelErrors) {
    warnings.push(`Read Shopify taxonomy category failed: ${topLevelErrors}`);
    return null;
  }
  return cleanField(json.data?.node?.name) || null;
}

function buildShopifyTaxonomyValueCandidates(
  rawValue: string,
  inferredValue: string,
  type: string,
  fieldKey: string,
): string[] {
  return Array.from(
    new Set(
      [
        inferredValue,
        ...getCategoryValueCandidates(inferredValue),
        rawValue,
        ...getCategoryValueCandidates(rawValue),
        ...getShopifyTaxonomyFallbackCandidates(type, fieldKey, rawValue, inferredValue),
      ]
        .map(cleanField)
        .filter(Boolean),
    ),
  );
}

function getShopifyTaxonomyFallbackCandidates(
  type: string,
  fieldKey: string,
  rawValue: string,
  inferredValue: string,
): string[] {
  const text = normalizeMetafieldMatchText(`${rawValue} ${inferredValue}`);
  const normalizedType = normalizeMetafieldMatchText(type);
  const normalizedFieldKey = normalizeMetafieldMatchText(fieldKey);
  const candidates: string[] = [];

  if (
    normalizedType.includes("colorpattern") &&
    (normalizedFieldKey === "taxonomyreference" || normalizedFieldKey.includes("pattern"))
  ) {
    candidates.push(inferShopifyCategoryBaseValue(type, "base_pattern", rawValue));
    candidates.push("Solid");
  }

  if (normalizedType.includes("dressoccasion") || normalizedFieldKey.includes("occasion")) {
    if (/prom|homecoming/.test(text)) candidates.push("Special Occasion", "Formal");
    if (/evening|formal|gala|specialoccasion/.test(text)) {
      candidates.push("Special Occasion", "Formal");
    }
    if (/wedding|bridal|bride|bridesmaid|guest/.test(text)) {
      candidates.push("Wedding", "Special Occasion");
    }
    if (/party|cocktail/.test(text)) candidates.push("Party", "Special Occasion");
  }

  if (normalizedType.includes("neckline") || normalizedFieldKey.includes("neckline")) {
    if (/spaghetti|strap/.test(text)) candidates.push("Strapless", "Other");
    if (/vneck/.test(text)) candidates.push("V-Neck", "V Neck");
    if (/offshoulder|offtheshoulder/.test(text)) candidates.push("Off Shoulder", "Off-shoulder");
  }

  if (
    normalizedType.includes("skirtdresslengthtype") ||
    normalizedType.includes("dresslength") ||
    normalizedFieldKey.includes("dresslength")
  ) {
    if (/floor|full|ankle|long|maxi/.test(text)) candidates.push("Maxi", "Long", "Other");
    if (/tea|midi/.test(text)) candidates.push("Midi");
    if (/knee/.test(text)) candidates.push("Knee", "Knee Length");
    if (/mini|short/.test(text)) candidates.push("Mini", "Short");
  }

  if (normalizedType.includes("sleevelengthtype") || normalizedFieldKey.includes("sleevelength")) {
    if (/sleeveless|strapless/.test(text)) candidates.push("Sleeveless");
    if (/short/.test(text)) candidates.push("Short Sleeve", "Short");
    if (/long/.test(text)) candidates.push("Long Sleeve", "Long");
  }

  return candidates;
}

function findShopifyTaxonomyValueInAttributes(
  attributes: ShopifyTaxonomyAttributeNode[],
  candidates: string[],
): ShopifyTaxonomyValueNode | null {
  const normalizedCandidates = candidates
    .map((candidate) => normalizeMetafieldMatchText(candidate))
    .filter(Boolean);
  if (!normalizedCandidates.length) return null;

  for (const attribute of attributes) {
    const match = attribute.values?.nodes?.find((node) =>
      normalizedCandidates.includes(normalizeMetafieldMatchText(node.name)),
    );
    if (match?.id) return match;
  }

  for (const attribute of attributes) {
    const match = attribute.values?.nodes?.find((node) => {
      const normalizedName = normalizeMetafieldMatchText(node.name);
      return normalizedCandidates.some(
        (candidate) =>
          canUseLooseShopifyTaxonomyMatch(candidate, normalizedName) &&
          (normalizedName.includes(candidate) ||
            candidate.includes(normalizedName)),
      );
    });
    if (match?.id) return match;
  }

  return null;
}

function canUseLooseShopifyTaxonomyMatch(candidate: string, valueName: string) {
  if (!candidate || !valueName) return false;
  if (candidate.length < 3 || valueName.length < 3) return false;
  if (/^\d+(?:\.\d+)?$/.test(candidate)) return false;
  if (/^\d+(?:\.\d+)?$/.test(valueName)) return false;
  return true;
}

function buildShopifyCategoryHierarchyIds(categoryId: string): string[] {
  const cleaned = cleanField(categoryId);
  const match = cleaned.match(/^gid:\/\/shopify\/TaxonomyCategory\/([a-z0-9-]+)$/i);
  if (!match) return [];
  const taxonomyPath = match[1];
  if (!taxonomyPath || taxonomyPath === "na") return [];
  const parts = taxonomyPath.split("-").filter(Boolean);
  if (!parts.length) return [];
  return parts.map((_, index) => {
    const path = parts.slice(0, index + 1).join("-");
    return `gid://shopify/TaxonomyCategory/${path}`;
  });
}

function dedupeShopifyTaxonomyAttributes(
  attributes: ShopifyTaxonomyAttributeNode[],
): ShopifyTaxonomyAttributeNode[] {
  const byName = new Map<string, ShopifyTaxonomyAttributeNode>();
  for (const attribute of attributes) {
    const normalizedName = normalizeMetafieldMatchText(attribute.name);
    if (!normalizedName) continue;
    const existing = byName.get(normalizedName);
    if (!existing) {
      byName.set(normalizedName, {
        ...attribute,
        values: {
          nodes: dedupeShopifyTaxonomyValues(attribute.values?.nodes || []),
        },
      });
      continue;
    }
    existing.values = {
      nodes: dedupeShopifyTaxonomyValues([
        ...(existing.values?.nodes || []),
        ...(attribute.values?.nodes || []),
      ]),
    };
  }
  return Array.from(byName.values());
}

function dedupeShopifyTaxonomyValues(
  values: ShopifyTaxonomyValueNode[],
): ShopifyTaxonomyValueNode[] {
  const byKey = new Map<string, ShopifyTaxonomyValueNode>();
  for (const value of values) {
    const key = cleanField(value.id) || normalizeMetafieldMatchText(value.name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return Array.from(byKey.values());
}

function findShopifyTaxonomyAttributesForMapping(
  attributes: ShopifyTaxonomyAttributeNode[],
  mapping: ShopifyCategoryMetafieldMapping,
  definition?: ShopifyMetafieldDefinitionNode | null,
): ShopifyTaxonomyAttributeNode[] {
  const metaobjectType = definition ? getShopifyCategoryMetaobjectType(definition) : "";
  const baseFieldKeys = metaobjectType
    ? getShopifyCategoryBaseFieldKeys(metaobjectType)
    : [];
  const hinted = attributes.filter((attribute) =>
    baseFieldKeys.some((fieldKey) =>
      shopifyTaxonomyAttributeMatchesField(attribute, fieldKey, metaobjectType),
    ),
  );
  const byMappingName = attributes.filter((attribute) =>
    shopifyTaxonomyAttributeMatchesMapping(attribute, mapping),
  );
  return dedupeShopifyTaxonomyAttributes([...hinted, ...byMappingName]);
}

function shopifyTaxonomyAttributeMatchesMapping(
  attribute: ShopifyTaxonomyAttributeNode,
  mapping: ShopifyCategoryMetafieldMapping,
): boolean {
  const name = normalizeMetafieldMatchText(attribute.name);
  if (!name) return false;
  return [...mapping.keyHints, ...mapping.nameHints].some((hint) => {
    const normalizedHint = normalizeMetafieldMatchText(hint);
    return name.includes(normalizedHint) || normalizedHint.includes(name);
  });
}

function buildShopifyCategoryMetafieldValueOptions(
  attributes: ShopifyTaxonomyAttributeNode[],
): ShopifyCategoryMetafieldOption[] {
  const options: ShopifyCategoryMetafieldOption[] = [];
  const seen = new Set<string>();
  for (const attribute of attributes) {
    const attributeName = cleanField(attribute.name) || "Shopify";
    for (const value of attribute.values?.nodes || []) {
      const label = cleanField(value.name);
      if (!label) continue;
      const key = cleanField(value.id) || normalizeMetafieldMatchText(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      options.push({
        id: cleanField(value.id) || label,
        label,
        value: label,
        attributeName,
      });
    }
  }
  return options;
}

function buildFallbackShopifyCategoryMetafieldOptions(
  categoryId: string,
): ShopifyCategoryMetafieldOptionsResult {
  return {
    categoryId,
    hierarchy: buildShopifyCategoryHierarchyIds(categoryId).map((id) => ({
      id,
      name: null,
    })),
    fields: {},
    warnings: ["当前使用测试密钥，类别元字段官方选项需要真实 Shopify 店铺读取。"],
  };
}

function shopifyTaxonomyAttributeMatchesField(
  attribute: ShopifyTaxonomyAttributeNode,
  fieldKey: string,
  type: string,
): boolean {
  const name = normalizeMetafieldMatchText(attribute.name);
  if (!name) return false;
  return getShopifyTaxonomyAttributeHints(fieldKey, type).some((hint) => {
    const normalizedHint = normalizeMetafieldMatchText(hint);
    return name.includes(normalizedHint) || normalizedHint.includes(name);
  });
}

function getShopifyTaxonomyAttributeHints(
  fieldKey: string,
  type = "",
): string[] {
  const hints: Record<string, string[]> = {
    base_age_group: ["age group"],
    base_color: ["color"],
    base_dress_occasion: ["dress occasion", "occasion"],
    base_dress_style: ["dress style", "style"],
    base_fabric: ["fabric", "material"],
    base_neckline: ["neckline"],
    base_pattern: ["pattern"],
    base_size: ["size"],
    base_skirt_dress_length_type: [
      "skirt dress length type",
      "dress length type",
      "dress length",
    ],
    base_sleeve_length_type: ["sleeve length type", "sleeve length"],
    base_target_gender: ["target gender", "gender"],
  };
  const normalizedFieldKey = normalizeMetafieldMatchText(fieldKey);
  const keyHints =
    normalizedFieldKey.includes("agegroup")
      ? hints.base_age_group
      : normalizedFieldKey.includes("colorpattern") ||
          normalizedFieldKey.includes("color")
        ? [...hints.base_color, ...hints.base_pattern]
        : normalizedFieldKey.includes("dressoccasion") ||
            normalizedFieldKey.includes("occasion")
          ? hints.base_dress_occasion
          : normalizedFieldKey.includes("dressstyle")
            ? hints.base_dress_style
            : normalizedFieldKey.includes("fabric") ||
                normalizedFieldKey.includes("material")
              ? hints.base_fabric
              : normalizedFieldKey.includes("neckline")
                ? hints.base_neckline
                : normalizedFieldKey.includes("skirtdresslengthtype") ||
                    normalizedFieldKey.includes("dresslength")
                  ? hints.base_skirt_dress_length_type
                  : normalizedFieldKey.includes("sleevelengthtype") ||
                      normalizedFieldKey.includes("sleevelength")
                    ? hints.base_sleeve_length_type
                    : normalizedFieldKey.includes("size")
                      ? hints.base_size
                      : normalizedFieldKey.includes("targetgender") ||
                          normalizedFieldKey.includes("gender")
                        ? hints.base_target_gender
                        : [];
  const normalizedType = normalizeMetafieldMatchText(type);
  const typeHints =
    normalizedType.includes("agegroup")
      ? hints.base_age_group
      : normalizedType.includes("colorpattern")
        ? [...hints.base_color, ...hints.base_pattern]
        : normalizedType.includes("dressoccasion")
          ? hints.base_dress_occasion
          : normalizedType.includes("dressstyle")
            ? hints.base_dress_style
            : normalizedType.includes("fabric")
              ? hints.base_fabric
              : normalizedType.includes("neckline")
                ? hints.base_neckline
                : normalizedType.includes("skirtdresslengthtype")
                  ? hints.base_skirt_dress_length_type
                  : normalizedType.includes("sleevelengthtype")
                    ? hints.base_sleeve_length_type
                    : normalizedType.includes("size")
                      ? hints.base_size
                      : normalizedType.includes("targetgender")
                        ? hints.base_target_gender
                        : [];
  return Array.from(
    new Set([
      ...(hints[fieldKey] || []),
      ...keyHints,
      ...typeHints,
      fieldKey.replace(/^base_/, "").replace(/_/g, " "),
    ]),
  );
}

function getShopifyCategoryBaseFieldKeys(type: string): string[] {
  const normalizedType = normalizeMetafieldMatchText(type);
  if (normalizedType.includes("agegroup")) return ["base_age_group"];
  if (normalizedType.includes("colorpattern")) {
    return ["base_color"];
  }
  if (normalizedType.includes("dressoccasion")) return ["base_dress_occasion"];
  if (normalizedType.includes("dressstyle")) return ["base_dress_style"];
  if (normalizedType.includes("fabric")) return ["base_fabric"];
  if (normalizedType.includes("neckline")) return ["base_neckline"];
  if (normalizedType.includes("size")) return ["base_size"];
  if (normalizedType.includes("skirtdresslengthtype")) {
    return ["base_skirt_dress_length_type"];
  }
  if (normalizedType.includes("sleevelengthtype")) {
    return ["base_sleeve_length_type"];
  }
  if (normalizedType.includes("targetgender")) return ["base_target_gender"];
  return [];
}

function shouldSkipShopifyCategoryMetaobjectField(
  type: string,
  fieldKey: string,
  value: string,
): boolean {
  const normalizedType = normalizeMetafieldMatchText(type);
  const normalizedFieldKey = normalizeMetafieldMatchText(fieldKey);
  if (
    !normalizedType.includes("colorpattern") ||
    normalizedFieldKey !== "basepattern"
  ) {
    return false;
  }
  return !hasShopifyPatternHint(value);
}

function hasShopifyPatternHint(value: string): boolean {
  const text = normalizeMetafieldMatchText(value);
  return /floral|flower|stripe|striped|dot|polka|plaid|check|gingham|animal|leopard|zebra|chevron|paisley|print|pattern/.test(
    text,
  );
}

function inferShopifyColorPatternFieldValue(
  type: string,
  fieldKey: string,
  value: string,
): string {
  const normalizedFieldKey = normalizeMetafieldMatchText(fieldKey);
  if (
    normalizedFieldKey === "color" ||
    normalizedFieldKey === "colour" ||
    normalizedFieldKey.includes("hex") ||
    normalizedFieldKey.includes("colorcode") ||
    normalizedFieldKey.includes("colourcode")
  ) {
    return inferShopifyColorHex(value);
  }
  if (normalizedFieldKey === "taxonomyreference" || normalizedFieldKey === "basepattern") {
    return inferShopifyCategoryBaseValue(type, "base_pattern", value);
  }
  return inferShopifyCategoryBaseValue(type, fieldKey, value);
}

function inferShopifyCategoryBaseValue(
  type: string,
  fieldKey: string,
  value: string,
): string {
  const cleaned = cleanField(value);
  const text = normalizeMetafieldMatchText(cleaned);

  if (fieldKey === "base_pattern") {
    if (/floral|flower|rose|花|玫瑰/.test(text)) return "Floral";
    if (/stripe|striped|条纹/.test(text)) return "Striped";
    if (/dot|polka|圆点|波点/.test(text)) return "Polka Dot";
    if (/plaid|check|格纹/.test(text)) return "Plaid";
    if (/animal|leopard|zebra|动物|豹纹/.test(text)) return "Animal";
    return "Solid";
  }

  if (fieldKey === "base_color") return inferShopifyBaseColor(cleaned);
  if (fieldKey === "base_size") return inferShopifyBaseSize(cleaned);
  if (fieldKey === "base_fabric") return inferShopifyBaseFabric(cleaned);
  if (fieldKey === "base_age_group") return inferShopifyBaseAgeGroup(cleaned);
  if (fieldKey === "base_dress_occasion") {
    return inferShopifyBaseDressOccasion(cleaned);
  }
  if (fieldKey === "base_dress_style") return inferShopifyBaseDressStyle(cleaned);
  if (fieldKey === "base_neckline") return inferShopifyBaseNeckline(cleaned);
  if (fieldKey === "base_skirt_dress_length_type") {
    return inferShopifyBaseDressLength(cleaned);
  }
  if (fieldKey === "base_sleeve_length_type") {
    return inferShopifyBaseSleeveLength(cleaned);
  }
  if (fieldKey === "base_target_gender") return inferShopifyBaseTargetGender(cleaned);

  if (fieldKey === "taxonomy_reference") {
    return inferShopifyCategoryBaseValueByType(type, cleaned);
  }
  if (type === "shopify--color-pattern") return inferShopifyBaseColor(cleaned);
  return cleaned;
}

function inferShopifyCategoryBaseValueByType(type: string, value: string): string {
  const normalizedType = normalizeMetafieldMatchText(type);
  if (normalizedType.includes("agegroup")) return inferShopifyBaseAgeGroup(value);
  if (normalizedType.includes("colorpattern")) return inferShopifyBaseColor(value);
  if (normalizedType.includes("dressoccasion")) {
    return inferShopifyBaseDressOccasion(value);
  }
  if (normalizedType.includes("dressstyle")) return inferShopifyBaseDressStyle(value);
  if (normalizedType.includes("fabric")) return inferShopifyBaseFabric(value);
  if (normalizedType.includes("neckline")) return inferShopifyBaseNeckline(value);
  if (normalizedType.includes("skirtdresslengthtype")) {
    return inferShopifyBaseDressLength(value);
  }
  if (normalizedType.includes("sleevelengthtype")) {
    return inferShopifyBaseSleeveLength(value);
  }
  if (normalizedType.includes("size")) return inferShopifyBaseSize(value);
  if (normalizedType.includes("targetgender")) {
    return inferShopifyBaseTargetGender(value);
  }
  return value;
}

function inferShopifyCategoryValueForField(
  type: string,
  fieldKey: string,
  value: string,
): string {
  const normalizedFieldKey = normalizeMetafieldMatchText(fieldKey);
  if (normalizedFieldKey.includes("agegroup")) {
    return inferShopifyBaseAgeGroup(value);
  }
  if (
    normalizedFieldKey.includes("colorpattern") ||
    normalizedFieldKey.includes("color")
  ) {
    return inferShopifyBaseColor(value);
  }
  if (
    normalizedFieldKey.includes("dressoccasion") ||
    normalizedFieldKey.includes("occasion")
  ) {
    return inferShopifyBaseDressOccasion(value);
  }
  if (normalizedFieldKey.includes("dressstyle")) {
    return inferShopifyBaseDressStyle(value);
  }
  if (
    normalizedFieldKey.includes("fabric") ||
    normalizedFieldKey.includes("material")
  ) {
    return inferShopifyBaseFabric(value);
  }
  if (normalizedFieldKey.includes("neckline")) {
    return inferShopifyBaseNeckline(value);
  }
  if (
    normalizedFieldKey.includes("skirtdresslengthtype") ||
    normalizedFieldKey.includes("dresslength")
  ) {
    return inferShopifyBaseDressLength(value);
  }
  if (
    normalizedFieldKey.includes("sleevelengthtype") ||
    normalizedFieldKey.includes("sleevelength")
  ) {
    return inferShopifyBaseSleeveLength(value);
  }
  if (normalizedFieldKey.includes("size")) return inferShopifyBaseSize(value);
  if (
    normalizedFieldKey.includes("targetgender") ||
    normalizedFieldKey.includes("gender")
  ) {
    return inferShopifyBaseTargetGender(value);
  }
  return inferShopifyCategoryBaseValueByType(type, value);
}

function inferShopifyBaseColor(value: string): string {
  const text = normalizeMetafieldMatchText(value);
  if (/navy|royalblue|skyblue|dustyblue|steelblue|slateblue|blue|teal|海军蓝|蓝/.test(text)) {
    return "Blue";
  }
  if (/black|黑/.test(text)) return "Black";
  if (/white|ivory|白|象牙/.test(text)) return "White";
  if (/champagne|sand|beige|nude|apricot|茶|米|香槟/.test(text)) return "Beige";
  if (/gray|grey|silver|灰/.test(text)) return "Gray";
  if (/gold|金/.test(text)) return "Gold";
  if (/bronze|铜/.test(text)) return "Bronze";
  if (/burgundy|cabernet|wine|red|rust|红|酒红/.test(text)) return "Red";
  if (/coral|pink|rose|blush|petal|粉/.test(text)) return "Pink";
  if (/lavender|lilac|wisteria|mauve|mulberry|plum|purple|紫/.test(text)) {
    return "Purple";
  }
  if (/green|mint|sage|olive|emerald|forest|绿/.test(text)) return "Green";
  if (/yellow|lemon|daffodil|butter|黄/.test(text)) return "Yellow";
  if (/orange|cinnamon|terracotta|marigold|橙/.test(text)) return "Orange";
  if (/brown|mocha|espresso|棕|咖/.test(text)) return "Brown";
  return value;
}

function inferShopifyColorHex(value: string): string {
  const cleaned = cleanField(value);
  const hexMatch = cleaned.match(/#?([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toUpperCase();
    }
    return `#${hex}`.toUpperCase();
  }

  const text = normalizeMetafieldMatchText(cleaned);
  const palette: Array<[RegExp, string]> = [
    [/coralpink|pinkcoral/, "#F88379"],
    [/burgundy|cabernet|wine/, "#800020"],
    [/dustyblue/, "#6E8FA3"],
    [/navy/, "#000080"],
    [/royalblue/, "#4169E1"],
    [/skyblue/, "#87CEEB"],
    [/lavender/, "#E6E6FA"],
    [/lilac/, "#C8A2C8"],
    [/mauve/, "#E0B0FF"],
    [/champagne/, "#F7E7CE"],
    [/ivory/, "#FFFFF0"],
    [/blush|petal|rose/, "#F4C2C2"],
    [/pink/, "#FFC0CB"],
    [/red/, "#FF0000"],
    [/purple|plum/, "#800080"],
    [/green|emerald|sage|mint|olive/, "#008000"],
    [/yellow|lemon|butter/, "#FFFF00"],
    [/orange|terracotta|cinnamon/, "#FFA500"],
    [/brown|mocha|espresso/, "#8B4513"],
    [/beige|nude|sand|apricot/, "#F5F5DC"],
    [/gold/, "#D4AF37"],
    [/silver|gray|grey/, "#C0C0C0"],
    [/black/, "#000000"],
    [/white/, "#FFFFFF"],
    [/blue|teal/, "#0000FF"],
  ];
  return palette.find(([pattern]) => pattern.test(text))?.[1] || cleaned;
}

function inferShopifyBaseSize(value: string): string {
  const text = normalizeMetafieldMatchText(value);
  if (/^xxs$|extraextrasmall|2xs|特特小/.test(text)) return "Extra extra small (XXS)";
  if (/^xs$|extrasmall|特小/.test(text)) return "Extra small (XS)";
  if (/^s$|small|小码/.test(text)) return "Small (S)";
  if (/^m$|medium|中码/.test(text)) return "Medium (M)";
  if (/^l$|large|大码/.test(text)) return "Large (L)";
  if (/^xl$|extralarge|1xl|加大/.test(text)) return "Extra large (XL)";
  if (/^xxl$|extraextralarge|2xl|2x/.test(text)) return "Extra extra large (XXL)";
  if (/^xxxl$|3xl|3x/.test(text)) return "Triple extra large (XXXL)";
  if (/plus|大码/.test(text)) return "Plus";
  if (/petite|小码/.test(text)) return "Petite";
  if (/maternity|孕/.test(text)) return "Maternity";
  if (/regular|standard|常规/.test(text)) return "Regular";
  return value;
}

function inferShopifyBaseFabric(value: string): string {
  const text = normalizeMetafieldMatchText(value);
  if (/satin|缎/.test(text)) return "Satin";
  if (/chiffon|雪纺/.test(text)) return "Chiffon";
  if (/lace|蕾丝/.test(text)) return "Lace";
  if (/tulle|网纱/.test(text)) return "Tulle";
  if (/velvet|丝绒|天鹅绒/.test(text)) return "Velvet";
  if (/organza|欧根纱/.test(text)) return "Organza";
  if (/taffeta|塔夫/.test(text)) return "Taffeta";
  if (/crepe|绉/.test(text)) return "Crepe";
  if (/silk|真丝/.test(text)) return "Silk";
  if (/cotton|棉/.test(text)) return "Cotton";
  if (/polyester|涤纶/.test(text)) return "Polyester";
  return value;
}

function inferShopifyBaseAgeGroup(value: string): string {
  const text = normalizeMetafieldMatchText(value);
  if (/adult|成人/.test(text)) return "Adult";
  if (/teen|青少年/.test(text)) return "Teen";
  if (/kid|child|children|儿童/.test(text)) return "Kids";
  if (/baby|infant|婴/.test(text)) return "Baby";
  return value;
}

function inferShopifyBaseDressOccasion(value: string): string {
  const text = normalizeMetafieldMatchText(value);
  if (/prom|舞会/.test(text)) return "Prom";
  if (/wedding|bridal|bride|婚|新娘/.test(text)) return "Wedding";
  if (/evening|formal|gala|specialoccasion|晚宴|正式/.test(text)) return "Formal";
  if (/cocktail|party|派对/.test(text)) return "Party";
  if (/casual|日常/.test(text)) return "Casual";
  return value;
}

function inferShopifyBaseDressStyle(value: string): string {
  const text = normalizeMetafieldMatchText(value);
  if (/aline|a字|a型/.test(text)) return "A-Line";
  if (/sheath|直筒|修身/.test(text)) return "Sheath";
  if (/ballgown|ball gown|蓬裙/.test(text)) return "Ball Gown";
  if (/mermaid|trumpet|鱼尾/.test(text)) return "Mermaid";
  if (/empire|帝国/.test(text)) return "Empire";
  if (/fitandflare|fit flare/.test(text)) return "Fit and Flare";
  return value;
}

function inferShopifyBaseNeckline(value: string): string {
  const text = normalizeMetafieldMatchText(value);
  if (/sweetheart|心形|甜心/.test(text)) return "Sweetheart";
  if (/strapless|抹胸/.test(text)) return "Strapless";
  if (/vneck|v领/.test(text)) return "V-Neck";
  if (/offshoulder|offtheshoulder|一字肩|露肩/.test(text)) return "Off Shoulder";
  if (/halter|挂脖/.test(text)) return "Halter";
  if (/square|方领/.test(text)) return "Square";
  if (/crew|round|圆领/.test(text)) return "Round";
  return value;
}

function inferShopifyBaseDressLength(value: string): string {
  const text = normalizeMetafieldMatchText(value);
  if (/floor|full|及地|拖地/.test(text)) return "Floor Length";
  if (/ankle|及踝/.test(text)) return "Ankle Length";
  if (/tea|茶歇/.test(text)) return "Tea Length";
  if (/midi|中长/.test(text)) return "Midi";
  if (/knee|及膝/.test(text)) return "Knee Length";
  if (/mini|short|短/.test(text)) return "Mini";
  return value;
}

function inferShopifyBaseSleeveLength(value: string): string {
  const text = normalizeMetafieldMatchText(value);
  if (/sleeveless|strapless|无袖|抹胸/.test(text)) return "Sleeveless";
  if (/cap|盖袖/.test(text)) return "Cap Sleeve";
  if (/short|短袖/.test(text)) return "Short Sleeve";
  if (/threequarter|3\/4|七分|四分之三/.test(text)) return "Three Quarter Sleeve";
  if (/long|长袖/.test(text)) return "Long Sleeve";
  return value;
}

function inferShopifyBaseTargetGender(value: string): string {
  const text = normalizeMetafieldMatchText(value);
  if (/female|women|woman|girl|女/.test(text)) return "Female";
  if (/male|men|man|boy|男/.test(text)) return "Male";
  if (/unisex|通用|中性/.test(text)) return "Unisex";
  return value;
}

function cleanCategoryMetafieldValue(value?: string): string {
  return cleanField(value)
    .replace(/\s*[，,]\s*类别元字段[^:：]*[:：].*$/i, "")
    .replace(/^类别元字段[^:：]*[:：]\s*/i, "")
    .trim();
}

function splitCategoryMetafieldValues(value: string): string[] {
  return Array.from(
    new Set(
      cleanCategoryMetafieldValue(value)
        .split(/[，,;；\n|]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function getCategoryValueCandidates(value: string): string[] {
  const exact = cleanField(value);
  const aliases = SHOPIFY_CATEGORY_VALUE_ALIASES[exact] || [];
  return Array.from(new Set([exact, ...aliases].filter(Boolean)));
}

function shopifyMetaobjectMatchesValue(
  node: ShopifyMetaobjectNode,
  value: string,
) {
  const normalizedValue = normalizeMetafieldMatchText(value);
  const displayName = normalizeMetafieldMatchText(node.displayName);
  if (displayName === normalizedValue) return true;
  return Boolean(
    node.fields?.some(
      (field) => normalizeMetafieldMatchText(field.value) === normalizedValue,
    ),
  );
}

function makeShopifyMetaobjectHandle(type: string, value: string): string {
  const base =
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "value";
  const hash = crypto
    .createHash("sha1")
    .update(`${type}:${value}`)
    .digest("hex")
    .slice(0, 8);
  return `buqiqi-${base}-${hash}`;
}

function normalizeMetafieldMatchText(value?: string | null): string {
  return cleanField(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[\s_\-/]+/g, "")
    .replace(/[()（）:：]/g, "");
}

function buildProductMetafields(input: ShopifyProductDraftInput) {
  const fields = [
    ["buqiqi", "color", "主色调", input.color],
    ["buqiqi", "material", "面料材质", input.material],
    ["buqiqi", "neckline", "领口设计", input.neckline],
    ["buqiqi", "silhouette", "整体版型", input.silhouette],
  ] as const;
  const builtInFields = fields
    .map(([namespace, key, _name, value]) => ({
      namespace,
      key,
      type: "single_line_text_field",
      value: cleanField(value),
    }))
    .filter((item) => item.value);

  const customFields = (input.productMetafields || [])
    .map((item) => {
      const namespace = cleanField(item.namespace);
      const key = cleanField(item.key);
      const type = cleanField(item.type) || "single_line_text_field";
      const value = normalizeCustomProductMetafieldValue(type, item.value);
      return { namespace, key, type, value };
    })
    .filter(
      (item) =>
        item.namespace &&
        item.namespace !== SHOPIFY_CATEGORY_METAFIELD_NAMESPACE &&
        item.key &&
        item.value,
    );

  const deduped = new Map<string, (typeof customFields)[number]>();
  for (const item of [...builtInFields, ...customFields]) {
    deduped.set(`${item.namespace}.${item.key}`, item);
  }
  return Array.from(deduped.values());
}

function normalizeCustomProductMetafieldValue(type: string, value?: string): string {
  const cleaned = cleanField(value);
  if (!cleaned) return "";
  if (type === "single_line_text_field") {
    return cleaned.replace(/[\r\n]+/g, " ");
  }
  if (type === "rich_text_field") {
    try {
      const parsed = JSON.parse(cleaned) as { type?: unknown };
      if (parsed?.type === "root") return cleaned;
    } catch {}
    return JSON.stringify({
      type: "root",
      children: cleaned
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => ({
          type: "paragraph",
          children: [{ type: "text", value: paragraph }],
        })),
    });
  }
  return cleaned;
}

function normalizeTags(tags?: string): string[] {
  return Array.from(
    new Set(
      cleanField(tags)
        .split(/[，,、;\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ).slice(0, 50);
}

function normalizeProductVariantDrafts(
  input: ShopifyProductDraftInput,
): NormalizedProductVariantDraft[] {
  const seen = new Set<string>();
  const fallbackOptionName =
    cleanField(input.variantGroupByOptionName) ||
    cleanField(input.variantOptionName) ||
    "Size";
  const fallbackOptionMetafieldKey = cleanField(input.variantOptionMetafieldKey);
  return (input.variants || [])
    .map((variant) => {
      const size = cleanField(variant.size);
      const optionValues = normalizeVariantOptionValues(
        variant,
        fallbackOptionName,
        fallbackOptionMetafieldKey,
      );
      return {
        size:
          size ||
          optionValues
            .map((item) => item.value)
            .filter(Boolean)
            .join(" / "),
        sku: cleanField(variant.sku),
        price: cleanField(variant.price),
        inventory: cleanField(variant.inventory),
        imageUrl: cleanField(variant.imageUrl),
        optionValues,
      };
    })
    .filter((variant) => {
      if (!variant.size || seen.has(variant.size)) return false;
      seen.add(variant.size);
      return true;
    })
    .slice(0, 100);
}

function normalizeVariantOptionValues(
  variant: ShopifyVariantDraft,
  fallbackOptionName: string,
  fallbackOptionMetafieldKey: string,
): NormalizedVariantOptionValue[] {
  const seen = new Set<string>();
  const values = (variant.optionValues || [])
    .map((item) => ({
      optionName: cleanField(item.optionName),
      optionMetafieldKey: cleanField(item.optionMetafieldKey),
      value: cleanField(item.value),
      linkedMetafieldValue: cleanField(item.linkedMetafieldValue),
    }))
    .filter((item) => item.optionName && item.value)
    .filter((item) => {
      const key = item.optionName.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (values.length) return values;

  const value = cleanField(variant.size);
  if (!value) return [];
  return [
    {
      optionName: fallbackOptionName,
      optionMetafieldKey: fallbackOptionMetafieldKey,
      value,
      linkedMetafieldValue: cleanField(variant.linkedMetafieldValue),
    },
  ];
}

function normalizePrice(price?: string): string | null {
  const cleaned = cleanField(price).replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return value.toFixed(2);
}

function normalizeVariantPrice(
  variantPrice?: string,
  fallbackPrice?: string,
): string | null {
  const normalizedVariantPrice = normalizePrice(variantPrice);
  if (normalizedVariantPrice && normalizedVariantPrice !== "0.00") {
    return normalizedVariantPrice;
  }
  return normalizePrice(fallbackPrice) || normalizedVariantPrice;
}

function normalizeInventoryQuantity(value?: string): number | null {
  const cleaned = cleanField(value).replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const quantity = Number(cleaned);
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  return Math.floor(quantity);
}

function normalizeProductWeight(value?: string): number | null {
  const cleaned = cleanField(value).replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const weight = Number(cleaned);
  if (!Number.isFinite(weight) || weight < 0) return null;
  return weight;
}

function normalizeWeightUnitForShopify(
  value?: string,
): ShopifyProductWeightUnit {
  const normalized = cleanField(value).toUpperCase();
  if (normalized === "KILOGRAMS" || normalized === "KG") return "KILOGRAMS";
  if (normalized === "OUNCES" || normalized === "OZ") return "OUNCES";
  if (normalized === "POUNDS" || normalized === "LB" || normalized === "LBS") {
    return "POUNDS";
  }
  return "GRAMS";
}

function normalizeCountryCodeOfOriginForShopify(value?: string): string {
  const code = cleanField(value).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function normalizeHarmonizedSystemCodeForShopify(value?: string): string {
  const code = cleanField(value).replace(/\D/g, "").slice(0, 13);
  return code.length >= 6 ? code : "";
}

const SHORT_SKU_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SHORT_SKU_LENGTH = 6;
const SHORT_SKU_PATTERN = /^[A-Z0-9]{5,7}$/;

async function resolveSharedShopifyVariantSkus(
  shopDomain: string,
  accessToken: string,
  input: ShopifyProductDraftInput,
  variants: NormalizedProductVariantDraft[],
  warnings: string[],
): Promise<string[]> {
  const count = Math.max(1, variants.length);
  const preferred = normalizeShortSkuCandidate(
    input.sku || variants.find((variant) => variant.sku)?.sku || "",
  );
  let sharedSku = preferred;

  if (!sharedSku || (await shopifySkuExists(shopDomain, accessToken, sharedSku))) {
    sharedSku = await generateAvailableShopifySku(shopDomain, accessToken);
    warnings.push(`已自动生成不重复的商品 SKU：${sharedSku}。`);
  }

  return Array.from({ length: count }, () => sharedSku);
}

function normalizeShortSkuCandidate(value?: string): string {
  const sku = cleanField(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return SHORT_SKU_PATTERN.test(sku) ? sku : "";
}

async function generateAvailableShopifySku(
  shopDomain: string,
  accessToken: string,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const sku = generateShortSku();
    if (!(await shopifySkuExists(shopDomain, accessToken, sku))) return sku;
  }
  throw new Error("无法生成不重复 SKU，请稍后重试或手动填写 SKU。");
}

function generateShortSku(length = SHORT_SKU_LENGTH): string {
  let sku = "";
  for (let i = 0; i < length; i += 1) {
    sku += SHORT_SKU_ALPHABET[crypto.randomInt(SHORT_SKU_ALPHABET.length)];
  }
  return sku;
}

async function shopifySkuExists(
  shopDomain: string,
  accessToken: string,
  sku: string,
): Promise<boolean> {
  const json = await shopifyGraphql<ShopifySkuLookupResponse>(
    shopDomain,
    accessToken,
    `query FindBuqiqiSku($query: String!) {
      productVariants(first: 10, query: $query) {
        nodes {
          inventoryItem {
            sku
          }
        }
      }
    }`,
    { query: `sku:${sku}` },
  );
  assertNoTopLevelGraphqlErrors(json.errors);
  return (json.data?.productVariants?.nodes || []).some(
    (node) => cleanField(node.inventoryItem?.sku).toUpperCase() === sku,
  );
}

function buildInventoryItemInput(
  input: ShopifyProductDraftInput,
  sku?: string,
): Record<string, unknown> {
  const inventoryItem: Record<string, unknown> = {
    tracked: true,
    requiresShipping: input.requiresShipping !== false,
  };
  const cleanedSku = cleanField(sku);
  if (cleanedSku) inventoryItem.sku = cleanedSku;

  const countryCodeOfOrigin = normalizeCountryCodeOfOriginForShopify(
    input.countryCodeOfOrigin,
  );
  if (countryCodeOfOrigin) {
    inventoryItem.countryCodeOfOrigin = countryCodeOfOrigin;
  }

  const harmonizedSystemCode = normalizeHarmonizedSystemCodeForShopify(
    input.harmonizedSystemCode,
  );
  if (harmonizedSystemCode) {
    inventoryItem.harmonizedSystemCode = harmonizedSystemCode;
  }

  const weight = normalizeProductWeight(input.weight);
  if (weight !== null) {
    inventoryItem.measurement = {
      weight: {
        unit: normalizeWeightUnitForShopify(input.weightUnit),
        value: weight,
      },
    };
  }

  return inventoryItem;
}

const shopifyCountryDisplayNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["zh-CN"], { type: "region" })
    : null;

function formatCountryCodeOfOriginLabel(value: string): string {
  const code = normalizeCountryCodeOfOriginForShopify(value);
  if (!code) return "";
  const countryName = shopifyCountryDisplayNames?.of(code);
  return countryName && countryName !== code ? countryName : code;
}

function buildShopifyCountryCodeOptions(
  values: Array<string | null | undefined>,
): ShopifyCustomsOption[] {
  const seen = new Set<string>();
  const options: ShopifyCustomsOption[] = [];
  for (const value of values) {
    const code = normalizeCountryCodeOfOriginForShopify(value || undefined);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    options.push({
      value: code,
      label: formatCountryCodeOfOriginLabel(code),
      count: 0,
    });
  }
  return options.sort(
    (a, b) =>
      a.label.localeCompare(b.label, "zh-CN") ||
      a.value.localeCompare(b.value),
  );
}

const SHOPIFY_COUNTRY_CODE_FALLBACKS = [
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AR",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CV",
  "CW",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GT",
  "GW",
  "GY",
  "HK",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IQ",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PN",
  "PR",
  "PS",
  "PT",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RW",
  "SA",
  "SB",
  "SC",
  "SE",
  "SG",
  "SH",
  "SI",
  "SK",
  "SL",
  "SM",
  "SN",
  "SR",
  "ST",
  "SV",
  "SX",
  "SZ",
  "TC",
  "TD",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VN",
  "VU",
  "WS",
  "XK",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW",
];

function buildFallbackShopifyCountryCodeOptions(): ShopifyCustomsOption[] {
  return buildShopifyCountryCodeOptions(SHOPIFY_COUNTRY_CODE_FALLBACKS);
}

async function readShopifyCountryCodeOptions(
  shopDomain: string,
  accessToken: string,
  warnings: string[],
): Promise<ShopifyCustomsOption[]> {
  const json = await shopifyGraphql<ShopifyCountryCodeEnumResponse>(
    shopDomain,
    accessToken,
    `query BuqiqiShopifyCountryCodes {
      __type(name: "CountryCode") {
        enumValues(includeDeprecated: false) {
          name
          isDeprecated
        }
      }
    }`,
  );
  const topLevelErrors = formatGraphqlMessages(json.errors);
  if (topLevelErrors) {
    warnings.push(`读取 Shopify 官方国家/地区失败：${topLevelErrors}`);
    return buildFallbackShopifyCountryCodeOptions();
  }

  const countryCodes = (json.data?.__type?.enumValues || [])
    .filter((item) => !item.isDeprecated)
    .map((item) => item.name);
  const options = buildShopifyCountryCodeOptions(countryCodes);
  if (!options.length) {
    warnings.push("Shopify 官方国家/地区枚举为空，已使用本地兜底国家/地区列表。");
    return buildFallbackShopifyCountryCodeOptions();
  }
  return options;
}

async function readShopifyStringConnectionOptions(
  shopDomain: string,
  accessToken: string,
  fieldName: "productTypes" | "productVendors" | "productTags",
  label: string,
  warnings: string[],
): Promise<ShopifyProductOrganizationOption[]> {
  const values: string[] = [];
  let after: string | null = null;
  let page = 0;
  const maxPages = 8;

  do {
    const json: ShopifyStringConnectionResponse =
      await shopifyGraphql<ShopifyStringConnectionResponse>(
      shopDomain,
      accessToken,
      `query BuqiqiShopifyProductOrganizationStrings($first: Int!, $after: String) {
        ${fieldName}(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node
          }
        }
      }`,
      { first: 250, after },
    );
    const topLevelErrors = formatGraphqlMessages(json.errors);
    if (topLevelErrors) {
      warnings.push(`读取 Shopify ${label}失败：${topLevelErrors}`);
      break;
    }

    const connection: ShopifyStringConnectionNode | null | undefined =
      json.data?.[fieldName];
    for (const edge of connection?.edges || []) {
      const value = cleanField(edge.node);
      if (value) values.push(value);
    }
    for (const node of connection?.nodes || []) {
      const value = cleanField(node);
      if (value) values.push(value);
    }

    page += 1;
    after = cleanField(connection?.pageInfo?.endCursor) || null;
    if (!connection?.pageInfo?.hasNextPage) break;
  } while (after && page < maxPages);

  if (after && page >= maxPages) {
    warnings.push(`Shopify ${label}较多，本次只读取前 2000 个条目。`);
  }

  return buildShopifyProductOrganizationStringOptions(values);
}

async function readShopifyCollectionOptions(
  shopDomain: string,
  accessToken: string,
  warnings: string[],
): Promise<ShopifyProductOrganizationOption[]> {
  const options: ShopifyProductOrganizationOption[] = [];
  let after: string | null = null;
  let page = 0;
  const maxPages = 8;

  do {
    const json: ShopifyCollectionsResponse =
      await shopifyGraphql<ShopifyCollectionsResponse>(
      shopDomain,
      accessToken,
      `query BuqiqiShopifyCollections($first: Int!, $after: String) {
        collections(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            handle
          }
        }
      }`,
      { first: 250, after },
    );
    const topLevelErrors = formatGraphqlMessages(json.errors);
    if (topLevelErrors) {
      warnings.push(`读取 Shopify 产品系列失败：${topLevelErrors}`);
      break;
    }

    for (const collection of json.data?.collections?.nodes || []) {
      const title = cleanField(collection.title);
      if (!collection.id || !title) continue;
      options.push({
        id: collection.id,
        value: title,
        label: title,
        handle: cleanField(collection.handle) || null,
      });
    }

    page += 1;
    after = cleanField(json.data?.collections?.pageInfo?.endCursor) || null;
    if (!json.data?.collections?.pageInfo?.hasNextPage) break;
  } while (after && page < maxPages);

  if (after && page >= maxPages) {
    warnings.push("Shopify 产品系列较多，本次只读取前 2000 个条目。");
  }

  return sortShopifyProductOrganizationOptions(options);
}

function buildShopifyProductOrganizationStringOptions(
  values: string[],
): ShopifyProductOrganizationOption[] {
  return sortShopifyProductOrganizationOptions(
    buildShopifyProductOrganizationStringOptionsInOrder(values),
  );
}

function buildShopifyProductOrganizationStringOptionsInOrder(
  values: string[],
): ShopifyProductOrganizationOption[] {
  const seen = new Set<string>();
  const options: ShopifyProductOrganizationOption[] = [];
  for (const value of values) {
    const cleaned = cleanField(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    options.push({ value: cleaned, label: cleaned });
  }
  return options;
}

const SHOPIFY_COMMON_TAG_PRIORITY = [
  "ONLY",
  "MANYCOLOR",
];

function buildShopifyCommonTagOptions(
  categoryTagCounts: Map<string, number>,
  allTags: ShopifyProductOrganizationOption[],
): ShopifyProductOrganizationOption[] {
  const tagByKey = new Map(
    allTags.map((tag) => [tag.value.toLowerCase(), tag] as const),
  );
  const commonTags: ShopifyProductOrganizationOption[] = [];
  const seen = new Set<string>();
  for (const value of SHOPIFY_COMMON_TAG_PRIORITY) {
    const key = value.toLowerCase();
    const tag = tagByKey.get(key);
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    commonTags.push(tag);
  }

  const categoryTags = Array.from(categoryTagCounts.entries())
    .map(([key, count]) => {
      const tag = tagByKey.get(key);
      return tag ? { tag, count } : null;
    })
    .filter((item): item is { tag: ShopifyProductOrganizationOption; count: number } =>
      Boolean(item),
    )
    .filter(({ tag, count }) => {
      if (seen.has(tag.value.toLowerCase())) return false;
      if (count < 2) return false;
      if (tag.value.length > 32) return false;
      return tag.value.trim().split(/\s+/).length <= 3;
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.tag.label.localeCompare(b.tag.label, "zh-CN") ||
        a.tag.value.localeCompare(b.tag.value),
    )
    .slice(0, Math.max(0, 8 - commonTags.length))
    .map((item) => item.tag);
  return [...commonTags, ...categoryTags];
}

function sortShopifyProductOrganizationOptions(
  options: ShopifyProductOrganizationOption[],
): ShopifyProductOrganizationOption[] {
  const deduped: ShopifyProductOrganizationOption[] = [];
  const seen = new Set<string>();
  for (const option of options) {
    const key = (option.id || option.value || option.label).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(option);
  }
  return deduped.sort(
    (a, b) => {
      const aNumeric = /^[0-9]/.test(a.label.trim()) ? 1 : 0;
      const bNumeric = /^[0-9]/.test(b.label.trim()) ? 1 : 0;
      return (
        aNumeric - bNumeric ||
        a.label.localeCompare(b.label, "zh-CN") ||
        a.value.localeCompare(b.value)
      );
    },
  );
}

function normalizeShopifyCategorySearchId(value?: string): string {
  const categoryId = cleanField(value);
  if (!categoryId || categoryId === SHOPIFY_UNCATEGORIZED_CATEGORY_ID) {
    return "";
  }
  const match = categoryId.match(/\/TaxonomyCategory\/([^/?#]+)/);
  return match?.[1] || categoryId;
}

function formatGraphqlMessages(errors?: Array<{ message?: string }>): string {
  return (errors || [])
    .map((error) => error.message)
    .filter(Boolean)
    .join("；");
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    }),
  );
  return results;
}

function textToHtml(value?: string): string {
  const text = cleanText(value);
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map((paragraph) =>
      `<p>${paragraph
        .split(/\n/)
        .map((line) => escapeHtml(line))
        .join("<br />")}</p>`,
    )
    .join("");
}

function cleanField(value?: string | null): string {
  return cleanText(value).replace(/\s+/g, " ").trim();
}

function cleanText(value?: string | null): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function encryptToken(value: string): string {
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

function decryptToken(value: string): string {
  const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Shopify Token 存储格式无效");
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

function isTestShopifyCredentials(shopDomain: string, accessToken: string): boolean {
  return (
    normalizeShopDomain(shopDomain) === SHOPIFY_TEST_DOMAIN &&
    accessToken.trim() === SHOPIFY_TEST_TOKEN
  );
}
