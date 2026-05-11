import { GoogleGenAI } from "@google/genai";
import { getDb } from "./db";

/**
 * 统一构造 @google/genai 客户端（仅 Gemini API key 模式）
 *
 * 历史上支持过 Vertex AI ADC 模式，已在 2026-05 简化为只支持
 * Gemini API key（aistudio.google.com）—— 删 Vertex 是因为：
 *   - 团队全部用 API key 模式跑，ADC 配置维护成本高
 *   - settings 表已存好 key，零配置
 *
 * settings 字段：
 *   gemini_api_key  必填，从 https://aistudio.google.com/app/apikey 申请
 *
 * 老表里残留的 ai_provider 字段已不再读取，可保留也可清理。
 */

interface ProviderSettings {
  geminiApiKey: string;
}

function readProviderSettings(): ProviderSettings {
  try {
    const db = getDb();
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = 'gemini_api_key'`)
      .get() as { value: string } | undefined;
    return { geminiApiKey: (row?.value || "").trim() };
  } catch (err) {
    console.warn(
      "[genai-client] 读 settings 失败：",
      err instanceof Error ? err.message : err,
    );
    return { geminiApiKey: "" };
  }
}

export function buildGenaiClient(): GoogleGenAI {
  const settings = readProviderSettings();
  if (!settings.geminiApiKey) {
    throw new Error(
      "Gemini API key 未配置。请去 admin → 系统设置 → 填入从 aistudio.google.com 申请的 key 后重试。",
    );
  }
  return new GoogleGenAI({ apiKey: settings.geminiApiKey });
}

/**
 * 给 admin UI 用：返回当前 key 配置状态（不返回明文）
 */
export function getCurrentProviderInfo(): {
  hasGeminiApiKey: boolean;
  geminiApiKeyMask: string;
  hasOpenaiApiKey: boolean;
  openaiApiKeyMask: string;
  openaiProxyUrl: string;
} {
  const s = readProviderSettings();
  const mask = (k: string) => {
    if (!k) return "";
    if (k.length <= 8) return "*".repeat(k.length);
    return `${k.slice(0, 4)}${"*".repeat(Math.max(0, k.length - 8))}${k.slice(-4)}`;
  };

  // 顺便读 OpenAI key + proxy
  let openaiKey = "";
  let openaiProxy = "";
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT key, value FROM settings WHERE key IN ('openai_api_key', 'openai_proxy_url')`,
      )
      .all() as Array<{ key: string; value: string }>;
    for (const r of rows) {
      if (r.key === "openai_api_key") openaiKey = (r.value || "").trim();
      if (r.key === "openai_proxy_url") openaiProxy = (r.value || "").trim();
    }
  } catch {}

  return {
    hasGeminiApiKey: s.geminiApiKey.length > 0,
    geminiApiKeyMask: mask(s.geminiApiKey),
    hasOpenaiApiKey: openaiKey.length > 0,
    openaiApiKeyMask: mask(openaiKey),
    openaiProxyUrl: openaiProxy,
  };
}
