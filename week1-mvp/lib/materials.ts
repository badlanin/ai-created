/**
 * 材质 / 真实感相关工具函数
 *
 * - 从"款式解析结果"文本里自动匹配材质库条目
 * - 把材质库条目格式化成 Prompt 文本
 * - 把真实感预设格式化成 Prompt 文本
 */
import { getDb } from "./db";

export interface MaterialRow {
  id: number;
  name: string;
  english_name: string | null;
  aliases: string | null;
  description: string | null;
  visual_traits: string | null;
  light_behavior: string | null;
  texture_rules: string | null;
  dont_confuse_with: string | null;
  sort_order: number;
}

export interface RealismPresetRow {
  id: number;
  name: string;
  description: string | null;
  constraints_text: string;
  is_default: 0 | 1;
  sort_order: number;
}

/**
 * 从一段自由文本（如款式解析的"面料材质"字段）里匹配材质库条目。
 *
 * 算法：
 * - 小写化所有文本
 * - 对每个材质，检查 name / english_name / aliases 里任一关键词是否出现在输入文本中
 * - 去重返回（按匹配的材质 id）
 *
 * 匹配策略故意保守：只要输入里"提到"了这个材质的任一关键词就算命中。
 * 适合给用户一个初始匹配，用户可以在 UI 上手动增删。
 */
export function autoMatchMaterials(
  inputText: string,
  allMaterials?: MaterialRow[],
): MaterialRow[] {
  const materials =
    allMaterials ?? (getAllMaterials() as MaterialRow[]);
  if (!inputText?.trim() || materials.length === 0) return [];

  const lower = inputText.toLowerCase();
  const matched: MaterialRow[] = [];

  for (const m of materials) {
    const keywords: string[] = [];
    if (m.name) keywords.push(m.name);
    if (m.english_name) keywords.push(m.english_name);
    if (m.aliases) {
      keywords.push(
        ...m.aliases
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }

    const hit = keywords.some((kw) => {
      const kwLower = kw.toLowerCase();
      return kwLower.length >= 2 && lower.includes(kwLower);
    });
    if (hit) matched.push(m);
  }

  return matched;
}

export function getAllMaterials(): MaterialRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, name, english_name, aliases, description,
              visual_traits, light_behavior, texture_rules, dont_confuse_with, sort_order
       FROM materials ORDER BY sort_order ASC, id ASC`,
    )
    .all() as MaterialRow[];
}

export function getMaterialsByIds(ids: number[]): MaterialRow[] {
  if (!ids || ids.length === 0) return [];
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT id, name, english_name, aliases, description,
              visual_traits, light_behavior, texture_rules, dont_confuse_with, sort_order
       FROM materials WHERE id IN (${placeholders})
       ORDER BY sort_order ASC, id ASC`,
    )
    .all(...ids) as MaterialRow[];
}

/**
 * 把一批材质格式化成 Prompt 的 {{material_details}} 段
 *
 * 输出示例：
 *
 *   【服装材质 / Fabric Material】
 *
 *   1. 雪纺 (chiffon)
 *      - 视觉特征：轻薄透明、质地柔软飘逸...
 *      - 光线特性：半透明，光线容易穿透...
 *      - 纹理规则：编织密度高但纱线细...
 *      - 禁止画成：不要画成缎面（无强反光）...
 *
 *   2. 蕾丝 (lace)
 *      ...
 */
export function formatMaterialDetails(materials: MaterialRow[]): string {
  if (!materials || materials.length === 0) return "";

  const lines: string[] = ["【服装材质 / Fabric Material】", ""];

  materials.forEach((m, idx) => {
    const n = idx + 1;
    const nameWithEn = m.english_name
      ? `${m.name} (${m.english_name})`
      : m.name;
    lines.push(`${n}. ${nameWithEn}`);
    if (m.visual_traits) lines.push(`   - 视觉特征：${m.visual_traits}`);
    if (m.light_behavior) lines.push(`   - 光线特性：${m.light_behavior}`);
    if (m.texture_rules) lines.push(`   - 纹理规则：${m.texture_rules}`);
    if (m.dont_confuse_with)
      lines.push(`   - 禁止画成：${m.dont_confuse_with}`);
    lines.push("");
  });

  if (materials.length > 1) {
    lines.push(
      "【重要】严格区分上述不同材质的表面属性。不要把一种材质的质感错画成另一种。",
    );
  }

  return lines.join("\n").trim();
}

/**
 * 读默认真实感预设，或指定 id 的
 */
export function getRealismPreset(id?: number | null): RealismPresetRow | null {
  const db = getDb();
  if (id != null && Number.isFinite(id)) {
    const hit = db
      .prepare(`SELECT * FROM realism_presets WHERE id = ?`)
      .get(id) as RealismPresetRow | undefined;
    if (hit) return hit;
  }
  const def = db
    .prepare(
      `SELECT * FROM realism_presets ORDER BY is_default DESC, sort_order ASC, id ASC LIMIT 1`,
    )
    .get() as RealismPresetRow | undefined;
  return def ?? null;
}

/**
 * 真实感预设格式化成 Prompt 段落
 */
export function formatRealismConstraints(
  preset: RealismPresetRow | null,
): string {
  if (!preset) return "";
  return preset.constraints_text.trim();
}
