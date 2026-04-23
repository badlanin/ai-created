/**
 * 图片文件上传 / 存储辅助
 *
 * - 所有素材图存到 DATA_DIR/uploads/<kind>/ 下，返回相对 DATA_DIR 的路径
 * - PNG 透明检测：简单判断 PNG 文件头
 * - 通过 /assets/[...path] 路由对外访问（已有）
 */
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR_PATH } from "./db";

export interface SavedUpload {
  /** 相对 DATA_DIR 的路径，如 "uploads/identities/abc.png" */
  relPath: string;
  /** 浏览器可访问的 URL，如 "/assets/uploads/identities/abc.png" */
  url: string;
  /** 字节数 */
  size: number;
  /** MIME 类型 */
  mimeType: string;
}

/**
 * 保存上传的 File 到 DATA_DIR/uploads/<kind>/
 *
 * @param file Web File 对象（来自 formData）
 * @param kind 子目录名，如 'identities' | 'scenes'
 * @param idHint 可选 id 前缀，方便调试
 */
export async function saveUploadFile(
  file: File,
  kind: string,
  idHint?: string | number,
): Promise<SavedUpload> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "image/jpeg";

  // 推断扩展名
  let ext = "bin";
  if (file.name.includes(".")) {
    ext = file.name.split(".").pop()!.toLowerCase();
  } else if (mimeType.includes("png")) {
    ext = "png";
  } else if (mimeType.includes("jpeg")) {
    ext = "jpg";
  } else if (mimeType.includes("webp")) {
    ext = "webp";
  }

  const safeKind = kind.replace(/[^a-z0-9_-]/gi, "");
  const dir = path.join(DATA_DIR_PATH, "uploads", safeKind);
  await fs.mkdir(dir, { recursive: true });

  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const idPart = idHint ? `${idHint}_` : "";
  const filename = `${idPart}${timestamp}_${rand}.${ext}`;
  const absPath = path.join(dir, filename);

  await fs.writeFile(absPath, buffer);

  const relPath = path.posix.join("uploads", safeKind, filename);
  return {
    relPath,
    url: `/assets/${relPath}`,
    size: buffer.length,
    mimeType,
  };
}

/**
 * 判断 PNG 是否带透明通道（IHDR 色类型包含 alpha）
 *
 * PNG 文件前 8 字节是签名：\x89PNG\r\n\x1a\n
 * 之后 4 字节长度 + 4 字节 'IHDR' + 13 字节 IHDR 数据
 * IHDR 第 9 字节 (offset 25) 是 color type：
 *   0 = Grayscale, 2 = RGB, 3 = Palette
 *   4 = Grayscale+Alpha, 6 = RGB+Alpha
 * color type 含 Alpha 则图像可能有透明像素（4 和 6）
 */
export async function checkPngTransparency(file: File): Promise<{
  isPng: boolean;
  hasAlphaChannel: boolean;
}> {
  const buf = Buffer.from(await file.slice(0, 32).arrayBuffer());
  const pngSig = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const isPng = buf.length >= 8 && buf.subarray(0, 8).equals(pngSig);
  if (!isPng) {
    return { isPng: false, hasAlphaChannel: false };
  }
  // color type 在 IHDR 数据里 offset = 8(sig) + 4(chunk len) + 4('IHDR') + 9 = 25
  const colorType = buf[25];
  const hasAlphaChannel = colorType === 4 || colorType === 6;
  return { isPng: true, hasAlphaChannel };
}

/**
 * 删除上传的文件（最佳 effort，错误被吞）
 */
export async function deleteUploadFile(relPath: string): Promise<void> {
  if (!relPath || !relPath.startsWith("uploads/")) return;
  const abs = path.join(DATA_DIR_PATH, relPath);
  try {
    await fs.unlink(abs);
  } catch {
    // ignore
  }
}
