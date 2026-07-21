import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getStoredShopifyAccessToken, normalizeShopDomain } from "@/lib/shopify";
import { getShopifyDeviceIdFromRequest } from "@/lib/shopify-device";

export const runtime = "nodejs";
export const maxDuration = 30;

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || "2026-04";

type ShopifyBlogNode = {
  id: string;
  title?: string | null;
  handle?: string | null;
};

type ShopifyBlogsResponse = {
  data?: {
    blogs?: {
      nodes?: ShopifyBlogNode[];
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const deviceId = getShopifyDeviceIdFromRequest(req);
    const stored = await getStoredShopifyAccessToken(
      user.id,
      deviceId,
      cleanText(req.nextUrl.searchParams.get("shopDomain") || ""),
    );
    if (!stored) {
      return NextResponse.json({ error: "请先绑定 Shopify 店铺" }, { status: 400 });
    }

    const blogs = await readShopifyBlogs(stored.shopDomain, stored.accessToken);
    return NextResponse.json({
      blogs: blogs.map((blog) => ({
        id: blog.id,
        title: cleanText(blog.title) || cleanText(blog.handle) || "未命名博客",
        handle: cleanText(blog.handle),
      })),
    });
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}

async function readShopifyBlogs(shopDomain: string, accessToken: string): Promise<ShopifyBlogNode[]> {
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

async function shopifyGraphql<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://${normalizeShopDomain(shopDomain)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
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
    throw new Error(`Shopify 请求失败：HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Shopify 返回不是有效 JSON：${text.slice(0, 300)}`);
  }
}

function assertNoGraphqlErrors(errors?: Array<{ message?: string }>) {
  const messages = (errors || []).map((item) => item.message || "").filter(Boolean);
  if (messages.length) throw new Error(`Shopify GraphQL 错误：${messages.join("；")}`);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}