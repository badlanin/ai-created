/**
 * 客户端批量下载 + 打 ZIP
 *
 * 用法：downloadImagesAsZip([{url, filename}, ...], 'batch.zip')
 *
 * 只能在浏览器用（因为用 fetch + blob + JSZip）
 */
import JSZip from "jszip";

export interface ZipEntry {
  url: string;
  filename: string;
}

export async function downloadImagesAsZip(
  entries: ZipEntry[],
  zipName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (entries.length === 0) return;

  const zip = new JSZip();
  let done = 0;
  const total = entries.length;

  // 下载并加入 zip（串行避免浏览器并发限制）
  for (const entry of entries) {
    try {
      const res = await fetch(entry.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      zip.file(entry.filename, blob);
    } catch (e) {
      console.warn(`[zip] skip ${entry.url}:`, e);
    }
    done++;
    onProgress?.(done, total);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 单张图 URL → 触发浏览器下载（不经过 ZIP，直接保存）
 */
export async function downloadSingleImage(
  url: string,
  filename: string,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objUrl);
}
