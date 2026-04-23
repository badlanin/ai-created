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
  `);
}

export const DATA_DIR_PATH = DATA_DIR;
