import { GoogleGenAI } from "@google/genai";
import { getDb } from "./db";

/**
 * 统一构造 @google/genai 客户端
 *
 * 支持两种 provider，admin 后台可切换：
 *
 *   1. **vertex**（默认）：走 Vertex AI（GCP）
 *      - 需要 GCP_PROJECT_ID（环境变量）+ GCP_LOCATION
 *      - 鉴权用 ADC：环境变量 GOOGLE_APPLICATION_CREDENTIALS 指向的 JSON
 *        或 GCP VM 绑的 Service Account（metadata server）
 *      - 配额按 GCP project，preview 模型常被白名单限制
 *
 *   2. **gemini_api**：直连 Gemini API（aistudio.google.com）
 *      - 只需 settings 表里的 gemini_api_key
 *      - Tier 1（绑信用卡即解锁）≈ 10 RPM 起，秒杀 Vertex 默认 2 RPM
 *      - 同 model_id 字符串，无需改 prompt 或调用代码
 *
 * 切换方式：admin → 系统设置 → AI Provider 模式
 *
 * settings 字段：
 *   ai_provider     'vertex' | 'gemini_api'
 *   gemini_api_key  当 provider=gemini_api 时必填
 */

interface ProviderSettings {
  provider: "vertex" | "gemini_api";
  geminiApiKey: string;
}

/**
 * 从 settings 表读 provider 配置
 * 错误时回退到 vertex（向后兼容）
 */
function readProviderSettings(): ProviderSettings {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT key, value FROM settings WHERE key IN ('ai_provider', 'gemini_api_key')`,
      )
      .all() as Array<{ key: string; value: string }>;

    let provider: ProviderSettings["provider"] = "vertex";
    let geminiApiKey = "";
    for (const r of rows) {
      if (r.key === "ai_provider") {
        provider = r.value === "gemini_api" ? "gemini_api" : "vertex";
      } else if (r.key === "gemini_api_key") {
        geminiApiKey = (r.value || "").trim();
      }
    }
    return { provider, geminiApiKey };
  } catch (err) {
    console.warn(
      "[genai-client] 读 settings 失败，回退 vertex：",
      err instanceof Error ? err.message : err,
    );
    return { provider: "vertex", geminiApiKey: "" };
  }
}

export function buildGenaiClient(): GoogleGenAI {
  const settings = readProviderSettings();

  // ====== Gemini API 直连模式 ======
  if (settings.provider === "gemini_api") {
    if (!settings.geminiApiKey) {
      throw new Error(
        "AI Provider 设置为 gemini_api 但未配置 API key，请去 admin → 系统设置 填写",
      );
    }
    return new GoogleGenAI({ apiKey: settings.geminiApiKey });
  }

  // ====== Vertex AI 模式（默认）======
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || "us-central1";

  if (!project) {
    throw new Error(
      "缺少环境变量 GCP_PROJECT_ID。如果想改用 Gemini API key 模式，请去 admin → 系统设置 切换。",
    );
  }

  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });
}

/**
 * 给 admin UI 用：返回当前 provider 状态（不返回 key 明文）
 */
export function getCurrentProviderInfo(): {
  provider: "vertex" | "gemini_api";
  hasGeminiApiKey: boolean;
  geminiApiKeyMask: string;
  vertexProject: string | null;
  vertexLocation: string | null;
} {
  const s = readProviderSettings();
  const key = s.geminiApiKey;
  const mask =
    key.length === 0
      ? ""
      : key.length <= 8
        ? "*".repeat(key.length)
        : `${key.slice(0, 4)}${"*".repeat(Math.max(0, key.length - 8))}${key.slice(-4)}`;
  return {
    provider: s.provider,
    hasGeminiApiKey: key.length > 0,
    geminiApiKeyMask: mask,
    vertexProject: process.env.GCP_PROJECT_ID || null,
    vertexLocation: process.env.GCP_LOCATION || null,
  };
}
