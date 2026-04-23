/**
 * 从图片 buffer 里读取宽高和基本信息（不解码整张图）
 *
 * 支持 PNG 和 JPEG（WebP 暂不支持，Nano Banana 目前只输出 PNG/JPEG）
 */

export interface ImageInfo {
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
  format: "png" | "jpeg" | "unknown";
}

function readPngDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(pngSig)) return null;
  // IHDR chunk: 8 signature + 4 length + 4 'IHDR' = 16
  // Width: 4 bytes at offset 16, Height: 4 bytes at offset 20
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

function readJpegDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null; // SOI
  let i = 2;
  while (i + 8 < buffer.length) {
    if (buffer[i] !== 0xff) return null;
    const marker = buffer[i + 1];
    // SOF markers: 0xC0, 0xC1, 0xC2, 0xC3 (baseline, extended, progressive, lossless)
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3
    ) {
      // Skip marker(2) + length(2) + precision(1), then height(2) and width(2)
      const height = buffer.readUInt16BE(i + 5);
      const width = buffer.readUInt16BE(i + 7);
      return { width, height };
    }
    // Skip segment
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) return null;
    const segLen = buffer.readUInt16BE(i + 2);
    i += 2 + segLen;
  }
  return null;
}

export function readImageInfo(
  buffer: Buffer,
  mimeType: string,
): ImageInfo {
  const bytes = buffer.length;
  const format = mimeType.includes("png")
    ? "png"
    : mimeType.includes("jpeg") || mimeType.includes("jpg")
      ? "jpeg"
      : "unknown";

  let dim: { width: number; height: number } | null = null;
  if (format === "png") dim = readPngDimensions(buffer);
  else if (format === "jpeg") dim = readJpegDimensions(buffer);

  return {
    width: dim?.width ?? 0,
    height: dim?.height ?? 0,
    bytes,
    mimeType,
    format,
  };
}

/** 给日志用的紧凑格式：`1024x1536 PNG 1.2MB` */
export function formatImageInfo(info: ImageInfo): string {
  const mb = (info.bytes / 1024 / 1024).toFixed(2);
  return `${info.width}x${info.height} ${info.format.toUpperCase()} ${mb}MB`;
}
