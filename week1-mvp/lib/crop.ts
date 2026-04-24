/**
 * 图片裁剪辅助（客户端）
 *
 * react-easy-crop 返回的 croppedAreaPixels：{ x, y, width, height }（单位：原图像素）
 * 用 canvas 把这块区域切出来，导出成新 Blob
 */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 根据裁剪区域生成新的 Blob
 *
 * @param imageSrc  图片 URL（通常是 URL.createObjectURL 生成的 blob URL）
 * @param area      裁剪区域（像素）
 * @param mimeType  导出 MIME，默认 jpeg 0.95
 */
export async function getCroppedBlob(
  imageSrc: string,
  area: CropArea,
  mimeType: "image/jpeg" | "image/png" = "image/jpeg",
  quality = 0.95,
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(area.width);
  canvas.height = Math.round(area.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 不可用");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("裁剪失败"))),
      mimeType,
      quality,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

/**
 * 读取图片原始尺寸
 */
export async function getImageSize(
  src: string,
): Promise<{ width: number; height: number }> {
  const img = await loadImage(src);
  return { width: img.naturalWidth, height: img.naturalHeight };
}
