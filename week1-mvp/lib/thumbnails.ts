/**
 * 缩略图按需生成 + 磁盘缓存
 *
 * ─────────────────────────────────────────────
 * 工作流：
 *   GET /api/thumb?path=outputs/abc.png&w=400&q=80&fmt=webp
 *     ↓
 *   1. 算 cache key = sha256(path+w+q+fmt) → 16 位 hash
 *   2. 检查 data/_thumbs/<hash>.<fmt> 是否存在
 *      ├─ 存在：直接读返回（毫秒级）
 *      └─ 不存在：sharp 读原图 → 缩 → 转格式 → 写盘 → 返回
 *   3. 响应头 Cache-Control 长缓存
 *
 * 优点：
 *   - 旧文件也能享受缩略图（首次请求时生成）
 *   - 不动 DB schema
 *   - 缓存命中后 << 1ms 返回
 *   - 单文件缓存 50-200KB（vs 原图 4-5MB）→ 25x 减小
 * ─────────────────────────────────────────────
 */

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { DATA_DIR_PATH } from "./db";

const THUMB_CACHE_DIR = path.join(DATA_DIR_PATH, "_thumbs");

/** 允许生成缩略图的目录前缀（安全限制，防路径穿越） */
const ALLOWED_PREFIXES = ["outputs/", "uploads/"];

/** 支持的输出格式 */
export type ThumbFormat = "webp" | "jpeg" | "avif";

export interface ThumbOptions {
  /** 目标宽度（像素），高度自适应保持比例。默认 400 */
  width?: number;
  /** 压缩质量 30-100，默认 80 */
  quality?: number;
  /** 输出格式，默认 webp（兼容性 + 体积平衡最佳） */
  format?: ThumbFormat;
}

export interface ThumbResult {
  data: Buffer;
  mimeType: string;
  cacheHit: boolean;
  /** 原图字节数，用于诊断 */
  originalSize: number;
  /** 缩略图字节数 */
  thumbSize: number;
}

/**
 * 验证 relativePath 在允许目录内 + 不含路径穿越
 */
function isPathSafe(relativePath: string): boolean {
  if (!relativePath) return false;
  if (relativePath.includes("..")) return false;
  if (relativePath.startsWith("/")) return false;
  if (relativePath.includes("\0")) return false;
  return ALLOWED_PREFIXES.some((p) => relativePath.startsWith(p));
}

/** 计算缓存路径 */
function computeCachePath(
  relativePath: string,
  width: number,
  quality: number,
  format: ThumbFormat,
): string {
  const key = crypto
    .createHash("sha256")
    .update(`${relativePath}:${width}:${quality}:${format}`)
    .digest("hex")
    .slice(0, 16);
  return path.join(THUMB_CACHE_DIR, `${key}.${format}`);
}

/** mime 类型 */
function mimeOf(format: ThumbFormat): string {
  return format === "webp"
    ? "image/webp"
    : format === "avif"
      ? "image/avif"
      : "image/jpeg";
}

/**
 * 取或生成缩略图
 *
 * @throws Error 路径不合法 / 原图不存在 / sharp 处理失败
 */
export async function getOrGenerateThumb(
  relativePath: string,
  options: ThumbOptions = {},
): Promise<ThumbResult> {
  if (!isPathSafe(relativePath)) {
    throw Object.assign(new Error("路径不在允许范围"), { status: 403 });
  }

  const width = Math.min(2048, Math.max(50, options.width ?? 400));
  const quality = Math.min(100, Math.max(30, options.quality ?? 80));
  const format = options.format ?? "webp";

  const cachePath = computeCachePath(relativePath, width, quality, format);

  // 1) 尝试缓存命中
  try {
    const data = await fs.readFile(cachePath);
    return {
      data,
      mimeType: mimeOf(format),
      cacheHit: true,
      originalSize: -1,
      thumbSize: data.length,
    };
  } catch {
    // miss，继续生成
  }

  // 2) 读原图
  const originalAbsPath = path.join(DATA_DIR_PATH, relativePath);
  let original: Buffer;
  try {
    original = await fs.readFile(originalAbsPath);
  } catch {
    throw Object.assign(new Error(`原图不存在：${relativePath}`), {
      status: 404,
    });
  }

  // 3) sharp 处理
  let pipeline = sharp(original, {
    failOn: "none", // 容忍 PNG 警告等小问题
  }).resize(width, null, {
    fit: "inside",
    withoutEnlargement: true, // 原图本身比 width 小就不放大
  });

  if (format === "webp") {
    pipeline = pipeline.webp({ quality, effort: 4 });
  } else if (format === "avif") {
    pipeline = pipeline.avif({ quality, effort: 4 });
  } else {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  }

  const data = await pipeline.toBuffer();

  // 4) 写入缓存（fire-and-forget，不阻塞返回）
  void fs
    .mkdir(THUMB_CACHE_DIR, { recursive: true })
    .then(() => fs.writeFile(cachePath, data))
    .catch((e) => {
      console.warn("[thumbnails] 缓存写入失败:", e);
    });

  return {
    data,
    mimeType: mimeOf(format),
    cacheHit: false,
    originalSize: original.length,
    thumbSize: data.length,
  };
}

/**
 * 清空缩略图缓存（管理员用，手动调用）
 */
export async function clearThumbCache(): Promise<number> {
  try {
    const files = await fs.readdir(THUMB_CACHE_DIR);
    let count = 0;
    for (const f of files) {
      try {
        await fs.unlink(path.join(THUMB_CACHE_DIR, f));
        count += 1;
      } catch {}
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * 取缩略图缓存统计（管理员诊断）
 */
export async function getThumbCacheStats(): Promise<{
  count: number;
  totalBytes: number;
}> {
  try {
    const files = await fs.readdir(THUMB_CACHE_DIR);
    let totalBytes = 0;
    for (const f of files) {
      try {
        const st = await fs.stat(path.join(THUMB_CACHE_DIR, f));
        totalBytes += st.size;
      } catch {}
    }
    return { count: files.length, totalBytes };
  } catch {
    return { count: 0, totalBytes: 0 };
  }
}
