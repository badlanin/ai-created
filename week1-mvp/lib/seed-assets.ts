/**
 * Seed 资源助手
 *
 * 部署时打包进镜像的"种子资源"在 <repo>/seed-assets/。
 * 首次启动时（DB 表为空）把这些资源拷贝到 DATA_DIR/uploads/<kind>/，
 * 让运行期 URL（/assets/uploads/...）继续生效。
 *
 * 资源结构（约定）：
 *   seed-assets/
 *     identities/
 *       manifest.json                 [{ file, name, category, category_label, tags?, sort_order }]
 *       universal/universal_01.webp
 *       plus_size/plus_size_01.webp
 *       maternity/...
 *       teen/...
 *     scenes/
 *       manifest.json                 [{ file, name, tags?, sort_order }]
 *       scene_01.webp
 *     colors.json                     [{ name, hex, color_group, color_group_label, is_popular?, note?, sort_order }]
 */
import fs from "fs";
import path from "path";

import { DATA_DIR_PATH } from "./db";

/**
 * seed-assets 根目录绝对路径
 *
 * - 开发：项目根目录下的 seed-assets/
 * - 生产（standalone）：Dockerfile 显式 COPY 到 /app/seed-assets/
 *   process.cwd() 在 standalone 模式下也是 /app
 */
export function getSeedAssetsRoot(): string {
  return path.join(process.cwd(), "seed-assets");
}

/**
 * 通用 manifest 行（identities / scenes 都用）
 */
export interface SeedAssetEntry {
  /** 相对 seed-assets/ 的路径，例如 "identities/universal/universal_01.webp" */
  file: string;
  name: string;
  tags?: string;
  sort_order: number;
  // identities 专有
  category?: string;
  category_label?: string;
}

/**
 * 复制一个 seed 资源到 DATA_DIR/uploads/<kind>/，返回 DB 里要存的相对路径。
 * 文件已存在则跳过复制（保证幂等）。
 */
export function copySeedAsset(
  srcRelPath: string,
  destKind: string,
): {
  /** 写入 DB 的 image_path（"uploads/identities/identity_universal_01.webp"） */
  relPath: string;
  /** 实际是否复制了（false = 已存在，跳过） */
  copied: boolean;
} {
  const srcAbs = path.join(getSeedAssetsRoot(), srcRelPath);
  if (!fs.existsSync(srcAbs)) {
    throw new Error(`seed asset not found: ${srcAbs}`);
  }

  // 目标文件名：保留原 basename，避免名字冲突时加前缀
  const baseName = path.basename(srcRelPath);
  const safeKind = destKind.replace(/[^a-z0-9_-]/gi, "");
  const destDir = path.join(DATA_DIR_PATH, "uploads", safeKind);
  const destAbs = path.join(destDir, baseName);

  fs.mkdirSync(destDir, { recursive: true });

  let copied = false;
  if (!fs.existsSync(destAbs)) {
    fs.copyFileSync(srcAbs, destAbs);
    copied = true;
  }

  // DB 存的是 posix 风格相对路径
  const relPath = path
    .posix.join("uploads", safeKind, baseName);
  return { relPath, copied };
}

/**
 * 读取并解析 manifest.json
 */
export function readManifest<T>(relPath: string): T {
  const abs = path.join(getSeedAssetsRoot(), relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`seed manifest not found: ${abs}`);
  }
  const raw = fs.readFileSync(abs, "utf-8");
  return JSON.parse(raw) as T;
}

/**
 * 检查 seed-assets 目录是否存在
 * 不存在不报错（dev 环境下可能没拉这套资源）
 */
export function hasSeedAssets(): boolean {
  return fs.existsSync(getSeedAssetsRoot());
}
