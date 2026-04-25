/**
 * 缩略图 URL 助手（前端 + 后端通用）
 */

/**
 * 把 /assets/outputs/abc.png → /api/thumb?path=outputs/abc.png&w=400&fmt=webp
 *
 * 仅对服务器存储路径生效（/assets/* 开头）。
 * blob:// data:// 等本地 URL 直接透传。
 *
 * @param originalUrl 原始图片 URL
 * @param width      缩略图宽度（默认 400，3:4 容器约 200-400px 实际显示）
 */
export function getThumbUrl(originalUrl: string, width = 400): string {
  if (!originalUrl) return originalUrl;

  // 本地 URL 不能压缩，原样返回
  if (
    originalUrl.startsWith("blob:") ||
    originalUrl.startsWith("data:") ||
    originalUrl.startsWith("http:") ||
    originalUrl.startsWith("https:")
  ) {
    return originalUrl;
  }

  // /assets/xxx → /api/thumb?path=xxx
  if (originalUrl.startsWith("/assets/")) {
    const relPath = originalUrl.slice("/assets/".length);
    const w = Math.max(50, Math.min(2048, Math.round(width)));
    return `/api/thumb?path=${encodeURIComponent(relPath)}&w=${w}&fmt=webp&q=80`;
  }

  // 其他不识别的 URL 原样返回
  return originalUrl;
}
