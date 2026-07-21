import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getStoredShopifyAccessToken,
  normalizeShopDomain,
} from "@/lib/shopify";
import { getShopifyDeviceIdFromRequest } from "@/lib/shopify-device";

export const runtime = "nodejs";
export const maxDuration = 60;

const SHOPIFY_API_VERSION =
  process.env.SHOPIFY_API_VERSION?.trim() || "2026-04";

type ShopifyBlogNode = {
  id: string;
  title?: string | null;
  handle?: string | null;
};

type ShopifyArticleNode = {
  id: string;
  title?: string | null;
  handle?: string | null;
  blog?: ShopifyBlogNode | null;
};

type ShopifyUserError = {
  code?: string | null;
  field?: string[] | null;
  message?: string | null;
};

type ShopifyBlogsResponse = {
  data?: {
    blogs?: {
      nodes?: ShopifyBlogNode[];
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyAccessScopesResponse = {
  data?: {
    currentAppInstallation?: {
      accessScopes?: Array<{ handle?: string | null }> | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type ShopifyArticleMutationResponse = {
  data?: {
    articleCreate?: {
      article?: ShopifyArticleNode | null;
      userErrors?: ShopifyUserError[];
    } | null;
    articleUpdate?: {
      article?: ShopifyArticleNode | null;
      userErrors?: ShopifyUserError[];
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const body = (await req.json()) as {
      shopDomain?: string | null;
      shopifyArticleId?: string;
      shopifyBlog?: string;
      articleTitle?: string;
      articleBodyHtml?: string;
      summary?: string;
      seoTitle?: string;
      metaDescription?: string;
      urlHandle?: string;
      author?: string;
      tags?: string;
      publishStatus?: "draft" | "published";
    };

    const stored = await getStoredShopifyAccessToken(
      user.id,
      deviceId,
      cleanText(body.shopDomain || ""),
    );
    if (!stored) {
      return NextResponse.json(
        { error: "请先绑定 Shopify 店铺" },
        { status: 400 },
      );
    }

    const title = limit(cleanText(body.articleTitle), 255);
    const bodyHtml = sanitizeArticleHtml(cleanText(body.articleBodyHtml));
    if (!title || !bodyHtml) {
      return NextResponse.json(
        { error: "请先填写文章标题和正文 HTML" },
        { status: 400 },
      );
    }

    let blogs: ShopifyBlogNode[];
    try {
      blogs = await readShopifyBlogs(stored.shopDomain, stored.accessToken);
    } catch (error) {
      throw new Error(
        await buildShopifyBlogAccessDiagnostic(
          stored.shopDomain,
          stored.accessToken,
          error,
        ),
      );
    }
    const blog = findShopifyBlog(blogs, cleanText(body.shopifyBlog || ""));
    if (!blog) {
      return NextResponse.json(
        {
          error:
            "找不到对应的 Shopify 博客，请确认后台已存在 News 或 Blog，或在页面中选择正确博客。",
        },
        { status: 400 },
      );
    }

    const articleInput = {
      blogId: blog.id,
      title,
      author: { name: cleanText(body.author) || "BUQIQI" },
      handle: toHandle(cleanText(body.urlHandle || title)),
      body: bodyHtml,
      summary: sanitizeArticleHtml(cleanText(body.summary || "")),
      isPublished: body.publishStatus === "published",
      tags: splitTags(body.tags),
      metafields: buildSeoMetafields({
        seoTitle: cleanText(body.seoTitle || title),
        metaDescription: cleanText(body.metaDescription || body.summary || ""),
      }),
    };

    const articleId = cleanText(body.shopifyArticleId || "");
    const article = articleId
      ? await updateShopifyArticle(stored.shopDomain, stored.accessToken, {
          id: articleId,
          article: { ...articleInput, redirectNewHandle: true },
        })
      : await createShopifyArticle(stored.shopDomain, stored.accessToken, {
          article: articleInput,
        });

    return NextResponse.json({
      ok: true,
      article: {
        id: article.id,
        title: article.title || title,
        handle: article.handle || articleInput.handle,
        blogTitle: article.blog?.title || blog.title || "",
        blogHandle: article.blog?.handle || blog.handle || "",
        publicUrl: buildArticlePublicUrl(stored.shopDomain, article, blog),
      },
      seoMetafields: {
        titleTag: articleInput.metafields[0]?.value || "",
        descriptionTag: articleInput.metafields[1]?.value || "",
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/blog/sync] failed:", message);
    return NextResponse.json(
      { error: message || "同步 Shopify 博客文章失败" },
      { status },
    );
  }
}

async function readShopifyBlogs(
  shopDomain: string,
  accessToken: string,
): Promise<ShopifyBlogNode[]> {
  const json = await shopifyGraphql<ShopifyBlogsResponse>(
    shopDomain,
    accessToken,
    `query BuqiqiBlogs {
      blogs(first: 100) {
        nodes {
          id
          title
          handle
        }
      }
    }`,
  );
  assertNoGraphqlErrors(json.errors);
  return json.data?.blogs?.nodes || [];
}
async function readShopifyAccessScopes(
  shopDomain: string,
  accessToken: string,
): Promise<string[]> {
  const json = await shopifyGraphql<ShopifyAccessScopesResponse>(
    shopDomain,
    accessToken,
    `query BuqiqiAccessScopes {
      currentAppInstallation {
        accessScopes {
          handle
        }
      }
    }`,
  );
  assertNoGraphqlErrors(json.errors);
  return (json.data?.currentAppInstallation?.accessScopes || [])
    .map((scope) => cleanText(scope.handle || ""))
    .filter(Boolean)
    .sort();
}

async function buildShopifyBlogAccessDiagnostic(
  shopDomain: string,
  accessToken: string,
  error: unknown,
) {
  const baseMessage = error instanceof Error ? error.message : String(error);
  let scopes: string[] = [];
  let scopesError = "";
  try {
    scopes = await readShopifyAccessScopes(shopDomain, accessToken);
  } catch (scopeError) {
    scopesError = scopeError instanceof Error ? scopeError.message : String(scopeError);
  }

  const hasReadBlogScope = scopes.some((scope) =>
    ["read_content", "read_online_store_pages"].includes(scope),
  );
  const hasWriteBlogScope = scopes.some((scope) =>
    ["write_content", "write_online_store_pages"].includes(scope),
  );
  const scopeText = scopes.length ? scopes.join(", ") : "未能读取当前 token scopes";
  const missing: string[] = [];
  if (!hasReadBlogScope) missing.push("read_content 或 read_online_store_pages");
  if (!hasWriteBlogScope) missing.push("write_content 或 write_online_store_pages");

  return [
    baseMessage,
    `当前 token scopes：${scopeText}`,
    missing.length ? `缺少博客文章所需权限：${missing.join("；")}` : "当前 token 看起来包含博客读写 scope，若仍被拒绝，请确认该店铺已启用 Online Store/博客功能，且绑定的是同一个店铺的 Admin token。",
    scopesError ? `读取 scopes 时也失败：${scopesError}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}


async function createShopifyArticle(
  shopDomain: string,
  accessToken: string,
  variables: Record<string, unknown>,
): Promise<ShopifyArticleNode> {
  const json = await shopifyGraphql<ShopifyArticleMutationResponse>(
    shopDomain,
    accessToken,
    `mutation BuqiqiArticleCreate($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article {
          id
          title
          handle
          blog {
            id
            title
            handle
          }
        }
        userErrors {
          code
          field
          message
        }
      }
    }`,
    variables,
  );
  assertNoGraphqlErrors(json.errors);
  assertNoUserErrors(json.data?.articleCreate?.userErrors);
  const article = json.data?.articleCreate?.article;
  if (!article?.id) throw new Error("Shopify 没有返回已创建的文章 ID");
  return article;
}

async function updateShopifyArticle(
  shopDomain: string,
  accessToken: string,
  variables: Record<string, unknown>,
): Promise<ShopifyArticleNode> {
  const json = await shopifyGraphql<ShopifyArticleMutationResponse>(
    shopDomain,
    accessToken,
    `mutation BuqiqiArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article {
          id
          title
          handle
          blog {
            id
            title
            handle
          }
        }
        userErrors {
          code
          field
          message
        }
      }
    }`,
    variables,
  );
  assertNoGraphqlErrors(json.errors);
  assertNoUserErrors(json.data?.articleUpdate?.userErrors);
  const article = json.data?.articleUpdate?.article;
  if (!article?.id) throw new Error("Shopify 没有返回已更新的文章 ID");
  return article;
}

async function shopifyGraphql<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const domain = normalizeShopDomain(shopDomain);
  const response = await fetch(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Shopify 请求失败：HTTP ${response.status} ${text.slice(0, 300)}`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Shopify 返回不是有效 JSON：${text.slice(0, 300)}`);
  }
}

function buildSeoMetafields(input: {
  seoTitle: string;
  metaDescription: string;
}) {
  return [
    {
      namespace: "global",
      key: "title_tag",
      type: "single_line_text_field",
      value: limit(input.seoTitle, 70),
    },
    {
      namespace: "global",
      key: "description_tag",
      type: "single_line_text_field",
      value: limit(input.metaDescription, 160),
    },
  ].filter((item) => item.value);
}

function findShopifyBlog(blogs: ShopifyBlogNode[], value: string) {
  const normalized = normalizeMatchText(value);
  if (!normalized) return null;
  return (
    blogs.find(
      (blog) =>
        normalizeMatchText(blog.handle || "") === normalized ||
        normalizeMatchText(blog.title || "") === normalized,
    ) || null
  );
}

function buildArticlePublicUrl(
  shopDomain: string,
  article: ShopifyArticleNode,
  fallbackBlog: ShopifyBlogNode,
) {
  const blogHandle = article.blog?.handle || fallbackBlog.handle || "";
  const articleHandle = article.handle || "";
  if (!blogHandle || !articleHandle) return "";
  return `https://${normalizeShopDomain(shopDomain)}/blogs/${blogHandle}/${articleHandle}`;
}

function assertNoGraphqlErrors(errors?: Array<{ message?: string }>) {
  const messages = (errors || []).map((item) => item.message || "").filter(Boolean);
  if (messages.length) throw new Error(`Shopify GraphQL 错误：${messages.join("；")}`);
}

function assertNoUserErrors(errors?: ShopifyUserError[]) {
  const messages = (errors || [])
    .map((item) => [item.code, item.message].filter(Boolean).join(": "))
    .filter(Boolean);
  if (messages.length) throw new Error(`Shopify Article 写入失败：${messages.join("；")}`);
}

function splitTags(value: unknown) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const rawTag of String(value || "").split(/[,，;\n]/)) {
    const tag = cleanText(rawTag).slice(0, 255);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function sanitizeArticleHtml(html: string) {
  return html
    .replace(/<\/?(?:script|style|iframe|object|embed|form|input|button|textarea|select)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .trim();
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function limit(value: string, max: number) {
  return value.length > max ? value.slice(0, max).trim() : value;
}

function toHandle(value: string): string {
  const handle = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return handle || `article-${Date.now()}`;
}

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}
