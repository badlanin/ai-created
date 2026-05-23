export const UNIVERSAL_MODEL_ID = "universal-test";
export const DEFAULT_UNIVERSAL_CHAT_MODEL = "gpt-5.5";
export const DEFAULT_UNIVERSAL_IMAGE_MODEL = "gemini-3.5-flash";

type ImageInput = { buffer: Buffer; mimeType: string; filename?: string };
const GARMENT_ATTR_KEYS = [
  "主色调",
  "整体版型",
  "长度",
  "领口设计",
  "袖型",
  "后背设计",
  "面料材质",
  "装饰细节",
] as const;

export type UniversalImageResult = {
  mimeType: string;
  data: Buffer;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

export function isUniversalModel(modelId: string): boolean {
  return modelId === UNIVERSAL_MODEL_ID;
}

export async function analyzeGarmentUniversal(
  images: Array<{ buffer: Buffer; mimeType: string }>,
  systemPrompt: string,
  userPrompt: string,
): Promise<Record<string, unknown>> {
  const endpoint = universalEndpoint("chat/completions");
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    { type: "text", text: buildStrictGarmentAnalyzePrompt(images.length, userPrompt) },
    ...images.map((img) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:${img.mimeType || "image/jpeg"};base64,${img.buffer.toString(
          "base64",
        )}`,
      },
    })),
  ];

  const response = await fetch(endpoint, {
    method: "POST",
    headers: universalHeaders("application/json"),
    body: JSON.stringify({
      model: getUniversalChatModel(),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  const json = await readJsonResponse(response, "通用模型文字解析失败");
  const text = extractChatText(json);
  const parsed = coerceGarmentAttrs(parseUniversalJsonText(text));
  parsed._meta = {
    model: getUniversalChatModel(),
    usageMetadata: normalizeUsage(json),
  };
  return parsed;
}

export async function generateImageUniversal(opts: {
  inputs: ImageInput[];
  prompt: string;
  aspectRatio?: string;
  imageSize?: "0.5K" | "1K" | "2K" | "4K";
}): Promise<UniversalImageResult> {
  const response =
    opts.inputs.length > 0
      ? await editImageUniversal(opts)
      : await generateImageUniversalFromText(opts);

  return unpackImageResponse(response, getUniversalImageModel());
}

async function generateImageUniversalFromText(opts: {
  prompt: string;
  aspectRatio?: string;
  imageSize?: "0.5K" | "1K" | "2K" | "4K";
}) {
  const endpoint = universalImageEndpoint("images/generations");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: universalImageHeaders("application/json"),
    body: JSON.stringify({
      model: getUniversalImageModel(),
      prompt: opts.prompt,
      size: imageSizeToSize(opts.aspectRatio, opts.imageSize),
      response_format: "b64_json",
    }),
  });
  return readJsonResponse(response, "通用模型图片生成失败");
}

async function editImageUniversal(opts: {
  inputs: ImageInput[];
  prompt: string;
  aspectRatio?: string;
  imageSize?: "0.5K" | "1K" | "2K" | "4K";
}) {
  const endpoint = universalImageEndpoint("images/edits");
  const form = new FormData();
  form.append("model", getUniversalImageModel());
  form.append("prompt", opts.prompt);
  form.append("size", imageSizeToSize(opts.aspectRatio, opts.imageSize));
  form.append("response_format", "b64_json");

  for (let i = 0; i < opts.inputs.length; i++) {
    const input = opts.inputs[i];
    const ext = mimeToExt(input.mimeType);
    const filename = input.filename || `input_${i}.${ext}`;
    form.append(
      "image",
      new Blob([new Uint8Array(input.buffer)], {
        type: input.mimeType || "image/jpeg",
      }),
      filename,
    );
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: universalImageHeaders(),
    body: form,
  });
  return readJsonResponse(response, "通用模型图片编辑失败");
}

async function unpackImageResponse(
  json: unknown,
  model: string,
): Promise<UniversalImageResult> {
  const data = json as {
    data?: Array<{ b64_json?: string; url?: string }>;
    images?: Array<{ b64_json?: string; url?: string }>;
  };
  const item = data.data?.[0] || data.images?.[0];
  const b64 = item?.b64_json;

  if (b64) {
    return {
      mimeType: "image/png",
      data: Buffer.from(b64, "base64"),
      model,
      usage: normalizeUsage(json),
    };
  }

  if (item?.url) {
    const response = await fetch(item.url);
    if (!response.ok) {
      throw new Error(`通用模型返回图片 URL，但下载失败：HTTP ${response.status}`);
    }
    const mimeType = response.headers.get("content-type") || "image/png";
    return {
      mimeType,
      data: Buffer.from(await response.arrayBuffer()),
      model,
      usage: normalizeUsage(json),
    };
  }

  throw new Error("通用模型没有返回图片");
}

function universalEndpoint(path: string): string {
  const baseUrl = (process.env.base_url || process.env.BASE_URL || "").trim();
  if (!baseUrl) {
    throw new Error("base_url 未配置，请在 .env.local 中填写通用模型接口地址。");
  }
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function universalImageEndpoint(path: string): string {
  const baseUrl = (
    process.env.base_image_url ||
    process.env.BASE_IMAGE_URL ||
    process.env.base_url ||
    process.env.BASE_URL ||
    ""
  ).trim();
  if (!baseUrl) {
    throw new Error(
      "base_image_url 未配置，请在 .env.local 中填写通用模型图片接口地址。",
    );
  }
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function getUniversalChatModel(): string {
  const model = (
    process.env.base_chat_model ||
    process.env.BASE_CHAT_MODEL ||
    DEFAULT_UNIVERSAL_CHAT_MODEL
  ).trim();
  return normalizeUniversalChatModel(model);
}

function normalizeUniversalChatModel(model: string): string {
  const trimmed = model.trim();
  const compact = trimmed.toLowerCase().replace(/[\s_]+/g, "-");
  if (/^chat-gpt-?/.test(compact)) {
    return compact.replace(/^chat-gpt-?/, "gpt-");
  }
  return trimmed;
}

function getUniversalImageModel(): string {
  const model = (
    process.env.base_image_model ||
    process.env.base_image_mode ||
    process.env.BASE_IMAGE_MODEL ||
    process.env.BASE_IMAGE_MODE ||
    DEFAULT_UNIVERSAL_IMAGE_MODEL
  ).trim();
  return normalizeUniversalImageModel(model);
}

function normalizeUniversalImageModel(model: string): string {
  const normalized = model.toLowerCase().replace(/[\s_.-]+/g, "");
  if (
    normalized === "gemini" ||
    normalized === "geminiflash" ||
    normalized === "geminiflashimage"
  ) {
    return "gemini-3.5-flash";
  }
  if (
    normalized === "image2" ||
    normalized === "image20" ||
    normalized === "gptimage2"
  ) {
    return "gpt-image-2";
  }
  return model;
}

function universalHeaders(contentType?: string): HeadersInit {
  const apiKey = (process.env.base_api || process.env.BASE_API || "").trim();
  if (!apiKey) {
    throw new Error("base_api 未配置，请在 .env.local 中填写通用模型 API Key。");
  }
  return {
    ...(contentType ? { "Content-Type": contentType } : {}),
    Authorization: `Bearer ${apiKey}`,
  };
}

function universalImageHeaders(contentType?: string): HeadersInit {
  const apiKey = (
    process.env.base_image_api ||
    process.env.BASE_IMAGE_API ||
    process.env.base_api ||
    process.env.BASE_API ||
    ""
  ).trim();
  if (!apiKey) {
    throw new Error(
      "base_image_api 未配置，请在 .env.local 中填写通用模型图片 API Key。",
    );
  }
  return {
    ...(contentType ? { "Content-Type": contentType } : {}),
    Authorization: `Bearer ${apiKey}`,
  };
}

async function readJsonResponse(response: Response, label: string) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label}：HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label}：返回不是 JSON：${text.slice(0, 500)}`);
  }
}

function extractChatText(json: unknown): string {
  const body = json as {
    choices?: Array<{ message?: { content?: unknown }; text?: string }>;
  };
  const content = body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        typeof part?.text === "string"
          ? part.text
          : typeof part === "string"
            ? part
            : "",
      )
      .join("");
    if (text) return text;
  }
  throw new Error("通用模型文字解析没有返回文本内容");
}

function parseUniversalJsonText(text: string): Record<string, unknown> {
  const cleaned = stripMarkdownJsonFence(text);
  const candidates = Array.from(
    new Set([text.trim(), cleaned, extractJsonObject(cleaned)]),
  ).filter(Boolean);

  let lastError = "";
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      lastError = "JSON root is not an object";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  const structured = parseGarmentKeyValueText(cleaned);
  if (structured) return structured;

  throw new Error(`通用模型返回内容不是有效 JSON：${lastError}`);
}

function buildStrictGarmentAnalyzePrompt(
  imageCount: number,
  userPrompt: string,
): string {
  return `${userPrompt}

请分析以下 ${imageCount} 张服装图片，并严格只返回一个 JSON 对象。
不要输出标题、解释、Markdown、代码块、列表前缀或任何 JSON 外文字。
看不到的内容填 "未提供"。

JSON 字段必须完全使用以下中文 key：
{
  "主色调": "衣服主色调的中文描述",
  "整体版型": "版型描述",
  "长度": "衣长或裙长",
  "领口设计": "领口样式",
  "袖型": "袖型",
  "后背设计": "背部设计；看不到填未提供",
  "面料材质": "面料材质",
  "装饰细节": ["核心装饰点1", "核心装饰点2"]
}

特别要求：
- "装饰细节" 必须是字符串数组。
- 所有字符串保持简短、商品化、中文表达。
- 返回内容第一个字符必须是 {，最后一个字符必须是 }。`;
}

function coerceGarmentAttrs(
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of GARMENT_ATTR_KEYS) {
    if (key === "装饰细节") {
      result[key] = normalizeDetailList(parsed[key]);
    } else {
      result[key] = normalizeAttrText(parsed[key]);
    }
  }
  return result;
}

function normalizeAttrText(value: unknown): string {
  if (typeof value === "string") return value.trim() || "未提供";
  if (Array.isArray(value)) {
    const joined = value.map((v) => String(v).trim()).filter(Boolean).join("、");
    return joined || "未提供";
  }
  if (value == null) return "未提供";
  return String(value).trim() || "未提供";
}

function normalizeDetailList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return splitDetailText(value);
  }
  return [];
}

function splitDetailText(value: string): string[] {
  return value
    .replace(/^未提供$/, "")
    .split(/[、，,；;\n]/)
    .map((item) => item.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

function parseGarmentKeyValueText(text: string): Record<string, unknown> | null {
  const normalized = text
    .replace(/\r/g, "\n")
    .replace(/[：]/g, ":")
    .replace(/\*\*/g, "");
  const result: Record<string, unknown> = {};

  for (let i = 0; i < GARMENT_ATTR_KEYS.length; i++) {
    const key = GARMENT_ATTR_KEYS[i];
    const nextKeys = GARMENT_ATTR_KEYS.slice(i + 1)
      .map((k) => escapeRegExp(k))
      .join("|");
    const endPattern = nextKeys ? `(?=\\n\\s*(?:[-•*]\\s*)?(?:${nextKeys})\\s*:|$)` : "$";
    const match = normalized.match(
      new RegExp(`(?:^|\\n)\\s*(?:[-•*]\\s*)?${escapeRegExp(key)}\\s*:\\s*([\\s\\S]*?)${endPattern}`),
    );
    if (!match) continue;
    const value = match[1]
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("、")
      .trim();
    result[key] = key === "装饰细节" ? splitDetailText(value) : value;
  }

  return Object.keys(result).length > 0 ? result : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripMarkdownJsonFence(text: string): string {
  const trimmed = text.trim().replace(/^\uFEFF/, "");
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1).trim();
  return text;
}

function normalizeUsage(json: unknown) {
  const usage = (json as { usage?: Record<string, unknown> }).usage;
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens as number | undefined,
    outputTokens: usage.completion_tokens as number | undefined,
    totalTokens: usage.total_tokens as number | undefined,
  };
}

function imageSizeToSize(
  aspectRatio?: string,
  imageSize?: "0.5K" | "1K" | "2K" | "4K",
) {
  const [w, h] = (aspectRatio || "3:4").split(":").map(Number);
  const portrait = h > w;
  const square = w === h;
  if (square) return imageSize === "4K" || imageSize === "2K" ? "2048x2048" : "1024x1024";
  if (portrait) {
    if (imageSize === "4K") return "2144x3824";
    if (imageSize === "2K") return "1440x2560";
    return "1024x1536";
  }
  if (imageSize === "4K") return "3824x2144";
  if (imageSize === "2K") return "2560x1440";
  return "1536x1024";
}

function mimeToExt(mimeType: string) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}
