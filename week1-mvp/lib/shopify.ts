import crypto from "crypto";
import { getDb } from "./db";

const SHOPIFY_API_VERSION =
  process.env.SHOPIFY_API_VERSION?.trim() || "2026-04";
const SHOPIFY_TEST_DOMAIN = "test.myshopify.com";
const SHOPIFY_TEST_TOKEN = "shpat_test_buqiqi";

export type ShopifyConnectionRow = {
  user_id: number;
  shop_domain: string;
  access_token_enc: string;
  shop_name: string | null;
  myshopify_domain: string | null;
  primary_domain: string | null;
  created_at: number;
  updated_at: number;
  last_tested_at: number | null;
};

export type ShopifyConnectionSafe = {
  bound: true;
  shopDomain: string;
  tokenPreview: string;
  shopName: string | null;
  myshopifyDomain: string | null;
  primaryDomain: string | null;
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
  productType?: string;
  vendor?: string;
  tags?: string;
  color?: string;
  material?: string;
  neckline?: string;
  silhouette?: string;
  sku?: string;
  price?: string;
  inventory?: string;
  status?: "DRAFT" | "ACTIVE";
  seoTitle?: string;
  seoDescription?: string;
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

type ShopifyProductCreateResponse = {
  data?: {
    productCreate?: {
      product?: {
        id: string;
        title: string;
        handle?: string | null;
        legacyResourceId?: string | null;
        variants?: {
          nodes?: Array<{
            id: string;
            inventoryItem?: { id: string; sku?: string | null } | null;
          }>;
        };
      } | null;
      userErrors?: Array<{ field?: string[]; message?: string }>;
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

export function getShopifyConnection(userId: number): ShopifyConnectionSafe | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM shopify_connections WHERE user_id = ?`)
    .get(userId) as ShopifyConnectionRow | undefined;
  if (!row) return null;
  const token = decryptToken(row.access_token_enc);
  return {
    bound: true,
    shopDomain: row.shop_domain,
    tokenPreview: maskToken(token),
    shopName: row.shop_name,
    myshopifyDomain: row.myshopify_domain,
    primaryDomain: row.primary_domain,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastTestedAt: row.last_tested_at,
  };
}

export function saveShopifyConnection(opts: {
  userId: number;
  shopDomain: string;
  accessToken: string;
  testResult: ShopifyConnectionTestResult;
}) {
  const db = getDb();
  const domain = normalizeShopDomain(opts.shopDomain);
  const token = opts.accessToken.trim();
  if (!token) throw new Error("Admin API Access Token 不能为空");
  const encrypted = encryptToken(token);
  db.prepare(
    `INSERT INTO shopify_connections (
       user_id,
       shop_domain,
       access_token_enc,
       shop_name,
       myshopify_domain,
       primary_domain,
       created_at,
       updated_at,
       last_tested_at
     )
     VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch(), unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET
       shop_domain = excluded.shop_domain,
       access_token_enc = excluded.access_token_enc,
       shop_name = excluded.shop_name,
       myshopify_domain = excluded.myshopify_domain,
       primary_domain = excluded.primary_domain,
       updated_at = unixepoch(),
       last_tested_at = unixepoch()`,
  ).run(
    opts.userId,
    domain,
    encrypted,
    opts.testResult.shopName,
    opts.testResult.myshopifyDomain,
    opts.testResult.primaryDomain,
  );
}

export function deleteShopifyConnection(userId: number) {
  const db = getDb();
  db.prepare(`DELETE FROM shopify_connections WHERE user_id = ?`).run(userId);
}

export function updateShopifyLastTested(
  userId: number,
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
     WHERE user_id = ?`,
  ).run(
    testResult.shopName,
    testResult.myshopifyDomain,
    testResult.primaryDomain,
    userId,
  );
}

export function getStoredShopifyToken(userId: number): {
  shopDomain: string;
  accessToken: string;
} | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT shop_domain, access_token_enc FROM shopify_connections WHERE user_id = ?`,
    )
    .get(userId) as
    | { shop_domain: string; access_token_enc: string }
    | undefined;
  if (!row) return null;
  return {
    shopDomain: row.shop_domain,
    accessToken: decryptToken(row.access_token_enc),
  };
}

export async function testShopifyConnection(opts: {
  shopDomain: string;
  accessToken: string;
}): Promise<ShopifyConnectionTestResult> {
  const domain = normalizeShopDomain(opts.shopDomain);
  const token = opts.accessToken.trim();
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

export async function syncShopifyProduct(
  userId: number,
  input: ShopifyProductDraftInput,
): Promise<ShopifyProductSyncResult> {
  const stored = getStoredShopifyToken(userId);
  if (!stored) throw new Error("尚未绑定 Shopify");
  if (isTestShopifyCredentials(stored.shopDomain, stored.accessToken)) {
    const title = cleanField(input.title) || "BUQIQI Test Product";
    return {
      productId: "gid://shopify/Product/buqiqi-local-test",
      title,
      handle: "buqiqi-local-test-product",
      legacyResourceId: "buqiqi-local-test",
      adminUrl: null,
      warnings: [
        "当前使用测试密钥，已模拟同步成功，没有调用 Shopify 官方接口。",
      ],
    };
  }

  const title = cleanField(input.title);
  if (!title) throw new Error("商品标题不能为空");

  const productInput = {
    title,
    descriptionHtml: textToHtml(input.description),
    productType: cleanField(input.productType),
    vendor: cleanField(input.vendor),
    tags: normalizeTags(input.tags),
    status: input.status === "ACTIVE" ? "ACTIVE" : "DRAFT",
    seo: {
      title: cleanField(input.seoTitle) || title,
      description: cleanField(input.seoDescription),
    },
    metafields: buildProductMetafields(input),
  };

  const createJson = await shopifyGraphql<ShopifyProductCreateResponse>(
    stored.shopDomain,
    stored.accessToken,
    `mutation CreateBuqiqiProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          title
          handle
          legacyResourceId
          variants(first: 1) {
            nodes {
              id
              inventoryItem {
                id
                sku
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    { product: productInput },
  );

  assertNoTopLevelGraphqlErrors(createJson.errors);
  const createPayload = createJson.data?.productCreate;
  const createErrors = normalizeUserErrors(createPayload?.userErrors);
  if (createErrors.length) {
    throw new Error(`Shopify 创建商品失败：${createErrors.join("；")}`);
  }
  const product = createPayload?.product;
  if (!product?.id) throw new Error("Shopify 未返回已创建商品 ID");

  const warnings: string[] = [];
  const firstVariant = product.variants?.nodes?.[0];
  const variantInput: Record<string, unknown> = {};
  if (firstVariant?.id) variantInput.id = firstVariant.id;
  const price = normalizePrice(input.price);
  if (price) variantInput.price = price;
  const sku = cleanField(input.sku);
  if (sku) variantInput.inventoryItem = { sku };

  if (firstVariant?.id && (price || sku)) {
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

  if (cleanField(input.inventory)) {
    warnings.push("库存数量需要店铺 Location 后续接入，本次未写入库存数量。");
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
    if (response.status === 401 || response.status === 403) {
      throw new Error("Shopify 鉴权失败，请检查 Token 是否包含 write_products。");
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
  throw new Error(
    `Shopify GraphQL 错误：${errors
      .map((err) => err.message)
      .filter(Boolean)
      .join("；")}`,
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

function buildProductMetafields(input: ShopifyProductDraftInput) {
  const fields = [
    ["color", "主色调", input.color],
    ["material", "面料材质", input.material],
    ["neckline", "领口设计", input.neckline],
    ["silhouette", "整体版型", input.silhouette],
  ] as const;
  return fields
    .map(([key, name, value]) => ({
      namespace: "buqiqi",
      key,
      type: "single_line_text_field",
      value: cleanField(value),
      description: name,
    }))
    .filter((item) => item.value);
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

function normalizePrice(price?: string): string | null {
  const cleaned = cleanField(price).replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return value.toFixed(2);
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

function cleanField(value?: string): string {
  return cleanText(value).replace(/\s+/g, " ").trim();
}

function cleanText(value?: string): string {
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
