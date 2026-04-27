import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * 敏感 setting key —— GET 返回 mask 字符串（前 4 + ✱ + 后 4），
 * 不暴露明文。这些 key 应通过专门的 /admin/settings 页面管理
 * （走 /api/settings provider endpoint，已有完整的 password 输入 + 留空=不改流程）。
 *
 * 想增加敏感 key 在这里添加即可，所有渲染 settings 列表的页面都会自动安全。
 */
const SENSITIVE_KEYS = new Set<string>(["gemini_api_key"]);

/**
 * 把明文按"前 4 + ✱ + 后 4"格式 mask，与 lib/genai-client.ts 的 geminiApiKeyMask 一致。
 */
function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(Math.max(0, value.length - 8))}${value.slice(-4)}`;
}

/**
 * 判断一个字符串是不是 mask 形态（防止前端把 mask 原样回写）：
 *   - 全是 ✱
 *   - 中段含 ≥3 连续 ✱
 */
function looksLikeMask(value: string): boolean {
  if (!value) return false;
  if (/^\*+$/.test(value)) return true;
  return /\*{3,}/.test(value);
}

/**
 * GET /api/admin/settings
 * 列出所有全局配置（汇率等）。敏感 key 的 value 字段返回 mask 字符串，
 * 并附带 sensitive: true 标记，前端可据此渲染只读 + 跳转编辑链接。
 */
export async function GET() {
  try {
    await requireAdmin();
    const db = getDb();
    const rows = db
      .prepare(`SELECT key, value, notes, updated_at FROM settings ORDER BY key`)
      .all() as Array<{
        key: string;
        value: string;
        notes: string | null;
        updated_at: number;
      }>;
    const safeRows = rows.map((r) => {
      if (SENSITIVE_KEYS.has(r.key)) {
        return {
          ...r,
          value: maskValue(r.value || ""),
          sensitive: true as const,
        };
      }
      return { ...r, sensitive: false as const };
    });
    return NextResponse.json(safeRows);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}

/**
 * PATCH /api/admin/settings
 * body: { key, value }
 * upsert 一条配置。
 *
 * 对敏感 key 做防御：
 *   - 空值 → 拒绝（避免误清空，专门清空请走 /admin/settings 页面）
 *   - mask 形态 → 拒绝（避免前端把 mask 原样回写覆盖真 key）
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as { key?: string; value?: string };
    const key = (body.key || "").trim();
    const value = (body.value ?? "").toString();
    if (!key) {
      return NextResponse.json({ error: "key 必填" }, { status: 400 });
    }
    if (SENSITIVE_KEYS.has(key)) {
      if (!value.trim()) {
        return NextResponse.json(
          {
            error: `敏感配置 "${key}" 不允许通过此接口设置为空。请前往 /admin/settings 管理。`,
          },
          { status: 400 },
        );
      }
      if (looksLikeMask(value)) {
        return NextResponse.json(
          {
            error: `检测到 "${key}" 的值是 mask 字符串而非明文，已拒绝写入以保护现有 key。请前往 /admin/settings 输入新的 API key。`,
          },
          { status: 400 },
        );
      }
    }
    const db = getDb();
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
    ).run(key, value);
    const row = db
      .prepare(`SELECT key, value, notes, updated_at FROM settings WHERE key = ?`)
      .get(key) as {
        key: string;
        value: string;
        notes: string | null;
        updated_at: number;
      } | undefined;
    if (row && SENSITIVE_KEYS.has(row.key)) {
      return NextResponse.json({
        ...row,
        value: maskValue(row.value || ""),
        sensitive: true,
      });
    }
    return NextResponse.json(row ? { ...row, sensitive: false } : null);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
