import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { resolveModelId } from "@/lib/ai-models";
import { buildGenaiClient } from "@/lib/genai-client";
import { assertWithinBudget } from "@/lib/pricing";
import { recordUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 120;

const CALL_TIMEOUT_MS = 90_000;
const MARKDOWN_SOURCE_MAX_CHARS = 60_000;

const MODULE_LABELS: Record<string, string> = {
  quickAnswer: "Quick Answer",
  toc: "文章目录",
  trendTable: "趋势对比表",
  recommendations: "搭配推荐",
  sources: "来源资料",
  faq: "FAQ",
  cta: "收藏 CTA",
  relatedArticles: "相关文章",
};

const LANGUAGE_LABELS: Record<string, string> = {
  english: "英文",
  bilingual: "中英双语",
  chinese: "中文",
};

type BlogGenerateOutput = {
  title: string;
  bodyHtml: string;
  summary: string;
  seoTitle: string;
  metaDescription: string;
  urlHandle: string;
  tags: string;
};

export async function POST(req: NextRequest) {
  let user: { id: number; role: string } | null = null;
  let model = "unknown";

  try {
    user = await requireUser();
    assertWithinBudget(user.id, user.role);

    const body = (await req.json()) as {
      prompt?: string;
      primaryKeyword?: string;
      targetAudience?: string;
      searchIntent?: string;
      language?: string;
      modules?: Record<string, boolean>;
      shopDomain?: string | null;
      markdownFileName?: string;
      markdownSource?: string;
    };

    const prompt = cleanText(body.prompt || "");
    const markdownSource = cleanMarkdownSource(body.markdownSource || "");
    if (!prompt && !markdownSource) {
      return NextResponse.json(
        { error: "请输入文章要求或上传 .md 文件" },
        { status: 400 },
      );
    }

    const enabledModules = Object.entries(body.modules || {})
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => MODULE_LABELS[key] || key);

    model = resolveModelId("vision");
    const client = buildGenaiClient();
    const result = await withTimeout(
      client.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildPrompt({
                  prompt,
                  primaryKeyword: cleanText(body.primaryKeyword || ""),
                  targetAudience: cleanText(body.targetAudience || ""),
                  searchIntent: cleanText(body.searchIntent || ""),
                  language: LANGUAGE_LABELS[body.language || ""] || "英文",
                  enabledModules,
                  shopDomain: cleanText(body.shopDomain || ""),
                  markdownFileName: cleanText(body.markdownFileName || ""),
                  markdownSource,
                }),
              },
            ],
          },
        ],
        config: {
          systemInstruction:
            "你是独立站 SEO 博客编辑，专门为 Shopify 服装独立站生成可发布的博客文章。只返回严格 JSON，不返回 Markdown 代码块。",
          responseMimeType: "application/json",
          temperature: 0.35,
        },
      }),
      CALL_TIMEOUT_MS,
    );

    const rawText = cleanText(result.text || "");
    if (!rawText) {
      throw new Error("大模型没有返回可用内容，请调整提示词后重试。");
    }

    const output = normalizeOutput(parseGeneratedArticle(rawText));

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
        kind: "blog-article-generate",
        provider: "gemini",
        module_count: enabledModules.length,
      },
    });

    return NextResponse.json({ ok: true, model, article: output });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/blog/generate] failed:", message);

    if (user && status !== 429) {
      recordUsage({
        userId: user.id,
        model,
        feature: "other",
        success: false,
        error: message,
        notes: { kind: "blog-article-generate", provider: "gemini" },
      });
    }

    return NextResponse.json({ error: message || "生成文章失败" }, { status });
  }
}

function buildPrompt(input: {
  prompt: string;
  primaryKeyword: string;
  targetAudience: string;
  searchIntent: string;
  language: string;
  enabledModules: string[];
  shopDomain: string;
  markdownFileName: string;
  markdownSource: string;
}) {
  return `请根据以下要求生成一篇 Shopify 独立站博客文章。

文章要求：
${input.prompt || "请根据上传的 Markdown 资料生成一篇结构完整、可发布的 SEO 博客文章。"}

${input.markdownSource ? `上传的 Markdown 资料${input.markdownFileName ? `（${input.markdownFileName}）` : ""}：
<<<MARKDOWN_SOURCE
${input.markdownSource}
MARKDOWN_SOURCE>>>` : "上传的 Markdown 资料：未提供"}

核心关键词：${input.primaryKeyword || "未指定，请根据文章要求提取"}
目标用户：${input.targetAudience || "未指定，请面向服装独立站买家"}
搜索意图：${input.searchIntent || "未指定，请覆盖信息搜索、选购建议和转化引导"}
输出语言：${input.language}
目标店铺：${input.shopDomain || "未指定"}
启用模块：${input.enabledModules.length ? input.enabledModules.join("、") : "未额外启用模块，按标准 SEO 文章结构生成"}

写作规则：
- 文章要适合 Shopify 服装独立站博客后台发布。
- 正文使用干净 HTML，只允许 h2、h3、p、ul、ol、li、table、thead、tbody、tr、th、td、strong、em、a 标签。
- 不要输出 script、style、iframe、表单或内联事件。
- 标题不超过 70 个字符。
- SEO 标题不超过 70 个字符。
- 元描述不超过 160 个字符。
- URL 名称使用英文小写、数字和连字符。
- 标签使用英文逗号分隔。
- 不确定的事实不要编造，不要写“根据图片”等不存在的上下文。
- 如果提供了 Markdown 资料，必须优先依据 Markdown 资料里的事实、结构、术语和产品信息来写；可以重组、扩写和润色，但不要添加资料里没有依据的规格、认证、价格、物流、售后承诺。

必须只返回 JSON，字段如下：
{
  "title": "文章标题",
  "bodyHtml": "正文 HTML",
  "summary": "文章摘要",
  "seoTitle": "页面标题",
  "metaDescription": "元描述",
  "urlHandle": "url-name",
  "tags": "tag one, tag two"
}`;
}

function parseGeneratedArticle(text: string): Record<string, unknown> {
  const parsed = parseJsonObject(text);
  if (parsed) return parsed;

  const fallback = buildFallbackArticle(text);
  if (fallback) return fallback;

  throw new Error("大模型返回内容不是可解析的 JSON，请重试。");
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const direct = tryParseJson(text);
  if (direct) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) {
    const parsed = tryParseJson(fenced);
    if (parsed) return parsed;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const parsed = tryParseJson(text.slice(start, end + 1));
    if (parsed) return parsed;
  }

  return null;
}

function buildFallbackArticle(text: string): Record<string, unknown> | null {
  const cleaned = cleanText(text);
  if (!cleaned) return null;
  const withoutFence = cleaned.replace(/^```(?:html|markdown|md)?\s*/i, "").replace(/```$/i, "").trim();
  const title =
    withoutFence.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    withoutFence.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ||
    withoutFence.match(/^#\s+(.+)$/m)?.[1] ||
    withoutFence.split(/\r?\n/).find((line) => cleanText(line)) ||
    "Blog Article";
  const bodyHtml = /<\/?(?:h1|h2|h3|p|ul|ol|li|table|thead|tbody|tr|th|td|strong|em|a)\b/i.test(withoutFence)
    ? withoutFence.replace(/<h1\b([^>]*)>/gi, "<h2$1>").replace(/<\/h1>/gi, "</h2>")
    : markdownLikeToHtml(withoutFence);
  return {
    title: stripHtml(title),
    bodyHtml,
    summary: stripHtml(withoutFence).slice(0, 300),
    seoTitle: stripHtml(title),
    metaDescription: stripHtml(withoutFence).slice(0, 160),
    urlHandle: toHandle(stripHtml(title)),
    tags: "",
  };
}

function markdownLikeToHtml(text: string) {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return blocks
    .map((block) => {
      if (block.startsWith("## ")) return `<h2>${escapeHtml(block.slice(3).trim())}</h2>`;
      if (block.startsWith("### ")) return `<h3>${escapeHtml(block.slice(4).trim())}</h3>`;
      return `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`;
    })
    .join("\n");
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return null;
}

function normalizeOutput(input: Record<string, unknown>): BlogGenerateOutput {
  const title = limit(cleanText(input.title), 70);
  const bodyHtml = sanitizeHtml(cleanText(input.bodyHtml));
  const summary = limit(cleanText(input.summary), 300);
  const seoTitle = limit(cleanText(input.seoTitle || title), 70);
  const metaDescription = limit(cleanText(input.metaDescription || summary), 160);
  const urlHandle = toHandle(cleanText(input.urlHandle || title));
  const tags = cleanText(input.tags);

  if (!title || !bodyHtml) {
    throw new Error("大模型返回内容缺少标题或正文，请重试。");
  }

  return {
    title,
    bodyHtml,
    summary,
    seoTitle,
    metaDescription,
    urlHandle,
    tags,
  };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanMarkdownSource(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MARKDOWN_SOURCE_MAX_CHARS);
}

function limit(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
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

function sanitizeHtml(html: string): string {
  return html
    .replace(/<\/?(?:script|style|iframe|object|embed|form|input|button|textarea|select)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("大模型生成超时，请稍后重试。")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
