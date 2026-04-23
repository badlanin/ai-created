/**
 * 兼容层（已迁移到 lib/ai-models.ts）
 *
 * 旧代码里用到的 resolveImageModel / IMAGE_MODELS / DEFAULT_IMAGE_MODEL
 * 这里转发到新的 ai-models 实现（image_gen 分类）。
 *
 * 新代码请直接 import from "./ai-models"。
 */
import { resolveModelId, getEnabledModels } from "./ai-models";

export function resolveImageModel(input?: string | null): string {
  return resolveModelId("image_gen", input);
}

/**
 * 旧接口：返回当前启用的图像生成模型列表
 * 注意：服务端才能用（会读 DB）。客户端请走 GET /api/ai-models?category=image_gen
 */
export function getImageModels() {
  return getEnabledModels("image_gen");
}
