/**
 * 场景分类常量 —— 前端 / 后端共享
 *
 * 对应 scenes 表的 category 字段。
 * - key：存数据库的稳定字符串（英文 snake_case 风格）
 * - label：UI 上的中文显示名
 *
 * 想加新分类：在这里添加 key + 中文 + 排序位置即可。
 * API 会按白名单验证；前端按 ORDER 数组顺序展示折叠组。
 */

export const SCENE_CATEGORY_LABELS: Record<string, string> = {
  wedding: "婚礼",
  outdoor: "户外",
  studio: "影棚",
  street: "街拍",
  indoor: "室内",
  garden: "花园",
};

export const SCENE_CATEGORY_ORDER: string[] = [
  "wedding",
  "outdoor",
  "studio",
  "street",
  "indoor",
  "garden",
];

/** [{ key, label }] 形态，方便前端直接 .map 出 select option */
export const SCENE_CATEGORY_LIST = SCENE_CATEGORY_ORDER.map((key) => ({
  key,
  label: SCENE_CATEGORY_LABELS[key],
}));

/** 给定 key 拿到 label；未配置 / 空 key 返回空串 */
export function sceneCategoryLabel(key: string | null | undefined): string {
  if (!key) return "";
  return SCENE_CATEGORY_LABELS[key] || key;
}
