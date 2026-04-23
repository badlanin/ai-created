import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

/**
 * SQLite 单例
 *
 * - 数据库文件位于 /app/data/app.db（容器内）
 * - 宿主机路径：项目目录下的 ./data/app.db（通过 docker volume 映射持久化）
 * - 进程启动时自动执行 migrate()
 */

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "app.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // 确保目录存在
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  // WAL 模式：读写并发更友好，适合本场景
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  migrate(_db);
  return _db;
}

/**
 * 建表脚本 - 幂等
 * 每次启动都跑一次，CREATE TABLE IF NOT EXISTS 保证安全
 */
function migrate(db: Database.Database) {
  db.exec(`
    -- 用户表
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name  TEXT,
      role          TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- 颜色预设
    CREATE TABLE IF NOT EXISTS colors (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      hex        TEXT NOT NULL,              -- 形如 '#D4A574'
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by INTEGER REFERENCES users(id)
    );

    -- 模特图（pose_tags 和 appearance_tags 用逗号分隔的字符串）
    -- kind='pose' 表示姿势库，kind='identity' 表示形象库
    CREATE TABLE IF NOT EXISTS models (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      kind             TEXT NOT NULL,        -- 'pose' | 'identity'
      name             TEXT NOT NULL,
      image_path       TEXT NOT NULL,        -- 相对 DATA_DIR 的路径
      tags             TEXT,                 -- 逗号分隔
      notes            TEXT,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by       INTEGER REFERENCES users(id)
    );

    -- 场景背景
    CREATE TABLE IF NOT EXISTS scenes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      image_path TEXT NOT NULL,
      tags       TEXT,
      notes      TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by INTEGER REFERENCES users(id)
    );

    -- Prompt 模板
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      kind       TEXT NOT NULL,             -- 'recolor' | 'on_model' | 'generic'
      template   TEXT NOT NULL,             -- 可含 {{color_name}} {{hex}} 等占位符
      notes      TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by INTEGER REFERENCES users(id)
    );

    -- 生成历史（审计 + 个人查看）
    CREATE TABLE IF NOT EXISTS generations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER REFERENCES users(id),
      kind          TEXT NOT NULL,          -- 'analyze' | 'recolor' | 'on_model'
      input_images  TEXT,                   -- JSON array of relative paths
      output_images TEXT,                   -- JSON array of relative paths
      params        TEXT,                   -- JSON 参数快照
      duration_ms   INTEGER,
      success       INTEGER NOT NULL DEFAULT 1,
      error         TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_generations_user ON generations(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_models_kind ON models(kind, sort_order);
    CREATE INDEX IF NOT EXISTS idx_colors_sort ON colors(sort_order);
    CREATE INDEX IF NOT EXISTS idx_scenes_sort ON scenes(sort_order);
    CREATE INDEX IF NOT EXISTS idx_prompts_kind ON prompt_templates(kind, sort_order);

    -- AI 模型（可配置模型库）
    -- category='vision'    : 视觉理解（/analyze 解析图片）
    -- category='image_gen' : 图像生成（/recolor 换色、/on-model 换模特）
    CREATE TABLE IF NOT EXISTS ai_models (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id    TEXT NOT NULL,               -- Vertex AI 模型 ID，如 'gemini-3.1-flash-image-preview'
      label       TEXT NOT NULL,               -- 展示名，如 'Nano Banana 2'
      description TEXT,                        -- 说明
      category    TEXT NOT NULL,               -- 'vision' | 'image_gen'
      enabled     INTEGER NOT NULL DEFAULT 1,
      is_default  INTEGER NOT NULL DEFAULT 0,
      badge       TEXT,                        -- 可选角标，如 '推荐'
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(model_id, category)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_models_cat ON ai_models(category, enabled, sort_order);
  `);

  seedAiModels(db);
}

/**
 * 首次启动时 seed 已知模型。
 * 用 INSERT OR IGNORE，不会覆盖用户后续在管理页的修改。
 */
function seedAiModels(db: Database.Database) {
  const seeds: Array<{
    model_id: string;
    label: string;
    description: string;
    category: "vision" | "image_gen";
    is_default: 0 | 1;
    badge?: string;
    sort_order: number;
  }> = [
    // ----- 视觉理解（analyze 用）-----
    {
      model_id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      description: "视觉解析首选 · 性价比高、速度快、JSON 输出稳",
      category: "vision",
      is_default: 1,
      badge: "推荐",
      sort_order: 10,
    },
    {
      model_id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      description: "细节识别更强（蕾丝/亮片/刺绣），贵约 20x",
      category: "vision",
      is_default: 0,
      sort_order: 20,
    },
    {
      model_id: "gemini-3-pro-preview",
      label: "Gemini 3 Pro (Preview)",
      description: "最强视觉理解，用于高难度案例",
      category: "vision",
      is_default: 0,
      sort_order: 30,
    },

    // ----- 图像生成（recolor / on-model 用）-----
    {
      model_id: "gemini-3.1-flash-image-preview",
      label: "Nano Banana 2",
      description: "Gemini 3.1 Flash Image · 速度快质量高，日常首选",
      category: "image_gen",
      is_default: 1,
      badge: "推荐",
      sort_order: 10,
    },
    {
      model_id: "gemini-3-pro-image-preview",
      label: "Nano Banana Pro",
      description: "Gemini 3 Pro Image · 旗舰，复杂改动效果更稳",
      category: "image_gen",
      is_default: 0,
      sort_order: 20,
    },
    {
      model_id: "gemini-2.5-flash-image-preview",
      label: "Nano Banana (旧版)",
      description: "Gemini 2.5 Flash Image Preview · 初代预览，备用",
      category: "image_gen",
      is_default: 0,
      sort_order: 30,
    },
  ];

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO ai_models
       (model_id, label, description, category, enabled, is_default, badge, sort_order)
     VALUES (@model_id, @label, @description, @category, 1, @is_default, @badge, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const s of seeds) stmt.run({ badge: null, ...s });
  });
  tx();
}

export const DATA_DIR_PATH = DATA_DIR;
