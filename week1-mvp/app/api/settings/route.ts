import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getCurrentProviderInfo } from "@/lib/genai-client";
import {
  refreshRateFromSettings,
  refreshConcurrencyFromSettings,
} from "@/lib/rate-limiter";

export const runtime = "nodejs";

// 限流相关 key，更新后需要 hot-reload
const RATE_KEYS = new Set([
  "image_rate_limit_per_min",
  "image_rate_burst",
]);
const CONCURRENCY_KEYS = new Set(["image_concurrency"]);

/**
 * 系统设置 API（仅管理员）
 *
 * GET    /api/settings
 *   返回所有 settings + 当前 provider 状态
 *   gemini_api_key 字段会被脱敏（只露前 4 + 后 4，中间 *）
 *
 * PATCH  /api/settings  body: { gemini_api_key?: string, ...其他 key: value }
 *   更新指定 settings。空字符串 = 清空。
 */

interface SettingRow {
  key: string;
  value: string;
  notes: string | null;
}

const ALLOWED_PATCH_KEYS = new Set([
  "gemini_api_key",
  "openai_api_key",
  "openai_proxy_url",
  "openai_ipm_limit",
  "usd_to_cny",
  "default_budget_cny",
  "image_rate_limit_per_min",
  "image_rate_burst",
  "image_concurrency",
]);

const SECRET_KEYS = new Set(["gemini_api_key", "openai_api_key"]);

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(Math.max(0, value.length - 8))}${value.slice(-4)}`;
}

export async function GET() {
  try {
    await requireAdmin();
    const db = getDb();
    const rows = db
      .prepare(`SELECT key, value, notes FROM settings ORDER BY key ASC`)
      .all() as SettingRow[];

    const safe = rows.map((r) => ({
      key: r.key,
      value: SECRET_KEYS.has(r.key) ? maskSecret(r.value) : r.value,
      hasValue: r.value.length > 0,
      isSecret: SECRET_KEYS.has(r.key),
      notes: r.notes,
    }));

    return NextResponse.json({
      settings: safe,
      provider: getCurrentProviderInfo(),
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as Record<string, unknown>;

    const updates: Array<{ key: string; value: string }> = [];
    for (const [k, v] of Object.entries(body)) {
      if (!ALLOWED_PATCH_KEYS.has(k)) continue;
      // gemini_api_key：允许空字符串（= 清空）；非空时简单格式校验（AIza 开头，39 字符）
      if (k === "gemini_api_key" && typeof v === "string" && v.length > 0) {
        if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(v)) {
          return NextResponse.json(
            {
              error:
                "gemini_api_key 格式不正确，应为 'AIza' 开头的字符串。请去 https://aistudio.google.com/app/apikey 重新复制。",
            },
            { status: 400 },
          );
        }
      }
      // openai_api_key：'sk-' 开头
      if (k === "openai_api_key" && typeof v === "string" && v.length > 0) {
        if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(v)) {
          return NextResponse.json(
            {
              error:
                "openai_api_key 格式不正确，应为 'sk-' 开头。去 https://platform.openai.com/api-keys 申请。",
            },
            { status: 400 },
          );
        }
      }
      // openai_proxy_url：必须是 http:// 或 https:// 开头（可空）
      if (k === "openai_proxy_url" && typeof v === "string" && v.length > 0) {
        if (!/^https?:\/\//.test(v)) {
          return NextResponse.json(
            {
              error:
                "openai_proxy_url 必须以 http:// 或 https:// 开头，例如 http://127.0.0.1:7892",
            },
            { status: 400 },
          );
        }
      }
      updates.push({ key: k, value: v == null ? "" : String(v) });
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
    }

    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO settings (key, value, notes) VALUES (?, ?, '')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
    );
    const tx = db.transaction(() => {
      for (const u of updates) stmt.run(u.key, u.value);
    });
    tx();

    // Hot-reload 限流 / 并发缓存（避免要重启容器才生效）
    const updatedKeys = new Set(updates.map((u) => u.key));
    if ([...updatedKeys].some((k) => RATE_KEYS.has(k))) {
      try {
        refreshRateFromSettings();
      } catch (e) {
        console.warn("[settings] refreshRateFromSettings 失败:", e);
      }
    }
    if ([...updatedKeys].some((k) => CONCURRENCY_KEYS.has(k))) {
      try {
        refreshConcurrencyFromSettings();
      } catch (e) {
        console.warn("[settings] refreshConcurrencyFromSettings 失败:", e);
      }
    }

    // 返回更新后的最新值（脱敏）
    const rows = db
      .prepare(`SELECT key, value, notes FROM settings ORDER BY key ASC`)
      .all() as SettingRow[];
    const safe = rows.map((r) => ({
      key: r.key,
      value: SECRET_KEYS.has(r.key) ? maskSecret(r.value) : r.value,
      hasValue: r.value.length > 0,
      isSecret: SECRET_KEYS.has(r.key),
      notes: r.notes,
    }));

    return NextResponse.json({
      ok: true,
      updated: updates.map((u) => u.key),
      settings: safe,
      provider: getCurrentProviderInfo(),
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
