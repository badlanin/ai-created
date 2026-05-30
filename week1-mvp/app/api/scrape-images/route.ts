import { lookup } from "dns/promises";
import net from "net";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

type ScrapedImage = {
  id: string;
  url: string;
  proxyUrl: string;
  alt: string;
  width: number | null;
  height: number | null;
};

const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = (await req.json()) as { url?: string };
    const target = await parseAllowedUrl(body.url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetchAllowedUrl(target, {
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json(
        { error: `网页抓取失败：HTTP ${res.status}` },
        { status: 400 },
      );
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return NextResponse.json(
        { error: "这个 URL 不是网页，无法从 HTML 中提取图片" },
        { status: 400 },
      );
    }

    const html = await res.text();
    const finalUrl = new URL(res.url || target.href);
    const images = extractImages(html, finalUrl).slice(0, MAX_IMAGES);

    return NextResponse.json({ images, sourceUrl: finalUrl.href });
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? "网页抓取超时"
        : e instanceof Error
          ? e.message
          : String(e);
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const url = new URL(req.url);
    const target = await parseAllowedUrl(url.searchParams.get("url"));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetchAllowedUrl(target, {
      headers: {
        ...REQUEST_HEADERS,
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json(
        { error: `图片读取失败：HTTP ${res.status}` },
        { status: 400 },
      );
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json(
        { error: "目标地址不是图片" },
        { status: 400 },
      );
    }

    const contentLength = Number(res.headers.get("content-length") || "0");
    if (contentLength > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "图片过大，已跳过" },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "图片过大，已跳过" },
        { status: 413 },
      );
    }

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(buffer.length),
      },
    });
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? "图片读取超时"
        : e instanceof Error
          ? e.message
          : String(e);
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

async function parseAllowedUrl(raw: string | null | undefined): Promise<URL> {
  const value = (raw || "").trim();
  if (!value) throw statusError("请先输入网页 URL", 400);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw statusError("URL 格式不正确", 400);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw statusError("只支持 http / https URL", 400);
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0"
  ) {
    throw statusError("不支持抓取本机或内网地址", 400);
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw statusError("不支持抓取本机或内网地址", 400);
    }
    return url;
  }

  try {
    const records = await lookup(hostname, { all: true });
    if (records.some((record) => isPrivateIp(record.address))) {
      throw statusError("不支持抓取本机或内网地址", 400);
    }
  } catch (e) {
    if ((e as { status?: number }).status) throw e;
    throw statusError("URL 域名无法解析", 400);
  }

  return url;
}

async function fetchAllowedUrl(url: URL, init: RequestInit, redirects = 0) {
  if (redirects > 5) throw statusError("网页重定向次数过多", 400);

  const res = await fetch(url.href, { ...init, redirect: "manual" });
  if (![301, 302, 303, 307, 308].includes(res.status)) return res;

  const location = res.headers.get("location");
  if (!location) throw statusError("网页重定向无效", 400);

  const next = await parseAllowedUrl(new URL(location, url).href);
  return fetchAllowedUrl(next, init, redirects + 1);
}

function extractImages(html: string, baseUrl: URL): ScrapedImage[] {
  const images: ScrapedImage[] = [];
  const seen = new Set<string>();

  function addImage(raw: string | undefined, alt = "", width?: string, height?: string) {
    const normalized = normalizeImageUrl(raw, baseUrl);
    if (!normalized) return;
    const numericWidth = toPositiveNumber(width);
    const numericHeight = toPositiveNumber(height);
    if (isLikelyNonProductImage(normalized, alt, numericWidth, numericHeight)) {
      return;
    }
    const key = imageIdentityKey(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    images.push({
      id: `img_${images.length + 1}`,
      url: normalized,
      proxyUrl: `/api/scrape-images?url=${encodeURIComponent(normalized)}`,
      alt,
      width: numericWidth,
      height: numericHeight,
    });
  }

  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = getAttrs(tag[0]);
    addImage(
      attrs.src ||
        attrs["data-src"] ||
        attrs["data-original"] ||
        attrs["data-lazy"] ||
        attrs["data-zoom-image"],
      attrs.alt || "",
      attrs.width,
      attrs.height,
    );

    const srcset = attrs.srcset || attrs["data-srcset"];
    for (const candidate of parseSrcset(srcset)) {
      addImage(candidate, attrs.alt || "", attrs.width, attrs.height);
    }
  }

  for (const tag of html.matchAll(/<source\b[^>]*>/gi)) {
    const attrs = getAttrs(tag[0]);
    for (const candidate of parseSrcset(attrs.srcset || attrs["data-srcset"])) {
      addImage(candidate, attrs.alt || "");
    }
  }

  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = getAttrs(tag[0]);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (["og:image", "og:image:url", "twitter:image"].includes(key)) {
      addImage(attrs.content || "");
    }
  }

  return images;
}

function getAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(re)) {
    attrs[match[1].toLowerCase()] = decodeHtml(
      match[2] || match[3] || match[4] || "",
    );
  }
  return attrs;
}

function parseSrcset(srcset: string | undefined): string[] {
  if (!srcset) return [];
  return srcset
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function normalizeImageUrl(raw: string | undefined, baseUrl: URL): string | null {
  const value = (raw || "").trim();
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) {
    return null;
  }
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.pathname.toLowerCase().endsWith(".svg")) return null;
    return url.href;
  } catch {
    return null;
  }
}

function imageIdentityKey(url: string): string {
  const parsed = new URL(url);
  const removableParams = [
    "auto",
    "crop",
    "fit",
    "format",
    "height",
    "h",
    "ixlib",
    "quality",
    "v",
    "width",
    "w",
  ];
  for (const param of removableParams) parsed.searchParams.delete(param);
  parsed.hash = "";
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
}

function isLikelyNonProductImage(
  url: string,
  alt: string,
  width: number | null,
  height: number | null,
): boolean {
  if (width && height && (width < 120 || height < 120)) return true;
  const text = `${url} ${alt}`.toLowerCase();
  return /\b(logo|icon|favicon|sprite|payment|badge|placeholder)\b/.test(text);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function toPositiveNumber(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function statusError(message: string, status: number) {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function isPrivateIp(ip: string): boolean {
  if (ip === "::1") return true;

  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return (
      lower === "::" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80:")
    );
  }

  return true;
}
