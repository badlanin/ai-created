/**
 * AI 模型读取/校验工具层（服务端用，读 DB）
 *
 * 两类模型：
 *  - vision     : 视觉理解 → /analyze 解析图片
 *  - image_gen  : 图像生成 → /recolor 换色、/on-model 换模特
 *
 * 管理员可在 /admin/ai-models 页面增删/启停/设默认。
 *
 * 前端面向用户的列表用 GET /api/ai-models?category= 拿 enabled 项。
 */
import { getDb } from "./db";

export type AiModelCategory = "vision" | "image_gen";

export interface AiModelRow {
  id: number;
  model_id: string;
  label: string;
  description: string | null;
  category: AiModelCategory;
  enabled: 0 | 1;
  is_default: 0 | 1;
  badge: string | null;
  sort_order: number;
  created_at: number;
}

/**
 * 拿某 category 下所有 enabled 的模型，排序按 is_default 优先再按 sort_order
 */
export function getEnabledModels(category: AiModelCategory): AiModelRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM ai_models
       WHERE category = ? AND enabled = 1
       ORDER BY is_default DESC, sort_order ASC, id ASC`,
    )
    .all(category) as AiModelRow[];
}

/**
 * 管理员用：列出某 category 下所有模型（不管是否 enabled）
 */
export function getAllModels(category?: AiModelCategory): AiModelRow[] {
  const db = getDb();
  if (category) {
    return db
      .prepare(
        `SELECT * FROM ai_models WHERE category = ? ORDER BY sort_order ASC, id ASC`,
      )
      .all(category) as AiModelRow[];
  }
  return db
    .prepare(
      `SELECT * FROM ai_models ORDER BY category ASC, sort_order ASC, id ASC`,
    )
    .all() as AiModelRow[];
}

/**
 * 拿某 category 的默认模型 model_id 字符串。
 * 若没有显式 is_default，回落到 sort_order 最小的 enabled 项。
 * 再不行才抛错（数据库 seed 失败等极端场景）。
 */
export function getDefaultModelId(category: AiModelCategory): string {
  const db = getDb();
  const hit = db
    .prepare(
      `SELECT model_id FROM ai_models
       WHERE category = ? AND enabled = 1
       ORDER BY is_default DESC, sort_order ASC, id ASC
       LIMIT 1`,
    )
    .get(category) as { model_id: string } | undefined;
  if (!hit) {
    throw new Error(
      `没有可用的 ${category} 模型，请在 /admin/ai-models 页面启用至少一个`,
    );
  }
  return hit.model_id;
}

/**
 * 前端把 model_id 传过来时，校验它是否确实是白名单里启用的、而且 category 匹配。
 * 不在白名单就回落到默认值（而不是拒绝请求，UX 更顺）。
 */
export function resolveModelId(
  category: AiModelCategory,
  input?: string | null,
): string {
  const db = getDb();
  if (input) {
    const hit = db
      .prepare(
        `SELECT model_id FROM ai_models
         WHERE category = ? AND model_id = ? AND enabled = 1`,
      )
      .get(category, input) as { model_id: string } | undefined;
    if (hit) return hit.model_id;
  }
  return getDefaultModelId(category);
}
