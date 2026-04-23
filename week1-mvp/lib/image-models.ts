/**
 * 图像生成可选模型列表（前后端共用）
 *
 * Nano Banana 命名对照：
 *   - Nano Banana (初代/2.5 版) = Gemini 2.5 Flash Image
 *   - Nano Banana Pro / 2      = Gemini 3 Pro Image
 *
 * 各区域上线的模型可能不同。`asia-southeast1`（新加坡）目前只有
 * `gemini-3-pro-image-preview`，没有 2.5 Flash Image。可以通过
 * Vertex AI 控制台的 Model Garden 查看当前区域实际可用的模型 ID。
 */
export interface ImageModelOption {
  id: string;
  label: string;
  desc: string;
  badge?: string;
}

export const IMAGE_MODELS: ImageModelOption[] = [
  {
    id: "gemini-3-pro-image-preview",
    label: "Nano Banana Pro",
    desc: "Gemini 3 Pro Image · 质量最高，指令跟随更强",
    badge: "推荐",
  },
  {
    id: "gemini-2.5-flash-image-preview",
    label: "Nano Banana",
    desc: "Gemini 2.5 Flash Image Preview · 初代，速度略快",
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Nano Banana (GA)",
    desc: "Gemini 2.5 Flash Image 正式版 · 部分区域可用",
  },
];

/**
 * 默认模型 ID。环境变量 GEMINI_IMAGE_MODEL 可覆盖。
 */
export const DEFAULT_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";

/**
 * 校验前端传来的 model 是否在白名单内，避免任意 ID 透传
 */
export function resolveImageModel(input?: string | null): string {
  if (!input) return DEFAULT_IMAGE_MODEL;
  const hit = IMAGE_MODELS.find((m) => m.id === input);
  return hit ? hit.id : DEFAULT_IMAGE_MODEL;
}
