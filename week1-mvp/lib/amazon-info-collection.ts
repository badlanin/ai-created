import { randomUUID } from "crypto";
import { getDb } from "./db";

export type AmazonCollectionStatus =
  | "queued"
  | "collecting"
  | "cleaning"
  | "ai_ready"
  | "completed"
  | "failed";

export type AmazonCollectionJobStatus =
  | "imported"
  | "running"
  | "completed"
  | "failed";

export type AmazonCollectionLogLevel = "info" | "warn" | "error";

export interface AmazonCollectionJob {
  id: string;
  user_id: number;
  name: string;
  status: AmazonCollectionJobStatus;
  phase: string;
  total_count: number;
  collected_count: number;
  failed_count: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface AmazonCollectionItem {
  id: number;
  job_id: string;
  user_id: number;
  url: string;
  status: AmazonCollectionStatus;
  source_title: string | null;
  price: string | null;
  color: string | null;
  sizes_json: string | null;
  image_urls_json: string | null;
  product_id: string | null;
  ai_title: string | null;
  ai_bullets_json: string | null;
  search_terms: string | null;
  excel_range: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export interface AmazonCollectionLog {
  id: number;
  job_id: string;
  item_id: number | null;
  level: AmazonCollectionLogLevel;
  message: string;
  created_at: number;
}

export interface AmazonFieldMapping {
  id: number;
  user_id: number;
  source_field: string;
  sample_value: string;
  excel_column: string;
  target_label: string;
  data_type: string;
  required: number;
  clean_rule: string;
  sort_order: number;
}

export interface AmazonDashboardData {
  job: AmazonCollectionJob | null;
  summary: {
    total: number;
    collected: number;
    pending: number;
    failed: number;
  };
  items: AmazonCollectionItemView[];
  logs: AmazonCollectionLog[];
  mappings: AmazonFieldMapping[];
}

export interface AmazonCollectionItemView {
  id: number;
  jobId: string;
  url: string;
  status: AmazonCollectionStatus;
  sourceTitle: string;
  price: string;
  color: string;
  sizes: string[];
  imageUrls: string[];
  productId: string;
  aiTitle: string;
  aiBullets: string[];
  searchTerms: string;
  excelRange: string;
  errorMessage: string;
  createdAt: number;
  updatedAt: number;
}

type ScrapedProduct = {
  title: string;
  price: string;
  color: string;
  sizes: string[];
  imageUrls: string[];
  productId: string;
};

const activeRuns = new Set<string>();

const DEFAULT_MAPPINGS = [
  ["source_title", "Women's A-Line Dress Knee...", "Sheet1!B", "标题", "文本", 1, "去除多余空格"],
  ["price", "US $28.99", "Sheet1!C", "价格 (USD)", "文本", 1, "保留数字和小数点"],
  ["color", "白色", "Sheet1!D", "颜色", "文本", 1, "标准化颜色名称"],
  ["sizes", "S,M,L,XL", "Sheet1!E", "尺码", "文本", 1, "统一分隔符为逗号"],
  ["image_count", "8", "Sheet1!F", "图片数量", "数字", 0, "非数字设为0"],
  ["product_id", "B0D123456789", "Sheet1!G", "商品ID", "文本", 0, "保留原值"],
  ["url", "https://supplier.example/...", "Sheet1!H", "商品链接", "文本", 1, "保留原值"],
  ["ai_title", "女式A字连衣裙...", "Sheet1!I", "AI标题", "文本", 1, "-"],
] as const;

export function ensureAmazonInfoCollectionSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS amazon_collection_jobs (
      id              TEXT PRIMARY KEY,
      user_id         INTEGER NOT NULL,
      name            TEXT NOT NULL,
      status          TEXT NOT NULL,
      phase           TEXT NOT NULL,
      total_count     INTEGER NOT NULL DEFAULT 0,
      collected_count INTEGER NOT NULL DEFAULT 0,
      failed_count    INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at      INTEGER,
      finished_at     INTEGER
    );

    CREATE TABLE IF NOT EXISTS amazon_collection_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id           TEXT NOT NULL REFERENCES amazon_collection_jobs(id) ON DELETE CASCADE,
      user_id          INTEGER NOT NULL,
      url              TEXT NOT NULL,
      status           TEXT NOT NULL,
      source_title     TEXT,
      price            TEXT,
      color            TEXT,
      sizes_json       TEXT,
      image_urls_json  TEXT,
      product_id       TEXT,
      source_payload   TEXT,
      ai_title         TEXT,
      ai_bullets_json  TEXT,
      search_terms     TEXT,
      excel_range      TEXT,
      error_message    TEXT,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(job_id, url)
    );

    CREATE TABLE IF NOT EXISTS amazon_collection_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      TEXT NOT NULL REFERENCES amazon_collection_jobs(id) ON DELETE CASCADE,
      item_id     INTEGER,
      level       TEXT NOT NULL,
      message     TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS amazon_field_mappings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      source_field  TEXT NOT NULL,
      sample_value  TEXT NOT NULL DEFAULT '',
      excel_column  TEXT NOT NULL,
      target_label  TEXT NOT NULL,
      data_type     TEXT NOT NULL,
      required      INTEGER NOT NULL DEFAULT 0,
      clean_rule    TEXT NOT NULL DEFAULT '',
      sort_order    INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, source_field)
    );

    CREATE INDEX IF NOT EXISTS idx_amazon_collection_jobs_user
      ON amazon_collection_jobs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_amazon_collection_items_job
      ON amazon_collection_items(job_id, status, id);
    CREATE INDEX IF NOT EXISTS idx_amazon_collection_logs_job
      ON amazon_collection_logs(job_id, created_at DESC);
  `);
}

export function seedAmazonFieldMappings(userId: number) {
  ensureAmazonInfoCollectionSchema();
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO amazon_field_mappings
      (user_id, source_field, sample_value, excel_column, target_label, data_type, required, clean_rule, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, source_field) DO NOTHING
  `);
  const tx = db.transaction(() => {
    DEFAULT_MAPPINGS.forEach((m, index) => {
      stmt.run(userId, m[0], m[1], m[2], m[3], m[4], m[5], m[6], index + 1);
    });
  });
  tx();
}

export function createAmazonCollectionImport(userId: number, rawInput: string) {
  ensureAmazonInfoCollectionSchema();
  seedAmazonFieldMappings(userId);

  const urls = extractUrls(rawInput);
  if (urls.length === 0) {
    throw new Error("没有找到有效链接，请粘贴 http:// 或 https:// 开头的商品链接。");
  }

  const db = getDb();
  const jobId = randomUUID();
  const now = nowSeconds();
  const name = `供应商采集 ${formatCompactTime(now)}`;

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO amazon_collection_jobs
        (id, user_id, name, status, phase, total_count, created_at, updated_at)
      VALUES (?, ?, ?, 'imported', '链接导入', ?, ?, ?)
    `).run(jobId, userId, name, urls.length, now, now);

    const itemStmt = db.prepare(`
      INSERT INTO amazon_collection_items
        (job_id, user_id, url, status, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?)
    `);
    urls.forEach((url) => itemStmt.run(jobId, userId, url, now, now));

    db.prepare(`
      INSERT INTO amazon_collection_logs (job_id, level, message, created_at)
      VALUES (?, 'info', ?, ?)
    `).run(jobId, `链接导入完成，共 ${urls.length} 条`, now);
  });
  tx();

  return getAmazonDashboard(userId, jobId);
}

export function getAmazonDashboard(userId: number, jobId?: string): AmazonDashboardData {
  ensureAmazonInfoCollectionSchema();
  seedAmazonFieldMappings(userId);
  const job = jobId ? getJobForUser(userId, jobId) : getLatestJobForUser(userId);
  const emptySummary = { total: 0, collected: 0, pending: 0, failed: 0 };
  if (!job) {
    return {
      job: null,
      summary: emptySummary,
      items: [],
      logs: [],
      mappings: listAmazonFieldMappings(userId),
    };
  }

  return {
    job,
    summary: buildSummary(job),
    items: listAmazonItems(userId, job.id),
    logs: listAmazonLogs(userId, job.id),
    mappings: listAmazonFieldMappings(userId),
  };
}

export function listAmazonFieldMappings(userId: number): AmazonFieldMapping[] {
  ensureAmazonInfoCollectionSchema();
  return getDb()
    .prepare(`
      SELECT * FROM amazon_field_mappings
      WHERE user_id = ?
      ORDER BY sort_order ASC, id ASC
    `)
    .all(userId) as AmazonFieldMapping[];
}

export function listAmazonItems(userId: number, jobId: string): AmazonCollectionItemView[] {
  ensureAmazonInfoCollectionSchema();
  const rows = getDb()
    .prepare(`
      SELECT * FROM amazon_collection_items
      WHERE user_id = ? AND job_id = ?
      ORDER BY id ASC
      LIMIT 200
    `)
    .all(userId, jobId) as AmazonCollectionItem[];
  return rows.map(toItemView);
}

export function listAmazonLogs(userId: number, jobId: string): AmazonCollectionLog[] {
  ensureAmazonInfoCollectionSchema();
  getJobForUser(userId, jobId);
  return getDb()
    .prepare(`
      SELECT * FROM amazon_collection_logs
      WHERE job_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 80
    `)
    .all(jobId) as AmazonCollectionLog[];
}

export function startAmazonSupplierCollection(userId: number, jobId?: string) {
  ensureAmazonInfoCollectionSchema();
  const job = jobId ? getJobForUser(userId, jobId) : getLatestJobForUser(userId);
  if (!job) throw new Error("请先导入商品链接。");
  if (activeRuns.has(job.id)) return job;

  const db = getDb();
  const now = nowSeconds();
  db.prepare(`
    UPDATE amazon_collection_jobs
    SET status = 'running', phase = '页面采集', started_at = COALESCE(started_at, ?), updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(now, now, job.id, userId);
  appendLog(job.id, null, "info", "开始页面采集");

  activeRuns.add(job.id);
  void runSupplierCollection(userId, job.id).finally(() => activeRuns.delete(job.id));
  return getJobForUser(userId, job.id);
}

export function exportAmazonCollectionCsv(userId: number, jobId?: string) {
  ensureAmazonInfoCollectionSchema();
  const job = jobId ? getJobForUser(userId, jobId) : getLatestJobForUser(userId);
  if (!job) throw new Error("没有可导出的任务。");
  const items = listAmazonItems(userId, job.id);
  const headers = [
    "商品链接",
    "原始标题",
    "价格",
    "颜色",
    "尺码",
    "图片数量",
    "商品ID",
    "亚马逊标题",
    "五点卖点",
    "Search Terms",
    "状态",
    "错误信息",
  ];
  const rows = items.map((item) => [
    item.url,
    item.sourceTitle,
    item.price,
    item.color,
    item.sizes.join(","),
    String(item.imageUrls.length),
    item.productId,
    item.aiTitle,
    item.aiBullets.join(" | "),
    item.searchTerms,
    item.status,
    item.errorMessage,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return {
    filename: `${job.name.replace(/[\\/:*?"<>|]/g, "_")}.csv`,
    content: `\uFEFF${csv}`,
  };
}

async function runSupplierCollection(userId: number, jobId: string) {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT * FROM amazon_collection_items
      WHERE user_id = ? AND job_id = ? AND status IN ('queued', 'failed')
      ORDER BY id ASC
    `)
    .all(userId, jobId) as AmazonCollectionItem[];

  for (const row of rows) {
    const itemId = row.id;
    try {
      markItem(itemId, "collecting");
      appendLog(jobId, itemId, "info", `开始采集：${row.url}`);

      const scraped = await scrapeSupplierProduct(row.url);
      markJobPhase(jobId, "字段清洗");
      markItem(itemId, "cleaning");

      const normalized = normalizeScrapedProduct(scraped, row.url);
      const draft = generateAmazonDraft(normalized);
      const excelRow = rows.findIndex((r) => r.id === row.id) + 2;

      db.prepare(`
        UPDATE amazon_collection_items
        SET status = 'completed',
            source_title = ?,
            price = ?,
            color = ?,
            sizes_json = ?,
            image_urls_json = ?,
            product_id = ?,
            source_payload = ?,
            ai_title = ?,
            ai_bullets_json = ?,
            search_terms = ?,
            excel_range = ?,
            error_message = NULL,
            updated_at = ?
        WHERE id = ?
      `).run(
        normalized.title,
        normalized.price,
        normalized.color,
        JSON.stringify(normalized.sizes),
        JSON.stringify(normalized.imageUrls),
        normalized.productId,
        JSON.stringify(normalized),
        draft.title,
        JSON.stringify(draft.bullets),
        draft.searchTerms,
        `Sheet1!A${excelRow}:L${excelRow}`,
        nowSeconds(),
        itemId,
      );
      appendLog(jobId, itemId, "info", `采集完成：${normalized.title.slice(0, 40)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare(`
        UPDATE amazon_collection_items
        SET status = 'failed', error_message = ?, updated_at = ?
        WHERE id = ?
      `).run(message.slice(0, 600), nowSeconds(), itemId);
      appendLog(jobId, itemId, "error", `采集失败：${message.slice(0, 160)}`);
    }
    recomputeJob(jobId, userId);
  }

  markJobPhase(jobId, "写入Excel");
  const finalJob = recomputeJob(jobId, userId);
  const status = finalJob.failed_count > 0 && finalJob.collected_count === 0 ? "failed" : "completed";
  db.prepare(`
    UPDATE amazon_collection_jobs
    SET status = ?, phase = '完成', finished_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(status, nowSeconds(), nowSeconds(), jobId, userId);
  appendLog(jobId, null, status === "completed" ? "info" : "error", "任务处理结束");
}

async function scrapeSupplierProduct(url: string): Promise<ScrapedProduct> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.8,zh-CN;q=0.7,zh;q=0.6",
      },
    });
    if (!response.ok) {
      throw new Error(`页面请求失败：HTTP ${response.status}`);
    }
    const html = await response.text();
    return parseProductHtml(html, url);
  } finally {
    clearTimeout(timeout);
  }
}

function parseProductHtml(html: string, url: string): ScrapedProduct {
  const jsonLd = extractJsonLdProduct(html);
  const title =
    stringFromUnknown(jsonLd?.name) ||
    getMeta(html, "og:title") ||
    getMeta(html, "twitter:title") ||
    getTitleTag(html);
  if (!title) throw new Error("未能识别商品标题。");

  const offers = isRecord(jsonLd?.offers) ? jsonLd.offers : null;
  const price =
    stringFromUnknown(offers?.price) ||
    getMeta(html, "product:price:amount") ||
    findFirst(html, /(?:US\s*)?\$\s?\d+(?:\.\d{1,2})?/i) ||
    "";
  const imageUrls = normalizeImages(jsonLd?.image, html, url);
  const productId =
    stringFromUnknown(jsonLd?.sku) ||
    stringFromUnknown(jsonLd?.mpn) ||
    findFirst(html, /(?:SKU|商品ID|Product\s*ID|Item\s*ID)[^\w]{0,12}([A-Z0-9_-]{5,})/i, 1) ||
    stableProductId(url);

  return {
    title: cleanText(title),
    price: cleanText(price),
    color: extractColor(html),
    sizes: extractSizes(html),
    imageUrls,
    productId,
  };
}

function normalizeScrapedProduct(product: ScrapedProduct, url: string): ScrapedProduct {
  return {
    title: product.title || readableTitleFromUrl(url),
    price: product.price || "-",
    color: product.color || "-",
    sizes: product.sizes.length > 0 ? product.sizes : ["-"],
    imageUrls: product.imageUrls,
    productId: product.productId || stableProductId(url),
  };
}

function generateAmazonDraft(product: ScrapedProduct) {
  const color = product.color && product.color !== "-" ? product.color : "多色可选";
  const sizes = product.sizes.filter((s) => s !== "-").join("/") || "多尺码";
  const title = `${product.title} ${color} ${sizes}`.replace(/\s+/g, " ").slice(0, 180);
  return {
    title,
    bullets: [
      `适合日常、度假、通勤等多场景穿搭，版型简洁易搭配`,
      `页面提取颜色：${color}，尺码：${sizes}`,
      `商品图片共 ${product.imageUrls.length} 张，可用于主图和详情图筛选`,
      `标题和卖点基于供应商原始信息整理，价格、尺码、颜色不做编造`,
      `建议导出后按亚马逊类目模板进行最终合规检查`,
    ],
    searchTerms: uniqueWords(product.title)
      .slice(0, 12)
      .join(", ")
      .toLowerCase(),
  };
}

function getLatestJobForUser(userId: number): AmazonCollectionJob | null {
  ensureAmazonInfoCollectionSchema();
  return (
    (getDb()
      .prepare(`
        SELECT * FROM amazon_collection_jobs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get(userId) as AmazonCollectionJob | undefined) ?? null
  );
}

function getJobForUser(userId: number, jobId: string): AmazonCollectionJob {
  const job = getDb()
    .prepare(`SELECT * FROM amazon_collection_jobs WHERE user_id = ? AND id = ?`)
    .get(userId, jobId) as AmazonCollectionJob | undefined;
  if (!job) throw new Error("任务不存在或无权访问。");
  return job;
}

function recomputeJob(jobId: string, userId: number): AmazonCollectionJob {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('completed', 'ai_ready') THEN 1 ELSE 0 END) AS collected,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM amazon_collection_items
      WHERE job_id = ? AND user_id = ?
    `)
    .get(jobId, userId) as { total: number; collected: number | null; failed: number | null };
  db.prepare(`
    UPDATE amazon_collection_jobs
    SET total_count = ?, collected_count = ?, failed_count = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(row.total, row.collected ?? 0, row.failed ?? 0, nowSeconds(), jobId, userId);
  return getJobForUser(userId, jobId);
}

function buildSummary(job: AmazonCollectionJob) {
  return {
    total: job.total_count,
    collected: job.collected_count,
    pending: Math.max(0, job.total_count - job.collected_count - job.failed_count),
    failed: job.failed_count,
  };
}

function appendLog(
  jobId: string,
  itemId: number | null,
  level: AmazonCollectionLogLevel,
  message: string,
) {
  getDb()
    .prepare(`
      INSERT INTO amazon_collection_logs (job_id, item_id, level, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(jobId, itemId, level, message, nowSeconds());
}

function markItem(itemId: number, status: AmazonCollectionStatus) {
  getDb()
    .prepare(`UPDATE amazon_collection_items SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, nowSeconds(), itemId);
}

function markJobPhase(jobId: string, phase: string) {
  getDb()
    .prepare(`UPDATE amazon_collection_jobs SET phase = ?, updated_at = ? WHERE id = ?`)
    .run(phase, nowSeconds(), jobId);
}

function toItemView(row: AmazonCollectionItem): AmazonCollectionItemView {
  return {
    id: row.id,
    jobId: row.job_id,
    url: row.url,
    status: row.status,
    sourceTitle: row.source_title || "",
    price: row.price || "",
    color: row.color || "",
    sizes: parseStringArray(row.sizes_json),
    imageUrls: parseStringArray(row.image_urls_json),
    productId: row.product_id || "",
    aiTitle: row.ai_title || "",
    aiBullets: parseStringArray(row.ai_bullets_json),
    searchTerms: row.search_terms || "",
    excelRange: row.excel_range || "",
    errorMessage: row.error_message || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function extractUrls(rawInput: string) {
  const seen = new Set<string>();
  const urls = rawInput
    .split(/[\s,，;；]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol)) return "";
        url.hash = "";
        return url.toString();
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
  return urls;
}

function extractJsonLdProduct(html: string): Record<string, unknown> | null {
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const content = script
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();
    try {
      const parsed = JSON.parse(content) as unknown;
      const product = findProductJson(parsed);
      if (product) return product;
    } catch {
      continue;
    }
  }
  return null;
}

function findProductJson(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProductJson(item);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  const type = value["@type"];
  if (
    type === "Product" ||
    (Array.isArray(type) && type.some((v) => String(v).toLowerCase() === "product"))
  ) {
    return value;
  }
  if (Array.isArray(value["@graph"])) return findProductJson(value["@graph"]);
  return null;
}

function normalizeImages(value: unknown, html: string, pageUrl: string): string[] {
  const fromJson = Array.isArray(value) ? value : value ? [value] : [];
  const fromMeta = [
    getMeta(html, "og:image"),
    getMeta(html, "twitter:image"),
    ...Array.from(html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)).map((m) => m[1]),
  ];
  const base = new URL(pageUrl);
  const seen = new Set<string>();
  return [...fromJson, ...fromMeta]
    .map(stringFromUnknown)
    .filter(Boolean)
    .map((src) => {
      try {
        return new URL(src, base).toString();
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .filter((src) => {
      if (seen.has(src)) return false;
      seen.add(src);
      return true;
    })
    .slice(0, 12);
}

function getMeta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    findFirst(html, new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"), 1) ||
    findFirst(html, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"), 1)
  );
}

function getTitleTag(html: string) {
  return findFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i, 1);
}

function extractColor(html: string) {
  return (
    findFirst(html, /(?:Color|颜色)[^<]{0,30}<[^>]*>\s*([^<]{1,40})</i, 1) ||
    findFirst(html, /(?:Color|颜色)\s*[:：]\s*([A-Za-z\u4e00-\u9fa5\s-]{1,30})/i, 1) ||
    ""
  ).trim();
}

function extractSizes(html: string) {
  const candidates = new Set<string>();
  const plain = cleanText(html.replace(/<[^>]+>/g, " "));
  for (const match of plain.matchAll(/\b(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)\b/g)) {
    candidates.add(match[1]);
  }
  for (const match of plain.matchAll(/\b([1-5]?\d(?:\.\d)?)(?:\s*(?:EU|US|UK))?\b/g)) {
    const n = Number(match[1]);
    if (n >= 20 && n <= 60) candidates.add(match[1]);
  }
  return Array.from(candidates).slice(0, 10);
}

function findFirst(html: string, regex: RegExp, index = 0) {
  const match = html.match(regex);
  return match?.[index] ? decodeHtml(match[index]) : "";
}

function cleanText(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, " ")
    .replace(/&nbsp;/g, " ");
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function readableTitleFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname;
    return pathname
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/[-_]+/g, " ")
      .slice(0, 120) || "供应商商品";
  } catch {
    return "供应商商品";
  }
}

function stableProductId(url: string) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
  }
  return `SRC${hash.toString(16).toUpperCase().padStart(8, "0")}`;
}

function uniqueWords(value: string) {
  const seen = new Set<string>();
  return value
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 2)
    .filter((v) => {
      const key = v.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function formatCompactTime(seconds: number) {
  const date = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
