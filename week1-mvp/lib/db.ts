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

    -- 场景分类（之前硬写在 lib/scene-categories.ts，2026-05-12 搬到 DB）
    -- admin/scenes tab 4 可以 CRUD；前端 lib 里保留 hardcoded fallback
    CREATE TABLE IF NOT EXISTS scene_categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      key_id      TEXT NOT NULL UNIQUE,            -- 英文 key（wedding / outdoor 等，存进 scenes.category）
      label       TEXT NOT NULL,                   -- 中文显示名
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- 文字场景预设（lib/text-scene-presets.ts 的 28 条会通过 migration 种进来；
    -- admin 也能通过 /admin/scenes 的"新增文字场景" tab 上传参考图 + AI 解析新增）
    CREATE TABLE IF NOT EXISTS text_scenes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,            -- 显示名（不可重）
      group_name  TEXT,                            -- 调性分组（法式门厅 / 古典宫廷 等）
      text_prompt TEXT NOT NULL,                   -- 完整场景描述（喂给模型）
      thumb_path  TEXT,                            -- 缩略图相对路径，UI 选择用，不参与 prompt
      notes       TEXT,                            -- 备注
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by  INTEGER REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_generations_user ON generations(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_models_kind ON models(kind, sort_order);
    CREATE INDEX IF NOT EXISTS idx_colors_sort ON colors(sort_order);
    CREATE INDEX IF NOT EXISTS idx_scenes_sort ON scenes(sort_order);
    CREATE INDEX IF NOT EXISTS idx_prompts_kind ON prompt_templates(kind, sort_order);
    CREATE INDEX IF NOT EXISTS idx_text_scenes_group ON text_scenes(group_name, sort_order);

    -- ==========================================
    -- M2: 姿势库（纯文字）
    -- ==========================================
    -- is_hero=1 表示这是"首图（hero）"专用姿势——参考竞品 Azazie 的灵动正面构图，
    -- 用于产品列表第一张展示。批量摄影 UI 会单独把它们分一组并提供"🎲 随机首图"按钮。
    -- 姿势文本只描述身体动作，面部表情走 expressions 表，互不干涉。
    CREATE TABLE IF NOT EXISTS poses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,               -- 如 "站立正面"
      text       TEXT NOT NULL,               -- 完整描述，会注入 prompt（仅描述身体，不带表情）
      type       TEXT NOT NULL DEFAULT 'full', -- 'full'(全身)|'half'(半身)|'closeup'(特写)
      tags       TEXT,                         -- 逗号分隔
      notes      TEXT,
      is_hero    INTEGER NOT NULL DEFAULT 0,  -- 1 = 首图（hero）专用
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_poses_type ON poses(type, sort_order);
    CREATE INDEX IF NOT EXISTS idx_poses_hero ON poses(is_hero, sort_order);

    -- ==========================================
    -- 表情维度（独立于姿势的全局单选）
    -- ==========================================
    -- 设计：批量摄影时所有姿势共用同一个表情，注入 prompt 的 {{expression}} 占位符。
    -- 表情文本只描述脸部，姿势文本只描述身体——分离不冲突。
    CREATE TABLE IF NOT EXISTS expressions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,               -- 如 "温柔微笑"
      text       TEXT NOT NULL,               -- 仅描述脸（嘴角/眼神/气质），不要带身体动作
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_expressions_sort ON expressions(sort_order);

    -- ==========================================
    -- M2: 摄影参数库（视觉风格预设）
    -- ==========================================
    CREATE TABLE IF NOT EXISTS photography_params (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,              -- 如 "商品级标准图"
      description TEXT,                        -- 简短说明，UI 上显示
      params_text TEXT NOT NULL,               -- 完整参数文本，注入 prompt 的 {{photography_params}}
      is_default  INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by  INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_photography_sort ON photography_params(sort_order);

    -- ==========================================
    -- M2: 真实感预设库（控制磨皮/AI 感/皮肤毛发真实度）
    -- ==========================================
    CREATE TABLE IF NOT EXISTS realism_presets (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL,            -- "自然真实" 等
      description       TEXT,                      -- UI 简短说明
      constraints_text  TEXT NOT NULL,             -- 完整约束文本，注入 prompt 的 {{realism_constraints}}
      is_default        INTEGER NOT NULL DEFAULT 0,
      sort_order        INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by        INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_realism_sort ON realism_presets(sort_order);

    -- ==========================================
    -- M2: 面料材质库（服装材质细节 + 自动匹配）
    -- ==========================================
    CREATE TABLE IF NOT EXISTS materials (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,            -- "雪纺"
      english_name       TEXT,                      -- "chiffon"
      aliases            TEXT,                      -- 逗号分隔，自动匹配用（"雪纺,纱,chiffon,georgette"）
      description        TEXT,                      -- 给管理员看的简短说明
      visual_traits      TEXT,                      -- 视觉特征（注入 prompt）
      light_behavior     TEXT,                      -- 光线特性
      texture_rules      TEXT,                      -- 纹理/编织规则
      dont_confuse_with  TEXT,                      -- 容易画错的反向约束
      sort_order         INTEGER NOT NULL DEFAULT 0,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by         INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_materials_sort ON materials(sort_order);

    -- ==========================================
    -- P2: 计费 + 预算 体系
    -- ==========================================

    -- 每次 AI 调用的使用记录（原子级审计 + 计费底表）
    CREATE TABLE IF NOT EXISTS usage_records (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER REFERENCES users(id),
      generation_id     INTEGER REFERENCES generations(id),
      model             TEXT NOT NULL,         -- 如 'gemini-3-pro-image-preview'
      feature           TEXT NOT NULL,         -- 'analyze' | 'recolor' | 'batch_photo'
      prompt_tokens     INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens      INTEGER NOT NULL DEFAULT 0,
      cost_usd          REAL NOT NULL DEFAULT 0,  -- 调用时按当时价格算
      cost_cny          REAL NOT NULL DEFAULT 0,  -- 调用时按当时汇率算（锁定不追溯）
      success           INTEGER NOT NULL DEFAULT 1,
      error             TEXT,
      notes             TEXT,                  -- JSON 额外信息（aspect/quality/image_size）
      created_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_records(model, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_feature ON usage_records(feature, created_at DESC);

    -- 模型单价表（标准档位为主，管理员可调）
    CREATE TABLE IF NOT EXISTS model_prices (
      model_id             TEXT PRIMARY KEY,
      input_per_1m_usd     REAL NOT NULL,  -- 每 1M input tokens 美金
      output_per_1m_usd    REAL NOT NULL,  -- 每 1M output tokens 美金
      tier                 TEXT NOT NULL DEFAULT 'standard',  -- 'standard' | 'priority' | 'batch'
      notes                TEXT,
      updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- 用户预算（月度，超限禁用）
    CREATE TABLE IF NOT EXISTS user_budgets (
      user_id            INTEGER PRIMARY KEY REFERENCES users(id),
      monthly_budget_cny REAL NOT NULL DEFAULT 0,  -- 0 配合 is_unlimited=1 = 无限
      is_unlimited       INTEGER NOT NULL DEFAULT 1,
      notes              TEXT,
      updated_at         INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- 全局配置（汇率等）
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      notes      TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

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

    -- ==========================================
    -- P3-1 批次 B：异步任务队列
    -- ==========================================
    --
    -- 设计：
    --   · 前端 POST 任务 → 立即返回 job_id（fire-and-forget）
    --   · 后端在进程内跑一个 async worker 逐条处理 render_job_items
    --   · 前端轮询 GET /api/jobs/:id 看进度
    --   · 取消：POST /api/jobs/:id/cancel 把 status 置成 canceling，
    --          worker 处理完当前一条后立即退出，剩余 item 标为 canceled
    --
    -- 和旧的 generations 表共存：generations 保留作为"成功结果归档表"
    -- （给 /history 页读）。render_jobs 是"进行中任务状态表"。
    -- 成功完成的 job 可选地也往 generations 插一条，但不是必须。
    --
    CREATE TABLE IF NOT EXISTS render_jobs (
      id              TEXT PRIMARY KEY,                      -- uuid-ish
      user_id         INTEGER NOT NULL REFERENCES users(id),
      feature         TEXT NOT NULL,                          -- 'recolor' | 'batch_photo'
      model           TEXT NOT NULL,                          -- base_model id
      status          TEXT NOT NULL DEFAULT 'running',        -- 'running'|'canceling'|'canceled'|'completed'|'failed'
      total_count     INTEGER NOT NULL,
      completed_count INTEGER NOT NULL DEFAULT 0,
      failed_count    INTEGER NOT NULL DEFAULT 0,
      canceled_count  INTEGER NOT NULL DEFAULT 0,
      total_cost_cny  REAL    NOT NULL DEFAULT 0,
      params          TEXT,                                    -- JSON snapshot of inputs
      error_message   TEXT,                                    -- 致命错误（整个 job 挂了）
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at      INTEGER,
      finished_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_render_jobs_user
      ON render_jobs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_render_jobs_status
      ON render_jobs(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS render_job_items (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id            TEXT NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
      idx               INTEGER NOT NULL,                      -- 0-based 顺序
      status            TEXT NOT NULL DEFAULT 'queued',        -- 'queued'|'waiting_quota'|'processing'|'completed'|'failed'|'canceled'
      label             TEXT,                                  -- 展示名（"米白" / "站立正面"）
      result_image_path TEXT,                                  -- 相对 DATA_DIR 的路径
      result_image_url  TEXT,                                  -- /assets/outputs/xxx.png（方便前端直接读）
      input_tokens      INTEGER,
      output_tokens     INTEGER,
      cost_cny          REAL,
      error_message     TEXT,
      retry_count       INTEGER NOT NULL DEFAULT 0,
      wait_until_ms     INTEGER,                               -- 被 rate limit 挡住时的解除时间戳（给前端倒计时用）
      started_at        INTEGER,
      finished_at       INTEGER,
      UNIQUE (job_id, idx)
    );
    CREATE INDEX IF NOT EXISTS idx_render_job_items_job
      ON render_job_items(job_id, idx);
    CREATE INDEX IF NOT EXISTS idx_render_job_items_status
      ON render_job_items(status);

    -- ==========================================
    -- P3-2: 公告栏（管理员可编辑，所有用户可见）
    -- ==========================================
    CREATE TABLE IF NOT EXISTS announcements (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      content    TEXT NOT NULL,                         -- 正文（支持简单换行）
      tone       TEXT NOT NULL DEFAULT 'info',          -- 'info'|'success'|'warn'|'danger'
      enabled    INTEGER NOT NULL DEFAULT 1,            -- 是否启用（0 = 草稿/归档）
      dismissible INTEGER NOT NULL DEFAULT 1,           -- 用户能否关闭（本次会话）
      starts_at  INTEGER,                                -- 生效开始（unix 秒，null = 立即）
      ends_at    INTEGER,                                -- 生效结束（unix 秒，null = 永久）
      created_by INTEGER REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_announcements_enabled
      ON announcements(enabled, created_at DESC);
  `);

  // 增量迁移：新增列（已存在时跳过）
  ensureColumn(db, "models", "category", "TEXT");
  ensureColumn(db, "colors", "color_group", "TEXT");
  ensureColumn(db, "colors", "is_popular", "INTEGER NOT NULL DEFAULT 0");
  // 场景分类（婚礼 / 户外 / 影棚 / 街拍 / 室内 等，留空表示未分类）
  ensureColumn(db, "scenes", "category", "TEXT");
  // 换色任务的"原始模型输出"路径 + 校正元信息（给手动滑块校色用）
  ensureColumn(db, "render_job_items", "raw_image_path", "TEXT");
  ensureColumn(db, "render_job_items", "correction_meta", "TEXT");
  // 姿势 hero 标记（首图专用），老库补列
  ensureColumn(db, "poses", "is_hero", "INTEGER NOT NULL DEFAULT 0");
  // 场景库分流：'single' = 主图场景库（批量摄影/背景换图用），
  //            'poster' = 海报大场景库（多人氛围海报、社媒图等专用）
  ensureColumn(
    db,
    "scenes",
    "usage",
    "TEXT NOT NULL DEFAULT 'single'",
  );
  // 新增索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_models_category ON models(kind, category, sort_order);
    CREATE INDEX IF NOT EXISTS idx_colors_group ON colors(color_group, sort_order);
    CREATE INDEX IF NOT EXISTS idx_scenes_category ON scenes(category, sort_order);
    CREATE INDEX IF NOT EXISTS idx_poses_hero ON poses(is_hero, sort_order);
    CREATE INDEX IF NOT EXISTS idx_scenes_usage ON scenes(usage, sort_order);
  `);

  // 启动时恢复：把被进程重启打断的 item 标为 failed
  recoverOrphanJobs(db);

  seedAiModels(db);
  seedPoses(db);
  // 老库的"首图"姿势补种 + 旧 pose 文本里残留的表情/眼神词清洗
  // 注意：seedPoses 自带 "if exists return" 的早退，所以下面这两个迁移
  // 必须独立运行才能照顾到已部署的库
  migrateInsertHeroPoses(db);
  migratePoseExpressionsRemoval(db);
  seedExpressions(db);
  seedPhotographyParams(db);
  seedPromptTemplates(db);
  // 把 {{expression}} 占位符注入"标准模特穿着图"模板（老库幂等）
  migratePromptTemplateExpression(db);
  // 把 {{realism_constraints}} + {{material_details}} 注入"标准模特穿着图"模板
  // （老库的模板从来没引用过这俩占位符——选预设也没用，必须迁移）
  migrateTemplateRealismFront(db);
  seedRealismPresets(db);
  // Editorial 真实感 + 摄影预设：老库幂等补种（按 name 去重）
  migrateInsertEditorialRealism(db);
  migrateInsertEditorialPhotography(db);
  seedMaterials(db);
  seedModelPrices(db);
  seedSettings(db);
  // 新实例预设：色卡 + 模特图 + 场景图（来自 seed-assets/）
  seedColors(db);
  seedIdentitiesFromAssets(db);
  seedScenesFromAssets(db);
  // 老库的"v2 新场景"补种（manifest 含 27 张新场景，按 name 幂等）
  migrateInsertNewScenes(db);
  // 老库的新姿势补种（按 name 幂等，flag v2）
  migrateInsertNewPoses(db);
  // 老库的新装饰材质补种（亮片 / 珠子 / 3D花朵 等，按 name 幂等，flag v2）
  migrateInsertNewMaterials(db);
  // 老库色卡 v2 全量替换（用户 XLS 提供的 50 个新色，flag v2）
  migrateReplaceColorsV2(db);
  // 老库通用模特 v2 重置（删旧 universal 除"通用 12"外 + 加 11 张新形象）
  migrateResetUniversalIdentitiesV2(db);
  // 老库新主图场景 v3 补种（28 张 OpenAI Playground 生成的纯场景图）
  migrateInsertNewScenesV3(db);
  // 文字场景预设 v1 种子（把 lib/text-scene-presets.ts 的 28 条种进 text_scenes 表）
  migrateSeedTextScenesV1(db);
  // 场景分类 v1 种子（把 lib/scene-categories.ts 的 6 条种进 scene_categories 表）
  migrateSeedSceneCategoriesV1(db);
}

/**
 * 幂等地给 table 添加列。已存在则跳过。
 * SQLite 的 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS，
 * 所以必须先查 pragma_table_info。
 */
function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  const cols = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[db] ALTER TABLE ${table} ADD COLUMN ${column}`);
}

/**
 * 进程重启时的任务状态恢复
 *
 * 场景：服务重启（部署更新 / OOM / 手动 restart）时，
 * render_job_items 里可能有 status='processing' 的 item —— 这些其实已经
 * 中断了。启动时一次性把它们标为 failed，避免前端一直看到"进行中"。
 *
 * 同时把 status='queued' / 'waiting_quota' 的也标为 canceled
 * （因为 worker 已经不在了，这些 item 永远不会被处理）。
 *
 * 相关的 render_jobs 也一并置为 'failed'，附上 error_message 说明原因。
 */
function recoverOrphanJobs(db: Database.Database) {
  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction(() => {
    // 1) 把活跃 item 都置成终态
    const itemsUpdated = db
      .prepare(
        `UPDATE render_job_items
         SET status = CASE status
             WHEN 'processing' THEN 'failed'
             ELSE 'canceled'
           END,
           error_message = CASE status
             WHEN 'processing' THEN '服务重启导致任务中断'
             ELSE NULL
           END,
           finished_at = ?
         WHERE status IN ('processing','queued','waiting_quota')`,
      )
      .run(now).changes;

    // 2) 活跃的 render_jobs 标为 failed
    const jobsUpdated = db
      .prepare(
        `UPDATE render_jobs
         SET status = 'failed',
             error_message = '服务重启导致任务中断',
             finished_at = ?
         WHERE status IN ('running','canceling')`,
      )
      .run(now).changes;

    if (itemsUpdated > 0 || jobsUpdated > 0) {
      console.log(
        `[db] 恢复孤儿任务：${jobsUpdated} 个 job / ${itemsUpdated} 个 item 已标为 failed/canceled`,
      );
    }
  });
  tx();
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
    // ----- OpenAI Image -----
    // 注意：截至 2026-04 官方 model 列表只有 gpt-image-2 / 1.5 / 1 / 1-mini，
    //       没有 gpt-image-2-mini，便宜路径继续用 gpt-image-1-mini
    {
      model_id: "gpt-image-2",
      label: "GPT Image 2",
      description: "OpenAI · 真实感强、氛围细节出色，但 Tier 1 限 5 IPM",
      category: "image_gen",
      is_default: 0,
      badge: "新",
      sort_order: 40,
    },
    {
      model_id: "gpt-image-1-mini",
      label: "GPT Image 1 Mini",
      description: "OpenAI · 便宜版本，适合快速草稿/批量探索",
      category: "image_gen",
      is_default: 0,
      sort_order: 50,
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

/**
 * 种子姿势库（15 条，覆盖全身/半身/特写）
 * 只在 poses 表空时插入（不覆盖管理员后续修改）
 */
function seedPoses(db: Database.Database) {
  const exists = db.prepare(`SELECT COUNT(*) AS c FROM poses`).get() as {
    c: number;
  };
  if (exists.c > 0) return;

  const poses: Array<{
    name: string;
    text: string;
    type: "full" | "half" | "closeup";
    tags: string;
    is_hero?: 0 | 1;
    sort_order: number;
  }> = [
    // --- 首图（hero）：参考竞品 Azazie 的灵动正面构图，仅描述身体动作 ---
    {
      name: "首图 · 自然站姿",
      text: "模特正对镜头，重心微落在右腿，左腿自然前迈半步形成对立平衡（contrapposto）。左手轻搭在裙摆侧面指尖微弯，右臂自然垂下。微微抬下巴。",
      type: "full",
      tags: "首图,正面,灵动",
      is_hero: 1,
      sort_order: 1,
    },
    {
      name: "首图 · 一脚前迈轻扶裙",
      text: "模特正对镜头，左脚向前轻迈半步，重心在后腿。左手轻提裙摆侧面让层次展开，右手自然垂下指尖微弯。头微侧。",
      type: "full",
      tags: "首图,正面,扶裙",
      is_hero: 1,
      sort_order: 2,
    },
    {
      name: "首图 · 半侧身露肩",
      text: "模特身体 30 度侧对镜头，重心放在后腿，前腿自然点地。近镜头肩膀微微下沉，远端肩微抬，凸显锁骨颈部线条。头部回正，一手自然下垂，一手轻搭腰部。",
      type: "full",
      tags: "首图,侧身,肩颈",
      is_hero: 1,
      sort_order: 3,
    },
    {
      name: "首图 · 抚发瞬间",
      text: "模特正对镜头，重心微落在一腿。一手抬起指尖轻拨耳后头发，营造抓拍的瞬间感，另一手垂在身侧。面部正对镜头。",
      type: "full",
      tags: "首图,抓拍,抚发",
      is_hero: 1,
      sort_order: 4,
    },
    {
      name: "首图 · 欲走未走",
      text: "模特正面，身体正直但有\"走来\"的微动态——一脚刚踏地，另一脚趾点地准备前迈，裙摆在脚踝处有轻微飘动感。双手前后自然摆动呈走动节奏。",
      type: "full",
      tags: "首图,动态,走来",
      is_hero: 1,
      sort_order: 5,
    },

    // --- 全身（已清洗：去掉内嵌的表情/眼神词，只描述身体）---
    {
      name: "站立正面",
      text: "模特正对镜头直立，双脚与肩同宽，双手自然下垂",
      type: "full",
      tags: "正面,直立,经典",
      sort_order: 10,
    },
    {
      name: "站立 45 度侧身",
      text: "模特 45 度侧身对镜头，身体微微倾斜，展示服装的侧面轮廓",
      type: "full",
      tags: "侧身,轮廓",
      sort_order: 20,
    },
    {
      name: "侧身叉腰",
      text: "模特 45 度侧身，一手自然叉腰，另一手轻垂，姿态优雅自信",
      type: "full",
      tags: "侧身,叉腰,优雅",
      sort_order: 30,
    },
    {
      name: "走动瞬间",
      text: "模特自然向前走动，一条腿微微抬起向前迈步，长发和裙摆随动作轻轻飘动",
      type: "full",
      tags: "动态,走动,飘逸",
      sort_order: 40,
    },
    {
      name: "回眸",
      text: "模特背对镜头站立，上半身回身，透过肩膀向后看向镜头",
      type: "full",
      tags: "回眸,背影,优雅",
      sort_order: 50,
    },
    {
      name: "靠墙倚立",
      text: "模特轻靠墙壁或柱子，一条腿微弯曲，整体姿态放松但仍优雅",
      type: "full",
      tags: "倚靠,放松",
      sort_order: 60,
    },
    {
      name: "低头整理裙摆",
      text: "模特微微低头，一只手自然地放在裙摆上，动作轻柔富有仪式感",
      type: "full",
      tags: "低头,裙摆,仪式感",
      sort_order: 70,
    },
    // --- 半身（已清洗）---
    {
      name: "胸部以上正面",
      text: "半身构图，模特正面胸部以上入镜，展示领口、面部和发型",
      type: "half",
      tags: "半身,正面,领口",
      sort_order: 110,
    },
    {
      name: "肩部展示",
      text: "半身构图，模特 30 度侧身，突出肩线和颈部线条，发丝自然垂落",
      type: "half",
      tags: "肩线,颈部",
      sort_order: 120,
    },
    {
      name: "半身回眸",
      text: "半身构图，模特背部对镜头，回头的瞬间，展示后背设计和颈部线条",
      type: "half",
      tags: "回眸,背部",
      sort_order: 130,
    },
    // --- 特写 ---
    {
      name: "领口细节",
      text: "相机聚焦领口和胸前位置，展示领口设计、装饰、面料质感，背景虚化",
      type: "closeup",
      tags: "领口,细节",
      sort_order: 210,
    },
    {
      name: "腰部细节",
      text: "相机聚焦腰部，展示腰带/珠饰/刺绣等装饰细节，浅景深",
      type: "closeup",
      tags: "腰部,装饰",
      sort_order: 220,
    },
    {
      name: "袖口与手部",
      text: "相机聚焦袖口和手部，展示袖型设计、面料细节，模特手势自然优雅",
      type: "closeup",
      tags: "袖口,手部",
      sort_order: 230,
    },
    {
      name: "后背设计",
      text: "相机从后方拍摄，聚焦后背，展示系带、露背、蝴蝶结等后背设计细节",
      type: "closeup",
      tags: "后背,系带",
      sort_order: 240,
    },
    {
      name: "面料质感",
      text: "极近距离微距拍摄面料表面，清晰展示纤维纹理、光泽、刺绣针脚等细节",
      type: "closeup",
      tags: "面料,微距,纹理",
      sort_order: 250,
    },
    {
      name: "裙摆与鞋",
      text: "低机位拍摄，聚焦裙摆和鞋子，展示裙长、下摆设计和鞋履搭配",
      type: "closeup",
      tags: "裙摆,鞋,低角度",
      sort_order: 260,
    },
  ];

  const stmt = db.prepare(
    `INSERT INTO poses (name, text, type, tags, is_hero, sort_order)
     VALUES (@name, @text, @type, @tags, @is_hero, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const p of poses) stmt.run({ is_hero: 0, ...p });
  });
  tx();
}

/**
 * 老库补种：5 条 hero 姿势（首图专用）
 *
 * seedPoses 自带 "if exists return" 早退，所以已有数据的库不会得到这 5 条新姿势。
 * 这里按 name 幂等插入，跑多次不会重复。
 */
function migrateInsertHeroPoses(db: Database.Database) {
  const heroes: Array<{
    name: string;
    text: string;
    type: "full";
    tags: string;
    sort_order: number;
  }> = [
    {
      name: "首图 · 自然站姿",
      text: "模特正对镜头，重心微落在右腿，左腿自然前迈半步形成对立平衡（contrapposto）。左手轻搭在裙摆侧面指尖微弯，右臂自然垂下。微微抬下巴。",
      type: "full",
      tags: "首图,正面,灵动",
      sort_order: 1,
    },
    {
      name: "首图 · 一脚前迈轻扶裙",
      text: "模特正对镜头，左脚向前轻迈半步，重心在后腿。左手轻提裙摆侧面让层次展开，右手自然垂下指尖微弯。头微侧。",
      type: "full",
      tags: "首图,正面,扶裙",
      sort_order: 2,
    },
    {
      name: "首图 · 半侧身露肩",
      text: "模特身体 30 度侧对镜头，重心放在后腿，前腿自然点地。近镜头肩膀微微下沉，远端肩微抬，凸显锁骨颈部线条。头部回正，一手自然下垂，一手轻搭腰部。",
      type: "full",
      tags: "首图,侧身,肩颈",
      sort_order: 3,
    },
    {
      name: "首图 · 抚发瞬间",
      text: "模特正对镜头，重心微落在一腿。一手抬起指尖轻拨耳后头发，营造抓拍的瞬间感，另一手垂在身侧。面部正对镜头。",
      type: "full",
      tags: "首图,抓拍,抚发",
      sort_order: 4,
    },
    {
      name: "首图 · 欲走未走",
      text: '模特正面，身体正直但有"走来"的微动态——一脚刚踏地，另一脚趾点地准备前迈，裙摆在脚踝处有轻微飘动感。双手前后自然摆动呈走动节奏。',
      type: "full",
      tags: "首图,动态,走来",
      sort_order: 5,
    },
  ];

  // 按 name 检查存在性，不存在才插入；命中就忽略，不强行覆盖管理员可能的修改
  const findStmt = db.prepare(`SELECT id FROM poses WHERE name = ?`);
  const insertStmt = db.prepare(
    `INSERT INTO poses (name, text, type, tags, is_hero, sort_order)
     VALUES (@name, @text, @type, @tags, 1, @sort_order)`,
  );
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const h of heroes) {
      if (!findStmt.get(h.name)) {
        insertStmt.run(h);
        inserted += 1;
      }
    }
  });
  tx();
  if (inserted > 0) {
    console.log(`[db] migrateInsertHeroPoses: 补种 ${inserted} 条 hero 姿势`);
  }
}

/**
 * 老库迁移：把 5 个旧 pose 文本里残留的"表情/眼神"词清洗掉
 *
 * 表情现在走 expressions 表全局单选，姿势文本里不应再嵌入表情/眼神描述。
 * 用 name + 旧片段精确匹配做幂等更新——跑多次没事，已经清洗过的库不会被改回去。
 */
function migratePoseExpressionsRemoval(db: Database.Database) {
  const updates: Array<{
    name: string;
    oldFragment: string;
    newText: string;
  }> = [
    {
      name: "站立正面",
      oldFragment: "，表情自然平静",
      newText: "模特正对镜头直立，双脚与肩同宽，双手自然下垂",
    },
    {
      name: "站立 45 度侧身",
      oldFragment: "，目光看向镜头",
      newText:
        "模特 45 度侧身对镜头，身体微微倾斜，展示服装的侧面轮廓",
    },
    {
      name: "走动瞬间",
      oldFragment: "，表情自然",
      newText:
        "模特自然向前走动，一条腿微微抬起向前迈步，长发和裙摆随动作轻轻飘动",
    },
    {
      name: "回眸",
      oldFragment: "，嘴角浅笑",
      newText: "模特背对镜头站立，上半身回身，透过肩膀向后看向镜头",
    },
    {
      name: "胸部以上正面",
      oldFragment: "，表情温柔",
      newText: "半身构图，模特正面胸部以上入镜，展示领口、面部和发型",
    },
  ];

  const stmt = db.prepare(
    `UPDATE poses SET text = ? WHERE name = ? AND text LIKE ?`,
  );
  let changed = 0;
  const tx = db.transaction(() => {
    for (const u of updates) {
      const info = stmt.run(u.newText, u.name, `%${u.oldFragment}%`);
      changed += info.changes;
    }
  });
  tx();
  if (changed > 0) {
    console.log(
      `[db] migratePoseExpressionsRemoval: 清洗 ${changed} 条 pose 文本`,
    );
  }
}

/**
 * 种子表情库（6 条预设，温柔微笑为默认）
 * 仅在 expressions 表为空时插入，不覆盖管理员后续修改
 */
function seedExpressions(db: Database.Database) {
  const exists = db.prepare(`SELECT COUNT(*) AS c FROM expressions`).get() as {
    c: number;
  };
  if (exists.c > 0) return;

  const presets: Array<{
    name: string;
    text: string;
    is_default: 0 | 1;
    sort_order: number;
  }> = [
    {
      name: "自然平静",
      text: "嘴角放松微抿，眼神平和直视镜头，无明显笑意，气质沉静",
      is_default: 0,
      sort_order: 10,
    },
    {
      name: "温柔微笑",
      text: "嘴角自然上扬呈柔和弧度，眼角带轻微笑意，整体温柔亲和",
      is_default: 1,
      sort_order: 20,
    },
    {
      name: "自信凝视",
      text: "下巴微抬，眼神坚定锁定镜头，嘴线略紧，传递自信气场",
      is_default: 0,
      sort_order: 30,
    },
    {
      name: "灿烂笑容",
      text: "牙齿轻露，眼睛弯成月牙，眉眼舒展，传递明朗喜悦",
      is_default: 0,
      sort_order: 40,
    },
    {
      name: "远眺侧目",
      text: "目光看向镜头侧前方约 15 度，嘴唇放松微抿，营造故事感和距离感",
      is_default: 0,
      sort_order: 50,
    },
    {
      name: "静谧专注",
      text: "眼睑微垂或半闭，沉浸于自身世界，嘴线放松，传递宁静专注",
      is_default: 0,
      sort_order: 60,
    },
  ];

  const stmt = db.prepare(
    `INSERT INTO expressions (name, text, is_default, sort_order)
     VALUES (@name, @text, @is_default, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const e of presets) stmt.run(e);
  });
  tx();
  console.log(`[db] seedExpressions: 写入 ${presets.length} 条表情预设`);
}

/**
 * 老库迁移：在"标准模特穿着图"模板里注入 {{expression}} 占位符
 *
 * seedPromptTemplates 早退保护已存在的库，所以新增/修改占位符要走这里。
 * 幂等：只在模板还没有 {{expression}} 时改一次。
 */
function migratePromptTemplateExpression(db: Database.Database) {
  const row = db
    .prepare(
      `SELECT id, template FROM prompt_templates WHERE kind = 'on_model' AND name = ?`,
    )
    .get("标准模特穿着图") as { id: number; template: string } | undefined;
  if (!row) return;
  if (row.template.includes("{{expression}}")) return;

  // 旧模板里 {{pose}} 后紧跟空行 + {{photography_params}}，
  // 把"面部表情"小节插入这两段中间——只描述脸，跟身体姿势不冲突。
  const before = "{{pose}}\n\n{{photography_params}}";
  const after =
    "{{pose}}\n\n【面部表情 / Expression（适用于所有姿势）】\n{{expression}}\n\n{{photography_params}}";
  if (!row.template.includes(before)) {
    console.warn(
      `[db] migratePromptTemplateExpression: 未找到预期的 {{pose}}/{{photography_params}} 锚点，跳过 (id=${row.id})`,
    );
    return;
  }
  const updated = row.template.replace(before, after);
  db.prepare(`UPDATE prompt_templates SET template = ? WHERE id = ?`).run(
    updated,
    row.id,
  );
  console.log(
    `[db] migratePromptTemplateExpression: 已为模板 #${row.id} 注入 {{expression}}`,
  );
}

/**
 * 老库幂等补种：Editorial · 极致皮肤（真实感）
 *
 * 比"硬核纪实"更具体——逐项约束毛孔密度、雀斑颗粒、虹膜纤维、油光分布等。
 * 双语关键词：英文技术词（sub-surface scattering / vellus hair / iris crypts）
 * 对图像模型的语义把握比中文细很多。
 *
 * 按 name 幂等：已经存在就跳过，不会覆盖管理员后续修改。
 */
function migrateInsertEditorialRealism(db: Database.Database) {
  const NAME = "Editorial · 极致皮肤";
  const existing = db
    .prepare(`SELECT id FROM realism_presets WHERE name = ?`)
    .get(NAME);
  if (existing) return;

  const constraints_text = `【真实感约束 / Editorial Hyperreal Skin】

Required (mandatory, do not soften):
- Skin: render at pore-level resolution. Each cheek shows 200+ visible pores
  when zoomed. Sebum sheen is NON-uniform — bright micro-highlights on nose
  tip, philtrum, chin; matte zones on outer cheeks. Sub-surface scattering
  visible in thin areas (earlobe, nostril edge).
- Imperfections REQUIRED, do not remove: 3-7 small moles or beauty marks
  scattered on visible skin (face, neck, arms, legs); micro asymmetry between
  left/right features; faint redness around nose base; light vellus hair
  (peach fuzz) on cheek edges catching backlight.
- Eyes: visible iris fiber pattern (crypts + Fuchs furrows), faint vessels
  in sclera, individually rendered eyelashes (NOT clumps), tiny moisture
  meniscus at lower lid.
- Lips: vertical lip lines visible, slight color variation between upper
  and lower lip, micro-cracks at corners.
- Hair: rendered as individual strands at edges (flyaways visible against
  background), not painted clumps. Light passes through outer strands
  creating subtle rim glow.
- Fabric: weave / fiber texture visible at 100% crop. Covered buttons show
  same fabric grain as the garment, not plastic. Pleats keep crisp edges.

Forbidden (will look fake if violated):
- Skin smoothing, beauty filter, "porcelain skin", any airbrushed surface
- AI / 3D render aesthetic, Unreal Engine glossiness, plasticky subsurface
- Symmetric features, perfect teeth, perfect skin tone uniformity
- Clumped or "painted" hair, anime-style highlights
- Over-saturation of lip / cheek color
- Generic "model face" — must look like a specific real person

Reference: shot on Phase One IQ4 150MP medium format, 80mm lens at f/5.6,
ISO 100, RAW, minimal retouching as if for Vogue editorial close-up.
The viewer should feel they could count individual pores at 100% zoom.`;

  db.prepare(
    `INSERT INTO realism_presets (name, description, constraints_text, is_default, sort_order)
     VALUES (?, ?, ?, 0, ?)`,
  ).run(
    NAME,
    "Editorial 级 · 极端真实，毛孔/雀斑/纤维像素级 · 配 Pro+4K 食用",
    constraints_text,
    60,
  );
  console.log(`[db] migrateInsertEditorialRealism: 已补种 "${NAME}"`);
}

/**
 * 老库幂等补种：Editorial · 中片幅（摄影参数）
 *
 * 锁定中片幅相机 + 80mm + f/4.5 + 大柔光箱前侧光的组合，
 * 模拟 Zara/COS/The Row 的 product imagery 视觉。
 */
function migrateInsertEditorialPhotography(db: Database.Database) {
  const NAME = "Editorial · 中片幅";
  const existing = db
    .prepare(`SELECT id FROM photography_params WHERE name = ?`)
    .get(NAME);
  if (existing) return;

  const params_text = `【摄影参数 / Editorial Medium Format】
- Camera: Phase One IQ4 150MP / Hasselblad H6D-100c (medium format aesthetic)
- Lens: 80mm f/2.8 prime (≈ 50mm full-frame equivalent)
- Aperture: f/4.5 (subject pin-sharp, gentle background separation)
- Light: large softbox 1.5m diameter, frontal-right at 30° azimuth, 15°
  elevation; white V-flat fill on opposite side; no rim / hair light
- Background: 18% neutral gray seamless paper, evenly lit, no gradient
- Color: low saturation, neutral white balance 5500K, slight warm shadow tint
- Composition: subject centered or rule-of-thirds, generous negative space
- Film simulation: Kodak Portra 400 mid-tones, slight teal-orange separation
- Post-processing: minimal — global contrast curve only, no skin retouching,
  no frequency separation, no dodge & burn
- Reference look: Zara / COS / The Row product imagery; Vogue editorial
  close-ups`;

  db.prepare(
    `INSERT INTO photography_params (name, description, params_text, is_default, sort_order)
     VALUES (?, ?, ?, 0, ?)`,
  ).run(
    NAME,
    "中片幅相机 + 大柔光 · 极致皮肤 / 面料质感",
    params_text,
    70,
  );
  console.log(`[db] migrateInsertEditorialPhotography: 已补种 "${NAME}"`);
}

/**
 * 老库迁移：把"标准模特穿着图"模板的真实感 + 面料质感前置
 *
 * v3 模板把 {{realism_constraints}} 提到模板开头第一段，
 * 把 {{material_details}} 放在【任务】之前。
 *
 * 旧库已有模板里这两个占位符**完全没有**——这意味着用户选了 realism
 * 预设但实际从未注入 prompt（材质同理）。这是个静默 bug，本迁移修复它。
 *
 * 幂等：只在模板还没有 {{realism_constraints}} 时改一次。
 */
function migrateTemplateRealismFront(db: Database.Database) {
  const row = db
    .prepare(
      `SELECT id, template FROM prompt_templates WHERE kind = 'on_model' AND name = ?`,
    )
    .get("标准模特穿着图") as { id: number; template: string } | undefined;
  if (!row) return;
  if (row.template.includes("{{realism_constraints}}")) return;

  // 第一处替换：把第一句替换为带极致真实感声明 + realism 注入
  const oldOpening =
    "你是一位专业的服装电商摄影师。请根据我提供的参考图和指令，生成 {{n}} 张高质量的服装模特摄影图。";
  const newOpening =
    "你是一位专业的服装电商摄影师。本次任务的最高优先级是【极致真实感】，所有约束在【极致真实感】之下。\n\n{{realism_constraints}}";

  if (!row.template.includes(oldOpening)) {
    console.warn(
      `[db] migrateTemplateRealismFront: 未找到预期的开篇锚点，跳过 (id=${row.id})。可能模板已被管理员手工改过。`,
    );
    return;
  }

  // 第二处替换：在【任务】小节前插入【面料质感】块
  const oldTaskAnchor = "【任务】\n让参考图 3 里的这位模特";
  const newTaskAnchor =
    "【面料质感 ⚠️ 像素级遵守】\n{{material_details}}\n\n【任务】\n让参考图 3 里的这位模特";

  if (!row.template.includes(oldTaskAnchor)) {
    console.warn(
      `[db] migrateTemplateRealismFront: 未找到【任务】锚点，跳过 (id=${row.id})。`,
    );
    return;
  }

  const updated = row.template
    .replace(oldOpening, newOpening)
    .replace(oldTaskAnchor, newTaskAnchor);

  db.prepare(`UPDATE prompt_templates SET template = ? WHERE id = ?`).run(
    updated,
    row.id,
  );
  console.log(
    `[db] migrateTemplateRealismFront: 已为模板 #${row.id} 前置 realism + 注入 material_details`,
  );
}

/**
 * 种子摄影参数库（6 套常用预设）
 */
function seedPhotographyParams(db: Database.Database) {
  const exists = db
    .prepare(`SELECT COUNT(*) AS c FROM photography_params`)
    .get() as { c: number };
  if (exists.c > 0) return;

  const presets: Array<{
    name: string;
    description: string;
    params_text: string;
    is_default: 0 | 1;
    sort_order: number;
  }> = [
    {
      name: "商品级标准图",
      description: "日常电商首选 · 自然光 · 准确还原颜色",
      is_default: 1,
      sort_order: 10,
      params_text: `【摄影参数】
- 镜头：85mm 人像镜头
- 光圈：f/4（景深适中，主体清晰，背景柔和）
- 角度：平视（与模特胸部齐平）
- 光源：柔光箱主光（左前方 45 度） + 反光板补光
- 色调：自然、中性、准确还原服装真实颜色
- 白平衡：标准日光，无色偏
- 构图：三分法，主体居中偏左，适度留白
- 情绪：端庄、自然`,
    },
    {
      name: "柔美氛围感",
      description: "杂志 / Lookbook 风 · 浅景深 · 温暖奶油色调",
      is_default: 0,
      sort_order: 20,
      params_text: `【摄影参数】
- 镜头：50mm 标准镜头
- 光圈：f/2.0（浅景深，背景柔焦）
- 角度：微俯拍（让模特腿部视觉拉长）
- 光源：柔和的自然窗光
- 色调：温暖柔美，微微偏奶油色
- 构图：留白多，模特居中，氛围优先
- 情绪：柔美、安静、优雅`,
    },
    {
      name: "户外自然光",
      description: "户外外景 · 黄金时段 · 温暖金黄色调",
      is_default: 0,
      sort_order: 30,
      params_text: `【摄影参数】
- 镜头：35mm
- 光圈：f/2.8
- 角度：平视或微仰，表现模特与环境的关系
- 光源：黄金时段的自然光（日出后或日落前 1 小时）
- 色调：温暖金黄，阳光逆光感
- 构图：环境与人物融合，前景虚化增强纵深
- 情绪：自由、浪漫、自然`,
    },
    {
      name: "影棚纯净白底",
      description: "纯白背景 · 双灯布光 · 全身锐利",
      is_default: 0,
      sort_order: 40,
      params_text: `【摄影参数】
- 镜头：50mm
- 光圈：f/8（景深大，全身锐利清晰）
- 角度：平视，正面或 45 度
- 光源：双灯布光——主光柔光箱 + 辅光柔光伞；无强烈阴影
- 色调：纯净、高对比、无色偏
- 构图：纯白或浅灰背景，模特居中，四周留白均匀
- 情绪：专业、商务、商品化`,
    },
    {
      name: "细节特写微距",
      description: "面料/装饰特写 · 100mm 微距 · 突出质感",
      is_default: 0,
      sort_order: 50,
      params_text: `【摄影参数】
- 镜头：100mm 微距镜头
- 光圈：f/5.6（景深够展示细节，同时保留周边柔焦）
- 焦点：装饰、面料纹理、针脚等细节处
- 光源：侧光为主，突出材质质感和立体感
- 色调：饱和度略高，强调材质
- 构图：局部特写，主体占画面 60% 以上
- 情绪：精致、工艺感`,
    },
    {
      name: "仰拍大片感",
      description: "婚礼 / 礼服 · 仰角 · 戏剧化光影",
      is_default: 0,
      sort_order: 60,
      params_text: `【摄影参数】
- 镜头：24mm 广角
- 光圈：f/4
- 角度：低角度仰拍，模特占画面 60-70%
- 光源：戏剧化布光，冷暖色温对比（前景暖，背景冷）
- 色调：冷暖对比鲜明，电影感
- 构图：垂直构图，强调模特高度和服装的延展性
- 情绪：盛大、正式、仪式感`,
    },
  ];

  const stmt = db.prepare(
    `INSERT INTO photography_params (name, description, params_text, is_default, sort_order)
     VALUES (@name, @description, @params_text, @is_default, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const p of presets) stmt.run(p);
  });
  tx();
}

/**
 * 种子 Prompt 模板（on_model 类）
 *
 * 模板使用以下占位符，生成时会被替换：
 *   {{garment_attrs}}       - 款式解析出的结构化属性（自动拼接）
 *   {{pose}}                - 用户选的姿势文本（多张图时，每张对应一个）
 *   {{photography_params}}  - 用户选的摄影参数预设
 *   {{user_seed}}           - 用户自定义文字种子（可选）
 *   {{n}}                   - 本次生成的图片数量
 */
function seedPromptTemplates(db: Database.Database) {
  const existing = db
    .prepare(
      `SELECT COUNT(*) AS c FROM prompt_templates WHERE kind = 'on_model'`,
    )
    .get() as { c: number };
  if (existing.c > 0) return;

  const templates: Array<{
    name: string;
    kind: string;
    template: string;
    notes: string;
    sort_order: number;
  }> = [
    {
      name: "标准模特穿着图",
      kind: "on_model",
      sort_order: 10,
      notes:
        "最通用的模板，适合日常商品图批量生成。v3 强化：真实感 + 面料质感前置，并接入 expression 维度",
      template: `你是一位专业的服装电商摄影师。本次任务的最高优先级是【极致真实感】，所有约束在【极致真实感】之下。

{{realism_constraints}}

【参考图职责分解 ⚠️ 严格遵守】

▸ 参考图 1-2（产品服装）—— 只取"服装本身"
  - 使用：颜色、面料、版型、长度、领口、袖型、装饰细节
  - 必须忽略：图中可能出现的模特（脸 / 发型 / 姿势 / 体型）、图中的背景（窗户 / 立柱 / 家具 / 花艺 / 灯光 / 地面）
  - ❌ 严禁把参考图 1-2 里的任何场景元素搬到最终图里

▸ 参考图 3（模特形象）—— 只取"模特本人"
  - 使用：脸型、肤色、发型、眼睛、体型
  - 必须忽略：图中的背景、姿势、服装

▸ 参考图 4（场景背景）—— 这是最终图唯一的背景来源
  - 必须使用：背景、地面、墙面、整体光线氛围
  - 如果参考图 4 是纯色 / 极简，最终图也必须是纯色 / 极简，不要自行添加任何场景元素

【款式信息】
{{garment_attrs}}

【面料质感 ⚠️ 像素级遵守】
{{material_details}}

【任务】
让参考图 3 里的这位模特，穿着参考图 1-2 里的服装，在参考图 4 的背景中，按以下姿势拍摄 {{n}} 张图，每张对应一个姿势：

{{pose}}

【面部表情 / Expression（适用于所有姿势）】
{{expression}}

{{photography_params}}

【鞋履要求 ⚠️ 严格按规格执行，不要自由发挥】
模特必须穿着以下**精确规格**的高跟鞋（这是整批共用的指定款式，所有图都必须完全一致）：

  ▸ {{shoe_spec}}

- 全身照 / 中景里鞋子应清晰可见；特写镜头不强制要求出镜
- ❌ 严禁更换颜色、跟高、款式、材质——上述描述是唯一允许的鞋型
- ❌ 严禁运动鞋、平底鞋、人字拖、雪地靴、马丁靴、洞洞鞋、罗马凉鞋等任何不适合礼服场合的款式
- ❌ 严禁让模特赤脚

【一致性约束（严格遵守）】
1. 背景一致性：所有图的背景必须严格匹配参考图 4。即使姿势描述里出现"走动""倚靠""仪式感"等词，也不要联想或自行生成参考图 4 之外的场景元素
2. 人物一致性：每张图只有 1 个人，就是参考图 3 里的那位模特
3. 服装一致性：服装与参考图 1-2 完全一致
4. 鞋履一致性：严格按上方【鞋履要求】中的规格，颜色 / 跟高 / 款式 / 材质完全照搬，不得"创作"
5. 唯一变量：只有姿势和构图可以不同

【禁止事项】
- 不要在图里添加其他人物、模特、路人
- 不要从参考图 1-2 借用任何场景元素（最常见的失误，特别注意）
- 不要添加水印、logo、文字、图章
- 不要改变服装的颜色或纹理
- 不要改变模特的脸部特征
- 不要让模特赤脚 / 穿运动鞋 / 平底鞋 / 拖鞋 / 任何不适合礼服场合的鞋

{{user_seed}}

请依次输出 {{n}} 张图片，按上面列出的姿势顺序。`,
    },
    {
      name: "精致特写组图",
      kind: "on_model",
      sort_order: 20,
      notes: "更强调细节和面料质感，适合展示产品工艺",
      template: `你是一位专业的时装摄影师。请根据提供的参考图生成 {{n}} 张展示服装工艺和细节的摄影作品。

【参考图】
- 图 1-2：服装（正/背面）
- 图 3：模特形象（透明背景）
- 图 4：场景背景

【款式特征】
{{garment_attrs}}

【拍摄任务】
请让图 3 的模特穿着图 1-2 的服装，在图 4 的场景中拍 {{n}} 张图，按以下姿势/构图，**更关注装饰、面料、工艺的细节**：

{{pose}}

{{photography_params}}

【鞋履要求 ⚠️ 严格按规格执行】
模特必须穿着以下**精确规格**的高跟鞋（整批共用，款式 / 颜色 / 跟高 / 材质完全锁定）：

  ▸ {{shoe_spec}}

- 全身/中景里鞋子应清晰可见；特写镜头不强制
- ❌ 严禁更换颜色、跟高、款式、材质
- ❌ 严禁运动鞋、平底鞋、人字拖、马丁靴、洞洞鞋、罗马凉鞋、赤脚

【质量要求】
- 所有图里人物、服装、场景必须高度一致
- 每张图只有 1 位模特，面容和身材固定
- 服装颜色、面料、每一处装饰（珠片/蕾丝/刺绣/褶皱）都与原图完全相同
- 如果是特写镜头，面料纹理、针脚、光泽要清晰可见

【禁止】多人物、替换模特、修改服装、水印、文字、logo、赤脚 / 平底鞋 / 运动鞋 / 拖鞋

{{user_seed}}

请按顺序输出 {{n}} 张图片。`,
    },
    {
      name: "假人场景模板（背景一致性强约束）",
      kind: "on_model",
      sort_order: 30,
      notes: "专为「假人模特场景」设计：参考图 4 是带假人的影棚，AI 把假人替换为真人模特并锁定背景一致",
      template: `你是一位专业的服装电商摄影师。请生成 {{n}} 张高质量的服装模特摄影图。

【参考图说明】
- 参考图 1-2：产品服装（正面 + 背面）
- 参考图 3：真人模特（脸 / 肤色 / 发型 / 体型 的参考）
- 参考图 4：**场景定位参考**——里面的假人模特（白色哑光人台）只是用来标示主体位置、光线方向、地面接触点和相机角度，**不是真正要出现在最终图里的人**

【款式信息】
{{garment_attrs}}

【核心任务 - 替换 + 背景锁定】

把参考图 4 里的"假人模特"**完全替换**为参考图 3 的真人模特，让真人穿上参考图 1-2 的服装，按下面 {{n}} 个姿势拍摄：

{{pose}}

{{photography_params}}

【背景一致性 · 严格锁定（最关键约束）】

参考图 4 提供的影棚背景必须在所有 {{n}} 张图中保持 **100% 一致**：

1. **颜色一致**：背景纸的灰度 / 色调 / 明度跟参考图 4 完全相同，不要变色、不要变明暗
2. **光线一致**：主光方向、强度、色温、阴影位置跟参考图 4 完全一致（如果参考图 4 是左上 45 度光，所有 {{n}} 张图都必须是左上 45 度光）
3. **空间一致**：cyclorama 弧形过渡线的位置、地面延展、墙面渐变跟参考图 4 完全一致
4. **机位一致**：相机距离、高度（眼平视）、镜头焦段、景深跟参考图 4 完全一致
5. **氛围一致**：整体亮度、对比度、饱和度跟参考图 4 完全一致

唯一允许变化的是：**模特的姿势 + 模特身上的服装**。其他一切（背景 / 光线 / 视角 / 氛围）必须像同一个摄影师在同一组连续拍摄中拍出来的——只是模特换了姿势而已。

【模特一致性】
- 所有 {{n}} 张图里的模特必须是同一人（参考图 3 的人）：脸型、肤色、发型、眼睛、体型完全一致
- 模特脚下要有自然的接地阴影（跟参考图 4 假人的脚下阴影位置一致）
- 模特的体积、比例跟参考图 4 假人差不多大小，站位也大致相同

【服装一致性】
- 所有 {{n}} 张图里的服装跟参考图 1-2 完全一致：颜色、面料、版型、长度、领口、袖型、装饰（蕾丝/珠片/刺绣/褶皱/系带等）都不能改
- 服装受光跟参考图 4 的光线方向匹配（左上来光 → 服装左侧亮，右侧带阴影）

【鞋履要求 ⚠️ 严格按规格执行】
模特必须穿着以下**精确规格**的高跟鞋（整批共用同一双鞋，所有图完全一致）：

  ▸ {{shoe_spec}}

- 鞋子受光与参考图 4 的光线方向匹配（与服装 / 模特受光保持一致）
- ❌ 严禁更换颜色、跟高、款式、材质——上述描述是唯一允许的鞋型
- ❌ 严禁运动鞋、平底鞋、人字拖、雪地靴、马丁靴、洞洞鞋、罗马凉鞋等任何不适合礼服场合的款式
- ❌ 严禁让模特赤脚

【禁止事项】
- 不要在图里画出假人模特（已被真人替换）
- 不要添加其他人物、路人、第二个模特
- 不要添加水印、logo、文字、图章、品牌标识
- 不要改变背景颜色 / 光线方向 / 相机角度
- 不要改变服装的颜色或纹理
- 不要改变模特的脸部特征
- 不要在不同图之间改变背景的任何细节
- 不要让模特赤脚 / 穿运动鞋 / 平底鞋 / 拖鞋 / 任何不适合礼服场合的鞋

{{user_seed}}

请依次输出 {{n}} 张图片，按上面列出的姿势顺序。**强调：所有图的背景、光线、视角必须像复制粘贴一样完全一致，只是姿势不同。**`,
    },
  ];

  const stmt = db.prepare(
    `INSERT INTO prompt_templates (name, kind, template, notes, sort_order)
     VALUES (@name, @kind, @template, @notes, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const t of templates) stmt.run(t);
  });
  tx();
}

/**
 * 真实感预设库种子
 * 目的：在生成图片时明确告诉模型"要像真实人像摄影，不要 AI 磨皮感"
 */
function seedRealismPresets(db: Database.Database) {
  const exists = db
    .prepare(`SELECT COUNT(*) AS c FROM realism_presets`)
    .get() as { c: number };
  if (exists.c > 0) return;

  const presets: Array<{
    name: string;
    description: string;
    constraints_text: string;
    is_default: 0 | 1;
    sort_order: number;
  }> = [
    {
      name: "自然真实（标准）",
      description: "日常商品图标配 · 柔和的真实感",
      is_default: 1,
      sort_order: 10,
      constraints_text: `【真实感约束 / Realism】
要求 (Required):
- 皮肤呈现真实摄影质感：保留可见的毛孔、细小肌理、自然的光影过渡 (visible pores, natural texture)
- 肤色有自然变化：面颊微微泛红、鼻尖略深、颈部和下颌有自然阴影
- 发丝可见层次：根根分明的发丝、自然飞发、分缕清晰
- 保留少量自然瑕疵：浅痘印、细纹、雀斑等真实人类皮肤特征（避免完美无瑕）
- 皮肤不同部位有不同的油光/干燥/柔软度变化，像真实人像摄影

禁止 (Forbidden):
- 磨皮、美颜滤镜效果 (no beauty filter, no skin smoothing)
- 塑料感、橡胶质感、假人感 (no plastic / rubber / mannequin feel)
- AI 绘画感、数字插画感、3D 渲染感 (no AI art / 3D render / illustration style)
- 过度柔焦、皮肤细节丢失
- 完美无瑕光滑如瓷的皮肤、镜面反光的皮肤
- 过度美化后导致的"不像真人"效果

拍摄哲学 (Aesthetic):
- 目标是"真实人像摄影"（editorial / documentary portrait），不是美颜 App 或 AI 生成`,
    },
    {
      name: "商业修图（轻度美化）",
      description: "电商精修标准 · 略美化但保留真实",
      is_default: 0,
      sort_order: 20,
      constraints_text: `【真实感约束 / Realism - Commercial Retouch】
要求:
- 皮肤整体平滑但保留毛孔和自然纹理（轻微修饰但非磨皮）
- 肤色均匀化，但保留自然的红润和阴影层次
- 发丝清晰，整体整洁但保留自然动态
- 光影柔和，整体呈现"电商精修"标准

禁止:
- 完全磨皮导致塑料感
- 过度美白导致不真实
- AI 感或数字插画感
- 发丝结块或不自然

拍摄哲学:
- 电商商品图的标准修图——整洁、干净，但依然是真实摄影`,
    },
    {
      name: "电影级质感（强调自然）",
      description: "大片感 · 真实到极致 · 胶片颗粒",
      is_default: 0,
      sort_order: 30,
      constraints_text: `【真实感约束 / Realism - Cinematic】
要求:
- 极高的真实度：毛孔、细纹、甚至皮肤上的小绒毛都清晰可见
- 保留所有自然特征：痘印、痣、肤色不均、疲惫感等
- 轻微胶片颗粒感 (film grain, ISO 400-800 feel)
- 头发层次丰富，光影在发丝间自然过渡
- 皮肤质感呈现电影摄影（ARRI Alexa / Kodak film）的质感

禁止:
- 任何形式的磨皮或美化
- 过度锐化或数字感
- AI 插画或 3D 渲染感

拍摄哲学:
- 电影级人像（cinematic portrait），让画面"重得起来"，像真人在镜头前生活`,
    },
    {
      name: "时尚大片（略修饰）",
      description: "杂志 / lookbook 风 · 略美化但时髦",
      is_default: 0,
      sort_order: 40,
      constraints_text: `【真实感约束 / Realism - Fashion Editorial】
要求:
- 皮肤呈现时尚杂志的精修质感：毛孔若隐若现但不粗糙
- 肤色修饰偏冷色调或暖色调（根据场景），但依然真实
- 发丝整洁有型，可呈现刻意的造型感
- 光影戏剧化但自然
- 整体呈现 Vogue / Harper's Bazaar 风格的精致人像

禁止:
- 过度磨皮到失去真实感
- AI 生成的塑料感
- 看起来像手机美颜 App

拍摄哲学:
- 高级时尚摄影（high fashion editorial）——精致但不失真实`,
    },
    {
      name: "硬核纪实（零修饰）",
      description: "完全不修 · 纪实摄影级 · 极端真实",
      is_default: 0,
      sort_order: 50,
      constraints_text: `【真实感约束 / Realism - Documentary】
要求:
- 零修饰：完全保留原生皮肤状态，所有瑕疵、纹理、光斑
- 毛孔、毫毛、皮肤颗粒都清晰可见
- 保留所有自然皱褶、表情纹
- 头发完全自然状态，允许凌乱
- 光线真实不做美化

禁止:
- 任何修饰、美化、平滑化
- 任何 AI 痕迹

拍摄哲学:
- 纪实摄影（documentary photography）——真实至上，摄影师不打扰模特`,
    },
  ];

  const stmt = db.prepare(
    `INSERT INTO realism_presets (name, description, constraints_text, is_default, sort_order)
     VALUES (@name, @description, @constraints_text, @is_default, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const p of presets) stmt.run(p);
  });
  tx();
}

/**
 * 面料材质库种子
 * 涵盖伴娘服/礼服/婚纱常用的核心材质
 */
function seedMaterials(db: Database.Database) {
  const exists = db.prepare(`SELECT COUNT(*) AS c FROM materials`).get() as {
    c: number;
  };
  if (exists.c > 0) return;

  const materials: Array<{
    name: string;
    english_name: string;
    aliases: string;
    description: string;
    visual_traits: string;
    light_behavior: string;
    texture_rules: string;
    dont_confuse_with: string;
    sort_order: number;
  }> = [
    {
      name: "雪纺",
      english_name: "chiffon",
      aliases: "雪纺,chiffon,纱,轻纱,乔其纱",
      description: "轻薄飘逸半透明面料，常用于礼服和伴娘服",
      visual_traits:
        "轻薄透明、质地柔软飘逸、下垂感明显、多层叠加呈现半透视效果、走动/风吹时有自然流动感、表面细腻无粗糙颗粒、微微哑光",
      light_behavior:
        "半透明：光线容易穿透形成柔和光晕；褶皱处有微妙阴影渐变，不产生强烈反光；逆光时呈现朦胧发光感（halo）",
      texture_rules:
        "编织密度高但纱线细，近观肌理细密；不能有塑料感或橡胶质感；多层叠加时每层都要有独立的质感",
      dont_confuse_with:
        "不要画成缎面（无强反光）；不要画得硬挺或厚重（应柔软下垂）；不要出现粗糙纹理或织物颗粒",
      sort_order: 10,
    },
    {
      name: "缎面",
      english_name: "satin",
      aliases: "缎面,缎,satin,丝缎",
      description: "光泽丝滑面料，反光强，高贵感",
      visual_traits:
        "表面光滑如丝、反光强烈、丝滑有光泽、厚重感适中、高光和阴影对比明显、呈现液态流动般的质感",
      light_behavior:
        "强镜面反光（specular highlight）：高光区域明亮锐利，阴影深邃；对光源方向和角度非常敏感；不同角度看呈现不同的色彩深浅",
      texture_rules: "表面必须极度光滑，无可见编织纹理；褶皱呈现圆润的光影过渡",
      dont_confuse_with:
        "不要画成哑光面料（必须有强反光）；不要出现纱质的半透明感；不要看起来像塑料片",
      sort_order: 20,
    },
    {
      name: "哑光缎面",
      english_name: "matte satin",
      aliases: "哑光缎面,哑缎,matte satin,duchess satin",
      description: "缎面的哑光版本，更高级更含蓄",
      visual_traits:
        "表面光滑但反射柔和、丝绸质地、低调的光泽感、不像普通缎面那样闪亮、更沉稳的视觉效果",
      light_behavior:
        "漫反射为主：光线柔和散开，无强烈镜面反光；整体呈现柔和的低光泽（semi-gloss）；褶皱阴影柔和过渡",
      texture_rules: "表面光滑但不反光如镜，像哑光丝绸",
      dont_confuse_with:
        "不要画成高反光的普通缎面；不要完全失去光泽变成纯哑光布料",
      sort_order: 30,
    },
    {
      name: "蕾丝",
      english_name: "lace",
      aliases: "蕾丝,lace,花边,刺绣",
      description: "镂空花纹装饰面料，常作为装饰或整体",
      visual_traits:
        "镂空花纹图案、立体刺绣感、图案层次丰富、花朵或几何纹样、花纹间有透光",
      light_behavior:
        "透光部位清晰可见底层（皮肤或衬里）；实体花纹处有阴影与立体感；花纹本身可能有刺绣的立体凸起",
      texture_rules:
        "花纹复杂但不杂乱，针脚细腻可见；立体感强（3D embroidery 效果）；图案要连贯不碎片化",
      dont_confuse_with:
        "不要画成平面印花（必须有镂空和立体感）；不要花纹糊在一起；不要失去透光感",
      sort_order: 40,
    },
    {
      name: "弹力绉纱",
      english_name: "stretch crepe",
      aliases: "弹力绉纱,绉纱,crepe,弹力面料",
      description: "表面有细密褶皱的弹性面料，贴身塑形",
      visual_traits:
        "表面有细密的褶皱肌理（crinkled surface）、贴身塑形展现身体曲线、弹性垂顺、微微哑光",
      light_behavior: "漫反射为主；细密褶皱产生规律性的微小阴影图案，形成独特肌理",
      texture_rules:
        "可见细密的褶皱颗粒感（pebble texture），但不生硬；贴合身体时产生流畅的光影过渡",
      dont_confuse_with: "不要画成光滑的缎面（必须有细小褶皱质感）；不要画成硬挺的梭织",
      sort_order: 50,
    },
    {
      name: "纱网",
      english_name: "tulle",
      aliases: "纱网,tulle,网纱,头纱",
      description: "网状轻薄面料，常用于蓬蓬裙和头纱",
      visual_traits:
        "网状结构肉眼可见、极度轻薄、蓬松感、空气感强、多层堆叠时呈现云朵般的视觉效果",
      light_behavior: "光线穿透形成朦胧感；边缘柔和模糊；多层叠加时透光度递减",
      texture_rules: "网眼规整清晰，但整体观感柔软蓬松",
      dont_confuse_with: "不要画成实体布料（必须透气透光）；不要网眼粗大像渔网",
      sort_order: 60,
    },
    {
      name: "欧根纱",
      english_name: "organza",
      aliases: "欧根纱,organza,绢网纱",
      description: "挺括半透明面料，硬挺有型",
      visual_traits:
        "半透明、挺括有型（不像雪纺那么软）、能保持立体造型、表面光滑微有光泽、硬朗的轮廓感",
      light_behavior: "半透明；表面有轻微的光泽；褶皱呈现锐利的边缘",
      texture_rules: "硬挺，可以做大蓬裙型；表面平整",
      dont_confuse_with: "不要画成柔软下垂的雪纺（必须硬挺）；不要画成塑料片",
      sort_order: 70,
    },
    {
      name: "丝绒",
      english_name: "velvet",
      aliases: "丝绒,velvet,天鹅绒",
      description: "绒面面料，奢华厚重",
      visual_traits:
        "表面有细密绒毛、厚重质感、光线入射角度不同呈现不同的颜色深浅（anisotropic）、奢华感",
      light_behavior:
        "独特的各向异性反射：顺毛方向偏亮，逆毛方向偏暗；表面像吸光又像反光，呈现深邃感",
      texture_rules: "可见细绒毛的方向性；褶皱处颜色加深",
      dont_confuse_with: "不要画成光滑的缎面；不要失去绒毛感变成平面布料",
      sort_order: 80,
    },
    {
      name: "塔夫绸",
      english_name: "taffeta",
      aliases: "塔夫绸,taffeta",
      description: "硬挺有声感的面料，复古质感",
      visual_traits:
        "硬挺有身骨、表面有珠光般的光泽、轻微的经纬交错纹理、走动时有轻微的沙沙声感（画面应体现硬度）、复古奢华感",
      light_behavior: "有光泽但不像缎面那么液态；珠光效果（shimmery）",
      texture_rules: "可见的经纬纹理细节；硬挺不柔顺",
      dont_confuse_with: "不要画成柔软的缎面；不要失去硬度",
      sort_order: 90,
    },
    {
      name: "梭织棉",
      english_name: "woven cotton",
      aliases: "梭织,梭织棉,woven,cotton",
      description: "梭织结构的棉质面料",
      visual_traits:
        "表面平整、可见规整的经纬线编织纹理、硬挺有结构感、哑光",
      light_behavior: "漫反射为主，无强反光；自然的光影过渡",
      texture_rules: "近距离可见经纬纹路；不要画得过于光滑或液态",
      dont_confuse_with: "不要画成缎面（无强反光）；不要画成针织（无线圈结构）",
      sort_order: 100,
    },
  ];

  const stmt = db.prepare(
    `INSERT INTO materials (name, english_name, aliases, description, visual_traits, light_behavior, texture_rules, dont_confuse_with, sort_order)
     VALUES (@name, @english_name, @aliases, @description, @visual_traits, @light_behavior, @texture_rules, @dont_confuse_with, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const m of materials) stmt.run(m);
  });
  tx();
}

/**
 * 模型单价种子（首次启动 INSERT OR IGNORE，不覆盖管理员后续在管理页的修改）
 */
function seedModelPrices(db: Database.Database) {
  const prices: Array<{
    model_id: string;
    input_per_1m_usd: number;
    output_per_1m_usd: number;
    tier: string;
    notes: string;
  }> = [
    // 文本/视觉模型
    {
      model_id: "gemini-2.5-flash",
      input_per_1m_usd: 0.3,
      output_per_1m_usd: 2.5,
      tier: "standard",
      notes: "Gemini 2.5 Flash 视觉解析首选（便宜快）",
    },
    {
      model_id: "gemini-2.5-pro",
      input_per_1m_usd: 1.25,
      output_per_1m_usd: 10.0,
      tier: "standard",
      notes: "Gemini 2.5 Pro 复杂识别（<=200K ctx）",
    },
    {
      model_id: "gemini-3-pro-preview",
      input_per_1m_usd: 1.25,
      output_per_1m_usd: 10.0,
      tier: "standard",
      notes: "Gemini 3 Pro 文本预览版",
    },
    // 图像生成
    {
      model_id: "gemini-3-pro-image-preview",
      input_per_1m_usd: 2.0,
      output_per_1m_usd: 120.0,
      tier: "standard",
      notes:
        "Nano Banana Pro - 每张输入图 560 tokens；输出 1K/2K 1120 tokens($0.134)，4K 2000 tokens($0.24)",
    },
    {
      model_id: "gemini-3.1-flash-image-preview",
      input_per_1m_usd: 0.3,
      output_per_1m_usd: 60.0,
      tier: "standard",
      notes:
        "Nano Banana 2 - 每张输入图 1120 tokens；输出 512~4K 约 747~2520 tokens，$0.045~$0.15",
    },
    {
      model_id: "gemini-2.5-flash-image",
      input_per_1m_usd: 0.3,
      output_per_1m_usd: 60.0,
      tier: "standard",
      notes: "Nano Banana GA 旧版，费率类似 Flash Image",
    },
    {
      model_id: "gemini-2.5-flash-image-preview",
      input_per_1m_usd: 0.3,
      output_per_1m_usd: 60.0,
      tier: "standard",
      notes: "Nano Banana 初代 preview",
    },
    // OpenAI gpt-image-2（按 size × quality 固定价，token-based 计费不太适用）
    // 这里塞个名义 token 单价占位，实际 cost 由 lib/openai-image estimateCost 函数返回（按 size×quality 查表）
    {
      model_id: "gpt-image-2",
      input_per_1m_usd: 10.0,
      output_per_1m_usd: 0.0, // output 部分走固定 per-image，token 计费忽略
      tier: "standard",
      notes:
        "GPT Image 2 - 按 size×quality 固定价：1024×1536 high $0.165 / med $0.041 / low $0.005；4K high $2.24。Tier 1 限 5 IPM",
    },
    {
      model_id: "gpt-image-1-mini",
      input_per_1m_usd: 5.0,
      output_per_1m_usd: 0.0,
      tier: "standard",
      notes: "GPT Image 1 Mini 便宜版本，按 size 固定价",
    },
  ];

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO model_prices
       (model_id, input_per_1m_usd, output_per_1m_usd, tier, notes)
     VALUES (@model_id, @input_per_1m_usd, @output_per_1m_usd, @tier, @notes)`,
  );
  const tx = db.transaction(() => {
    for (const p of prices) stmt.run(p);
  });
  tx();
}

/**
 * 全局配置种子（INSERT OR IGNORE，已存在不覆盖）
 */
function seedSettings(db: Database.Database) {
  const settings: Array<{ key: string; value: string; notes: string }> = [
    {
      key: "usd_to_cny",
      value: "6.83",
      notes: "美元兑人民币汇率（用于账单换算，管理员可改）",
    },
    {
      key: "default_budget_cny",
      value: "0",
      notes:
        "新用户默认月度预算（人民币，0 = 无限。管理员可在用户管理页单独调整）",
    },
    {
      key: "image_rate_limit_per_min",
      value: "2",
      notes:
        "单个图片模型每分钟最多请求数（Google preview 默认 2，提额后管理员改这里）",
    },
    {
      key: "image_rate_burst",
      value: "2",
      notes:
        "token bucket 容量（即突发上限）。一般等于 image_rate_limit_per_min",
    },
    {
      key: "image_concurrency",
      value: "1",
      notes:
        "单个 job 内并发执行的 item 数量。Vertex 默认 1（串行最稳）；Gemini API 推荐 4-5（用满 RPM）。受 RPM 上限节流，并发再大也不会超 RPM。",
    },
    {
      key: "ai_provider",
      value: "vertex",
      notes:
        "AI 提供方：'vertex' = Vertex AI（GCP，需 ADC + project + location）；'gemini_api' = Gemini API 直连（只需 API key，Tier 1 速率高得多）",
    },
    {
      key: "gemini_api_key",
      value: "",
      notes:
        "Gemini API key（仅 ai_provider=gemini_api 时使用）。从 https://aistudio.google.com/app/apikey 创建。",
    },
    {
      key: "openai_api_key",
      value: "",
      notes:
        "OpenAI API key（gpt-image-2 用）。从 https://platform.openai.com/api-keys 创建。",
    },
    {
      key: "openai_proxy_url",
      value: "",
      notes:
        "OpenAI 调用走的代理（GFW 环境需要），如 http://127.0.0.1:7892。生产 VM 在墙外可留空。",
    },
    {
      key: "openai_ipm_limit",
      value: "5",
      notes:
        "OpenAI gpt-image-2 每分钟图片数上限（Tier 1 = 5，Tier 2 = 50，按账号 tier 配）",
    },
  ];

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, notes) VALUES (@key, @value, @notes)`,
  );
  const tx = db.transaction(() => {
    for (const s of settings) stmt.run(s);
  });
  tx();
}

export const DATA_DIR_PATH = DATA_DIR;

// ==========================================
// Seed: 色卡 / 模特 / 场景 —— 来自 seed-assets/
// ==========================================

interface SeedColorEntry {
  name: string;
  hex: string;
  color_group: string;
  color_group_label?: string;
  is_popular?: boolean;
  note?: string;
  sort_order: number;
}

interface SeedIdentityEntry {
  file: string;
  name: string;
  category: string;
  category_label: string;
  tags?: string;
  sort_order: number;
}

interface SeedSceneEntry {
  file: string;
  name: string;
  tags?: string;
  /** 场景分类 key（wedding / outdoor / studio / street / indoor / garden）*/
  category?: string;
  /** 场景库分流：'single' = 主图场景库；'poster' = 海报大场景库。默认 single */
  usage?: "single" | "poster";
  sort_order: number;
}

/**
 * 种子色卡（来自 seed-assets/colors.json）
 * 仅在 colors 表为空时执行
 */
function seedColors(db: Database.Database) {
  const exists = db.prepare(`SELECT COUNT(*) AS c FROM colors`).get() as {
    c: number;
  };
  if (exists.c > 0) return;

  let colors: SeedColorEntry[];
  try {
    const seedAssets = require("./seed-assets") as typeof import("./seed-assets");
    if (!seedAssets.hasSeedAssets()) {
      console.log("[db] seed-assets/ not found, 跳过 seedColors");
      return;
    }
    colors = seedAssets.readManifest<SeedColorEntry[]>("colors.json");
  } catch (err) {
    console.warn("[db] seedColors 读取 colors.json 失败:", err);
    return;
  }

  const stmt = db.prepare(
    `INSERT INTO colors (name, hex, color_group, is_popular, sort_order)
     VALUES (@name, @hex, @color_group, @is_popular, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const c of colors) {
      stmt.run({
        name: c.name,
        hex: c.hex,
        color_group: c.color_group,
        is_popular: c.is_popular ? 1 : 0,
        sort_order: c.sort_order,
      });
    }
  });
  tx();
  console.log(`[db] seedColors: 写入 ${colors.length} 个色卡`);
}

/**
 * 种子模特图（来自 seed-assets/identities/）
 * 仅在 identity 表为空时执行
 */
function seedIdentitiesFromAssets(db: Database.Database) {
  const exists = db
    .prepare(`SELECT COUNT(*) AS c FROM models WHERE kind = 'identity'`)
    .get() as { c: number };
  if (exists.c > 0) return;

  let entries: SeedIdentityEntry[];
  let copySeedAsset: typeof import("./seed-assets").copySeedAsset;
  try {
    const seedAssets = require("./seed-assets") as typeof import("./seed-assets");
    if (!seedAssets.hasSeedAssets()) {
      console.log("[db] seed-assets/ not found, 跳过 seedIdentitiesFromAssets");
      return;
    }
    entries = seedAssets.readManifest<SeedIdentityEntry[]>(
      "identities/manifest.json",
    );
    copySeedAsset = seedAssets.copySeedAsset;
  } catch (err) {
    console.warn("[db] seedIdentitiesFromAssets 读取 manifest 失败:", err);
    return;
  }

  const prepared: Array<SeedIdentityEntry & { image_path: string }> = [];
  for (const e of entries) {
    try {
      const { relPath } = copySeedAsset(e.file, "identities");
      prepared.push({ ...e, image_path: relPath });
    } catch (err) {
      console.warn(`[db] 模特图复制失败 (${e.file}):`, err);
    }
  }

  const stmt = db.prepare(
    `INSERT INTO models (kind, name, image_path, tags, category, sort_order)
     VALUES ('identity', @name, @image_path, @tags, @category, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const p of prepared) {
      stmt.run({
        name: p.name,
        image_path: p.image_path,
        tags: p.tags || null,
        category: p.category,
        sort_order: p.sort_order,
      });
    }
  });
  tx();
  console.log(
    `[db] seedIdentitiesFromAssets: 写入 ${prepared.length} 张模特图`,
  );
}

/**
 * 种子场景背景图（来自 seed-assets/scenes/）
 * 仅在 scenes 表为空时执行
 */
function seedScenesFromAssets(db: Database.Database) {
  const exists = db.prepare(`SELECT COUNT(*) AS c FROM scenes`).get() as {
    c: number;
  };
  if (exists.c > 0) return;

  let entries: SeedSceneEntry[];
  let copySeedAsset: typeof import("./seed-assets").copySeedAsset;
  try {
    const seedAssets = require("./seed-assets") as typeof import("./seed-assets");
    if (!seedAssets.hasSeedAssets()) {
      console.log("[db] seed-assets/ not found, 跳过 seedScenesFromAssets");
      return;
    }
    entries = seedAssets.readManifest<SeedSceneEntry[]>(
      "scenes/manifest.json",
    );
    copySeedAsset = seedAssets.copySeedAsset;
  } catch (err) {
    console.warn("[db] seedScenesFromAssets 读取 manifest 失败:", err);
    return;
  }

  const prepared: Array<SeedSceneEntry & { image_path: string }> = [];
  for (const e of entries) {
    try {
      const { relPath } = copySeedAsset(e.file, "scenes");
      prepared.push({ ...e, image_path: relPath });
    } catch (err) {
      console.warn(`[db] 场景图复制失败 (${e.file}):`, err);
    }
  }

  const stmt = db.prepare(
    `INSERT INTO scenes (name, image_path, tags, category, usage, sort_order)
     VALUES (@name, @image_path, @tags, @category, @usage, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const p of prepared) {
      stmt.run({
        name: p.name,
        image_path: p.image_path,
        tags: p.tags || null,
        category: p.category || null,
        usage: p.usage || "single",
        sort_order: p.sort_order,
      });
    }
  });
  tx();
  console.log(`[db] seedScenesFromAssets: 写入 ${prepared.length} 张场景图`);
}

/**
 * 老库幂等迁移：把 manifest.json 里"按 name 不在 DB 的"场景补种进来。
 *
 * seedScenesFromAssets 自带"表非空就早退"保护 → 已部署的库（有 3 张老 scenes）
 * 不会得到后续追加的 27 张新场景。这里逐条按 name 检查，不存在则补。
 *
 * 同时会按 manifest 写入 usage / category（即使老 row 已经存在也会
 * 在 row 缺 usage 时回填）。
 *
 * 单次跑由 settings 表里的 'migrated_scenes_v2' 标记守护，
 * 重复部署不会再次插入——这样 admin 删除场景后下次 deploy 不会反复回填。
 */
function migrateInsertNewScenes(db: Database.Database) {
  // 每次给 manifest 加新场景时把版本号 bump 一下，让已部署的 VM 再跑一次补种。
  // v2 = 初次架构落地（3 张老 scene + 占位）；
  // v3 = 加入 25 张实景图（10 单人主图 + 15 海报大场景，2026-05-05）；
  // v4 = 删除 3 张"通用浅色背景"（纯色背景改用色值器，不再走 scenes 表）
  const FLAG = "migrated_scenes_v4";
  const flag = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(FLAG) as { value: string } | undefined;
  if (flag?.value === "done") return;

  let entries: SeedSceneEntry[];
  let copySeedAsset: typeof import("./seed-assets").copySeedAsset;
  try {
    const seedAssets = require("./seed-assets") as typeof import("./seed-assets");
    if (!seedAssets.hasSeedAssets()) {
      console.log("[db] seed-assets/ not found, 跳过 migrateInsertNewScenes");
      return;
    }
    entries = seedAssets.readManifest<SeedSceneEntry[]>(
      "scenes/manifest.json",
    );
    copySeedAsset = seedAssets.copySeedAsset;
  } catch (err) {
    console.warn("[db] migrateInsertNewScenes 读取 manifest 失败:", err);
    return;
  }

  const findByName = db.prepare(`SELECT id FROM scenes WHERE name = ?`);
  const insertStmt = db.prepare(
    `INSERT INTO scenes (name, image_path, tags, category, usage, sort_order)
     VALUES (@name, @image_path, @tags, @category, @usage, @sort_order)`,
  );

  let inserted = 0;
  let deleted = 0;
  const tx = db.transaction(() => {
    // v4 清理：删 3 张"通用浅色背景"（纯色背景改用色值器，不再走 scenes 表）
    const OBSOLETE_NAMES = [
      "通用浅色背景 1",
      "通用浅色背景 2",
      "通用浅色背景 3",
    ];
    const deleteStmt = db.prepare(`DELETE FROM scenes WHERE name = ?`);
    for (const name of OBSOLETE_NAMES) {
      const r = deleteStmt.run(name);
      if (r.changes > 0) deleted += r.changes;
    }

    for (const e of entries) {
      if (findByName.get(e.name)) continue; // 同名已存在 → 跳过
      try {
        const { relPath } = copySeedAsset(e.file, "scenes");
        insertStmt.run({
          name: e.name,
          image_path: relPath,
          tags: e.tags || null,
          category: e.category || null,
          usage: e.usage || "single",
          sort_order: e.sort_order,
        });
        inserted += 1;
      } catch (err) {
        console.warn(`[db] migrateInsertNewScenes 复制失败 (${e.file}):`, err);
      }
    }
    // 标记已跑，下次部署不再扫
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, notes) VALUES (?, 'done', ?)`,
    ).run(
      FLAG,
      "scenes 库 v4 已收敛（删 3 张通用浅色 + 保持 25 张实景图）",
    );
  });
  tx();
  if (inserted > 0 || deleted > 0) {
    console.log(
      `[db] migrateInsertNewScenes: 补种 ${inserted} 张 / 清理 ${deleted} 张（已标记 ${FLAG}=done）`,
    );
  }
}

/**
 * 新姿势补种（v2）
 * 来源：docs/new-poses.json
 * 6 全身 + 4 特写 = 10 个新姿势。按 name 幂等，重复部署不会重插。
 */
function migrateInsertNewPoses(db: Database.Database) {
  const FLAG = "migrated_poses_v2";
  const flag = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(FLAG) as { value: string } | undefined;
  if (flag?.value === "done") return;

  type PoseSeed = {
    name: string;
    text: string;
    type: "full" | "half" | "closeup";
    tags: string;
    is_hero: 0 | 1;
    sort_order: number;
  };

  const NEW_POSES: PoseSeed[] = [
    {
      name: "背身回眸",
      text: "Model stands with her back to the camera, head turned slightly over her left shoulder looking softly back at the lens. Spine elongated, shoulders relaxed and slightly squared. One hand resting naturally at her side, the other lightly touching her hip. Hair gathered low at the nape or in a low bun to expose the neckline and back of the dress. Calm composed expression with a hint of a smile. Frames the back of the gown / bodice fully.",
      type: "full",
      tags: "全身,背身,回眸,展示后背",
      is_hero: 1,
      sort_order: 100,
    },
    {
      name: "自然正面站",
      text: "Model stands facing the camera straight-on, weight evenly distributed across both feet, body axis perfectly vertical. Both arms relaxed and naturally falling at her sides, slightly away from the body so the silhouette of the dress is fully visible. Shoulders open, chin slightly raised, gaze direct and confident. Subtle natural smile or neutral elegant expression. Hair flowing freely over shoulders. The pose maximally shows off the full front view of the garment.",
      type: "full",
      tags: "全身,正面,自然站立,基础",
      is_hero: 1,
      sort_order: 110,
    },
    {
      name: "单手叉腰正面",
      text: "Model stands facing the camera with weight shifted slightly to one leg (contrapposto). One hand placed lightly on her hip with the elbow angled outward, the other arm falling gracefully at her side. Shoulders open and relaxed, head straight with a soft confident gaze and gentle closed-lip smile. Hair cascading naturally over one shoulder. The pose creates a subtle S-curve through the body that flatters the dress's waist and skirt drape.",
      type: "full",
      tags: "全身,正面,叉腰,S形",
      is_hero: 1,
      sort_order: 120,
    },
    {
      name: "背身撩发",
      text: "Model with her back to the camera, head and torso turned gently to one side as she lifts one hand up to lightly touch or sweep her hair behind her ear or along her temple. The lifted arm creates a soft elegant curve framing her face in three-quarter profile. Other arm relaxed at her side or resting at her lower back. Shoulders relaxed, spine elongated. Calm contemplative expression with eyes looking softly downward or off-camera.",
      type: "full",
      tags: "全身,背身,撩发,优雅",
      is_hero: 1,
      sort_order: 130,
    },
    {
      name: "双手扶腰",
      text: "Model stands facing the camera with both hands placed lightly on her hips, fingers spread naturally, elbows angled outward. Weight slightly forward, body axis vertical. Shoulders squared and open, posture confident but relaxed. Head straight or slightly tilted, gaze direct with a neutral or subtly amused expression. This pose emphasizes the waistline and hip silhouette of the dress, ideal for showing off cinched-waist or A-line cuts.",
      type: "full",
      tags: "全身,正面,双手叉腰,自信",
      is_hero: 0,
      sort_order: 140,
    },
    {
      name: "S形侧立",
      text: "Model stands in a soft S-curve pose: one hip pushed gently to the side, weight on the back leg, front leg slightly forward and crossed. One hand lightly rests near the collarbone or touches the strap of the dress, the other falls naturally at the hip. Torso gently twisted toward the camera in three-quarter view. Head tilted slightly, looking directly at the lens with a sultry or warm expression. The pose creates an hourglass silhouette emphasizing waist and bust.",
      type: "full",
      tags: "全身,S形,侧身,性感",
      is_hero: 0,
      sort_order: 150,
    },
    {
      name: "全身侧光开衩",
      text: "Full-body standing pose photographed slightly from the side, light coming from the front-right creating soft shadow on the left side of the body. Model facing camera with head turned slightly down and to one side in a contemplative gaze. One leg stepping forward through a high front slit, revealing the thigh and the dress's lining. Both arms relaxed at sides, hands hanging naturally. This pose showcases the slit construction and the ruched / draped fabric detail at the waist.",
      type: "full",
      tags: "全身,正面,侧光,开衩展示",
      is_hero: 0,
      sort_order: 160,
    },
    {
      name: "腰部以上双叉腰",
      text: "Tightly cropped half-body view from approximately mid-thigh up. Model facing the camera with both hands placed on the hips just above the waist, elbows angled outward creating a strong triangular frame. Crop excludes the face (cut just below the chin) to emphasize the bodice, neckline, fabric texture, and waist construction of the dress. Strong confident stance, shoulders square.",
      type: "half",
      tags: "半身,叉腰,展示版型,无脸",
      is_hero: 0,
      sort_order: 200,
    },
    {
      name: "侧身腰部细节",
      text: "Cropped to focus on the bodice and high-slit detail from collarbone to upper thigh. Model standing in three-quarter angle with body slightly turned away from camera. One hand resting on the waist where the corset / waistline detail is, the other hand subtly lifting the slit edge of the skirt to reveal the leg. Crop excludes the face. Emphasizes the corset structure, lace inset, and slit construction.",
      type: "half",
      tags: "半身,侧身,腰部细节,开衩,无脸",
      is_hero: 0,
      sort_order: 210,
    },
    {
      name: "锁骨胸前特写",
      text: "Tight close-up from upper chest to lower waist, framed to highlight the bodice details: neckline cut, lace trim, embroidery placement, beading, and any decorative bow / ribbon at the bust. Model's hands gently positioned: one hand may lightly touch the strap or pull a ribbon loose; the other rests on the corseted waist. Crop excludes the face. Photographed against soft warm light to emphasize fabric texture and lace sheerness.",
      type: "closeup",
      tags: "特写,锁骨,胸前,蕾丝细节",
      is_hero: 0,
      sort_order: 300,
    },
  ];

  const findByName = db.prepare(`SELECT id FROM poses WHERE name = ?`);
  const insertStmt = db.prepare(
    `INSERT INTO poses (name, text, type, tags, is_hero, sort_order)
     VALUES (@name, @text, @type, @tags, @is_hero, @sort_order)`,
  );

  let inserted = 0;
  const tx = db.transaction(() => {
    for (const p of NEW_POSES) {
      if (findByName.get(p.name)) continue; // 同名已存在 → 跳过
      insertStmt.run(p);
      inserted += 1;
    }
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, notes) VALUES (?, 'done', ?)`,
    ).run(FLAG, "姿势库 v2 补种（10 个新姿势：6 全身 + 4 特写 / 半身）");
  });
  tx();
  if (inserted > 0) {
    console.log(`[db] migrateInsertNewPoses: 补种 ${inserted} 个新姿势（已标记 ${FLAG}=done）`);
  }
}

/**
 * 老库的"v2 新装饰材质"补种（亮片 / 珠子 / 3D花朵 / 提花 / 刺绣 / 多材质混搭 / 渐变色 / 蕾丝装饰）
 *
 * 跟基础面料库（雪纺 / 缎面 / 蕾丝 etc.）的区别：
 *   - 基础面料是"主体面料"——决定整件衣服的版型、垂感、光泽方向
 *   - 这一批是"装饰/工艺/染色处理"——常常叠加在基础面料上（缎面 + 亮片刺绣）
 *
 * UI 让用户多选时基础面料 + 装饰可以同时选；prompt builder（formatMaterialDetails）
 * 已经支持多个 material 的 visual_traits / light_behavior 拼接，不用改。
 *
 * 按 name 幂等：已经存在的不重复插。完成后 settings 写 FLAG=done。
 */
function migrateInsertNewMaterials(db: Database.Database) {
  const FLAG = "migrated_materials_v2";
  const flag = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(FLAG) as { value: string } | undefined;
  if (flag?.value === "done") return;

  type MaterialSeed = {
    name: string;
    english_name: string;
    aliases: string;
    description: string;
    visual_traits: string;
    light_behavior: string;
    texture_rules: string;
    dont_confuse_with: string;
    sort_order: number;
  };

  const NEW_MATERIALS: MaterialSeed[] = [
    {
      name: "亮片",
      english_name: "sequin",
      aliases: "亮片,sequin,sequins,sparkle,glitter,亮钻,亮片绣",
      description: "小圆片状反光装饰，常密集排列在面料上形成闪烁效果",
      visual_traits:
        "无数小圆形或多边形反光片紧密排列在面料上、每片亮片大小约 3-6mm、表面金属质感、强烈定向反光、密集时整片面料呈鳞片状闪烁、灯光下产生彩虹光斑（spectral highlights）",
      light_behavior:
        "镜面反光极强：每一片亮片都是独立反光源，整体呈现闪烁颗粒感（点状高光阵列）；不同角度看时亮片明暗变化剧烈；闪光呈现尖锐的星芒效果",
      texture_rules:
        "必须看见独立的亮片颗粒，不能糊成一片光斑；亮片之间可见底层面料；密集排列时呈现鱼鳞状层次；边缘处可能露出亮片缝合的线迹",
      dont_confuse_with:
        "不要画成连续平滑的金属面（必须是离散颗粒）；不要画成印花亮粉（亮片有实体厚度）；不要丢失闪烁的星点效果",
      sort_order: 200,
    },
    {
      name: "珠子",
      english_name: "beading",
      aliases: "珠子,珠饰,bead,beads,beading,珠绣,pearl,珍珠绣",
      description: "立体珠子装饰，单颗或成串缝缀在面料上",
      visual_traits:
        "球形或水滴形立体颗粒、表面光滑有圆润反光、单颗或排列成线条/花纹、珠子之间可见缝线和底布、整体有立体凸起感、珍珠光泽或玻璃透明感",
      light_behavior:
        "每颗珠子是球面反光体：高光点小而集中，沿珠面边缘有 falloff 阴影；珍珠类有内部柔和光泽（subsurface scattering 感）；玻璃珠透光时可见底层布料颜色",
      texture_rules:
        "必须画出珠子的立体感（球形阴影 + 高光），不能画成平面圆点；密集珠绣时珠子之间有微小阴影间隙；珠子在褶皱处会有遮挡和重叠",
      dont_confuse_with:
        "不要画成印花圆点（必须有立体阴影）；不要混淆为亮片（珠子是球形，亮片是片状）；不要让珠子失去高光变成哑色圆点",
      sort_order: 210,
    },
    {
      name: "蕾丝装饰",
      english_name: "lace applique",
      aliases: "蕾丝装饰,蕾丝贴花,lace applique,lace trim,蕾丝缀饰",
      description: "把蕾丝作为装饰元素贴缝在其他面料上（非整体蕾丝面料）",
      visual_traits:
        "蕾丝花片缝在主体面料表面、花片有明确边缘、立体凸起、镂空花纹可见底层面料的颜色、常用于领口/袖口/腰部/裙摆作为点缀",
      light_behavior:
        "蕾丝花片本身呈现立体感，边缘可能有阴影；底层主面料的光泽不受影响；花片镂空处直接显露底布颜色和质感",
      texture_rules:
        "花片边缘清晰锐利可辨；花纹立体（3D embroidery 凸起 0.5-2mm）；与主面料的衔接处可见细密缝线；不要让花片『陷进』主面料里失去贴附感",
      dont_confuse_with:
        "不要画成整片蕾丝面料（应该是局部点缀）；不要画成印花图案（必须有立体凸起）；不要丢失底布纹理（透过镂空能看见）",
      sort_order: 220,
    },
    {
      name: "3D花朵",
      english_name: "3D flower applique",
      aliases: "3D花朵,立体花,3d flower,floral applique,立体花朵装饰",
      description: "立体织物花朵缀饰，多层花瓣有真实立体感",
      visual_traits:
        "立体花朵贴缝在面料上、每朵花有多层花瓣、花瓣有自然弯曲弧度、花朵直径 3-15cm 不等、单朵或成簇排列、花蕊处可能有珠子或刺绣装饰、整体凸起 1-3cm",
      light_behavior:
        "每片花瓣是独立面，有自己的高光和阴影；花瓣层叠处有清晰的相互投影；花朵在不同光线下呈现立体雕塑感；花瓣边缘可能微微卷边产生 backlit 透光",
      texture_rules:
        "必须画出花瓣的层叠关系（外层包内层）；花瓣面料质感要清晰（雪纺花瓣 vs 缎面花瓣 vs 绉纱花瓣 视觉差异要保留）；不能画成平面贴纸",
      dont_confuse_with:
        "不要画成印花图案（必须立体）；不要画成蕾丝花纹（蕾丝是镂空平面，3D花朵是凸起雕塑）；不要让花朵变扁失去层叠感",
      sort_order: 230,
    },
    {
      name: "提花",
      english_name: "jacquard",
      aliases: "提花,jacquard,jacquard weave,提花织物,锦缎,brocade",
      description: "织造时直接在面料上形成花纹，花纹与底布一体",
      visual_traits:
        "花纹是织出来的不是绣上去的、与底布一体无凸起、花纹和底色形成不同光泽对比（如同色提花的光泽方向不同）、纹理细腻、整片面料有华丽感",
      light_behavior:
        "底布和花纹的光泽方向 / 强度不同：花纹处可能更亮或更哑光（视编织方向）；不存在独立花片的高光，整体是一片连续表面的明暗对比；同色提花靠光泽差异显花",
      texture_rules:
        "花纹与底布在同一平面，不能有凸起；近观可见经纬交错形成的图案；同色提花要刻意保留花纹（不能因为颜色相近而消失）；图案规整连续",
      dont_confuse_with:
        "不要画成印花（提花是织出来的，印花是印上去的；提花更立体细腻）；不要画成绣花（无独立凸起花片）；不要丢失光泽对比让花纹消失",
      sort_order: 240,
    },
    {
      name: "刺绣",
      english_name: "embroidery",
      aliases: "刺绣,embroidery,embroidered,绣花,绣",
      description: "用线在面料上绣出花纹，线条立体可见",
      visual_traits:
        "彩色或同色丝线在面料上绣出图案、可见独立的针脚和线条方向、立体凸起 0.5-2mm、线的光泽方向跟着针脚走、复杂图案可包含多种针法",
      light_behavior:
        "丝线本身有光泽，光泽方向跟针脚走向一致（顺光绣 vs 逆光绣 明暗差异明显）；绣线之间有微小阴影间隙；缎绣 vs 平绣 vs 锁边绣 的光感各不相同",
      texture_rules:
        "必须看见独立针脚走向（不能糊成一片）；绣线的丝光质感要保留；图案边缘可见绣线收尾的精细感；线密集时形成有方向性的纹理",
      dont_confuse_with:
        "不要画成印花（必须立体可辨针脚）；不要画成提花（绣花是后期附加，提花是织造一体）；不要画成蕾丝（无镂空）",
      sort_order: 250,
    },
    {
      name: "多材质混搭",
      english_name: "mixed materials",
      aliases: "多材质混搭,混搭,mixed,combo,mixed fabric,材质拼接",
      description: "同一件衣服上多种不同面料组合（如缎面上身 + 雪纺裙摆）",
      visual_traits:
        "同一件衣服上 2-3 种面料按结构分区（上衣 vs 裙摆 vs 装饰）、不同面料的光泽和垂感对比明显、拼接处有明确分界线或包边、整体设计感更复杂",
      light_behavior:
        "每个面料区域保持自己的光感（缎面强反光区 vs 雪纺漫反射区 vs 蕾丝镂空区 同时呈现）；不要让所有区域光感趋同；面料交界处可能有阴影或饰边",
      texture_rules:
        "每种面料的视觉特征必须独立保留：缎面要光滑反光、雪纺要轻盈半透、蕾丝要镂空立体；分区清晰但过渡自然，不要硬切割感",
      dont_confuse_with:
        "不要把所有部分画成同一种面料；不要让接缝处生硬突兀；交界处的工艺（包边/拼缝）要可见",
      sort_order: 260,
    },
    {
      name: "渐变色",
      english_name: "gradient ombre",
      aliases: "渐变色,渐变,ombre,ombré,gradient,dip dye,扎染渐变",
      description: "面料从一种颜色平滑过渡到另一种颜色",
      visual_traits:
        "颜色沿某一方向（上下/斜向/中心向外）平滑过渡、过渡区域无明显边界、可以是同色系深浅渐变也可以是异色渐变、保留面料原本的质感（不影响光泽和纹理）",
      light_behavior:
        "光泽和反光方式不变（缎面渐变还是缎面光泽，雪纺渐变还是雪纺漫反射），只是颜色随位置变化；高光和阴影的色相会随渐变区域改变",
      texture_rules:
        "颜色过渡必须平滑连续无色带；面料的纹理 / 编织 / 装饰不受渐变影响；渐变方向要清晰一致；色彩饱和度过渡也要自然",
      dont_confuse_with:
        "不要画成色块拼接（必须平滑过渡）；不要让渐变破坏面料原本的质感；不要出现可见的色带分界线",
      sort_order: 270,
    },
  ];

  let inserted = 0;
  const upsert = db.prepare(
    `INSERT INTO materials
       (name, english_name, aliases, description,
        visual_traits, light_behavior, texture_rules, dont_confuse_with, sort_order)
     VALUES (@name, @english_name, @aliases, @description,
             @visual_traits, @light_behavior, @texture_rules, @dont_confuse_with, @sort_order)`,
  );
  const exists = db.prepare(`SELECT id FROM materials WHERE name = ?`);

  const tx = db.transaction(() => {
    for (const m of NEW_MATERIALS) {
      if (exists.get(m.name)) continue;
      upsert.run(m);
      inserted += 1;
    }
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, notes) VALUES (?, 'done', ?)`,
    ).run(FLAG, "材质库 v2 补种（8 个装饰材质：亮片 / 珠子 / 蕾丝装饰 / 3D花朵 / 提花 / 刺绣 / 多材质混搭 / 渐变色）");
  });
  tx();
  if (inserted > 0) {
    console.log(`[db] migrateInsertNewMaterials: 补种 ${inserted} 个新材质（已标记 ${FLAG}=done）`);
  }
}

/**
 * 老库色卡 v2 全量替换（2026-05 用户提供新 XLS 色卡 50 种）
 *
 * 跟其他 migrate* 函数不一样：这个是"全删 + 全新插入"，因为新色卡是
 * 用户精选的整套调色板，不需要保留老库里的杂色。
 *
 * 安全性：
 *   - colors 表没有 FK 被其他表硬引用（recolor job 在创建时把 {id, name, hex}
 *     快照进 params JSON）。删 colors.id 不破坏历史 job 显示。
 *   - usage_records.notes 是 JSON 文本，已经存了 name + hex，不依赖现 row。
 *
 * FLAG=migrated_colors_v2，幂等：跑过一次后不再动。
 * 想推 v3 新一轮色卡？换一个 FLAG（migrated_colors_v3）即可。
 */
function migrateReplaceColorsV2(db: Database.Database) {
  const FLAG = "migrated_colors_v2";
  const flag = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(FLAG) as { value: string } | undefined;
  if (flag?.value === "done") return;

  type ColorSeed = {
    name: string;
    hex: string;
    color_group: string; // 英文 plural 统一（Yellows / Purples / Pinks / Oranges / Neutrals / Greens / Darks / Blues / Reds）
    is_popular: 0 | 1;
    sort_order: number;
  };

  // 9 大色系，按用户 XLS 顺序排：Yellow → Purples → Pink → orange → Neutrals → Greens → Darks → Blue → Red
  // sort_order 设计：色系 base 数 + 段内序号，方便 UI 按色系折叠时顺序稳定
  const NEW_COLORS: ColorSeed[] = [
    // ===== Yellows =====
    { name: "Lemon",         hex: "#FFF27B", color_group: "Yellows",  is_popular: 0, sort_order: 100 },
    { name: "Daffodil",      hex: "#FFE9A1", color_group: "Yellows",  is_popular: 1, sort_order: 110 },
    { name: "Butter",        hex: "#FCDDAE", color_group: "Yellows",  is_popular: 1, sort_order: 120 },

    // ===== Purples =====
    { name: "Lilac",         hex: "#E5D6DF", color_group: "Purples",  is_popular: 1, sort_order: 200 },
    { name: "Lavender",      hex: "#B59EB0", color_group: "Purples",  is_popular: 1, sort_order: 210 },
    { name: "Wisteria",      hex: "#C9A0DC", color_group: "Purples",  is_popular: 0, sort_order: 220 },
    { name: "Mauve",         hex: "#9289BC", color_group: "Purples",  is_popular: 0, sort_order: 230 },
    { name: "Mulberry",      hex: "#772C54", color_group: "Purples",  is_popular: 0, sort_order: 240 },
    { name: "Plum",          hex: "#3D0F42", color_group: "Purples",  is_popular: 0, sort_order: 250 },

    // ===== Pinks =====
    { name: "Blushing Pink", hex: "#FDE9E9", color_group: "Pinks",    is_popular: 1, sort_order: 300 },
    { name: "Petal",         hex: "#FFD6DB", color_group: "Pinks",    is_popular: 1, sort_order: 310 },
    { name: "Coral",         hex: "#FF777F", color_group: "Pinks",    is_popular: 0, sort_order: 320 },
    { name: "Dusty Rose",    hex: "#D3B6B6", color_group: "Pinks",    is_popular: 1, sort_order: 330 },
    { name: "Rose Gold",     hex: "#B76E79", color_group: "Pinks",    is_popular: 0, sort_order: 340 },

    // ===== Oranges =====
    { name: "Marigold",      hex: "#D87F03", color_group: "Oranges",  is_popular: 0, sort_order: 400 },
    { name: "Orange",        hex: "#FF8640", color_group: "Oranges",  is_popular: 0, sort_order: 410 },
    { name: "Cinnamon",      hex: "#C35D32", color_group: "Oranges",  is_popular: 0, sort_order: 420 },
    { name: "Terracotta",    hex: "#874329", color_group: "Oranges",  is_popular: 1, sort_order: 430 },

    // ===== Neutrals =====
    { name: "White",         hex: "#FAFAFA", color_group: "Neutrals", is_popular: 1, sort_order: 500 },
    { name: "Ivory",         hex: "#F6F5F0", color_group: "Neutrals", is_popular: 1, sort_order: 510 },
    { name: "Sand",          hex: "#EAE3D6", color_group: "Neutrals", is_popular: 1, sort_order: 520 },
    { name: "Champagne",     hex: "#F1E9D2", color_group: "Neutrals", is_popular: 1, sort_order: 530 },
    { name: "Gold",          hex: "#EFCC93", color_group: "Neutrals", is_popular: 0, sort_order: 540 },
    { name: "Silver",        hex: "#C0C0C0", color_group: "Neutrals", is_popular: 0, sort_order: 550 },
    { name: "Grey",          hex: "#ADACA9", color_group: "Neutrals", is_popular: 0, sort_order: 560 },
    { name: "Mocha",         hex: "#3E2A20", color_group: "Neutrals", is_popular: 0, sort_order: 570 },

    // ===== Greens =====
    { name: "Mint Green",    hex: "#A1D2B4", color_group: "Greens",   is_popular: 0, sort_order: 600 },
    { name: "Dusty Sage",    hex: "#A3BF9F", color_group: "Greens",   is_popular: 1, sort_order: 610 },
    { name: "Sage Green",    hex: "#8A9A5B", color_group: "Greens",   is_popular: 1, sort_order: 620 },
    { name: "Olive Green",   hex: "#556B2F", color_group: "Greens",   is_popular: 0, sort_order: 630 },
    { name: "Peacock",       hex: "#174D4B", color_group: "Greens",   is_popular: 0, sort_order: 640 },
    { name: "Forest Green",  hex: "#12392E", color_group: "Greens",   is_popular: 0, sort_order: 650 },
    { name: "Emerald",       hex: "#134C36", color_group: "Greens",   is_popular: 0, sort_order: 660 },

    // ===== Darks =====
    { name: "Dark Navy",     hex: "#000046", color_group: "Darks",    is_popular: 0, sort_order: 700 },
    { name: "Espresso",      hex: "#52443B", color_group: "Darks",    is_popular: 0, sort_order: 710 },
    { name: "Black",         hex: "#000000", color_group: "Darks",    is_popular: 1, sort_order: 720 },

    // ===== Blues =====
    { name: "Sky Blue",      hex: "#CEE7F5", color_group: "Blues",    is_popular: 1, sort_order: 800 },
    { name: "Mist",          hex: "#D6E0EF", color_group: "Blues",    is_popular: 0, sort_order: 810 },
    { name: "Dusty Blue",    hex: "#8397A6", color_group: "Blues",    is_popular: 1, sort_order: 820 },
    { name: "Peacock Blue",  hex: "#33A1C9", color_group: "Blues",    is_popular: 0, sort_order: 830 },
    { name: "Steel Blue",    hex: "#4682B4", color_group: "Blues",    is_popular: 0, sort_order: 840 },
    { name: "Slate Blue",    hex: "#6A5ACD", color_group: "Blues",    is_popular: 0, sort_order: 850 },
    { name: "Royal Blue",    hex: "#0F47A9", color_group: "Blues",    is_popular: 0, sort_order: 860 },
    { name: "Stormy",        hex: "#4F5D75", color_group: "Blues",    is_popular: 0, sort_order: 870 },
    { name: "Navy Blue",     hex: "#182A55", color_group: "Blues",    is_popular: 1, sort_order: 880 },
    { name: "Teal",          hex: "#014A5F", color_group: "Blues",    is_popular: 0, sort_order: 890 },

    // ===== Reds =====
    { name: "Rust",          hex: "#90322A", color_group: "Reds",     is_popular: 1, sort_order: 900 },
    { name: "Cabernet",      hex: "#722F37", color_group: "Reds",     is_popular: 0, sort_order: 910 },
    { name: "Burgundy",      hex: "#751E15", color_group: "Reds",     is_popular: 1, sort_order: 920 },
    { name: "Wine",          hex: "#751E15", color_group: "Reds",     is_popular: 0, sort_order: 930 },
  ];

  const insert = db.prepare(
    `INSERT INTO colors (name, hex, color_group, is_popular, sort_order)
     VALUES (@name, @hex, @color_group, @is_popular, @sort_order)`,
  );

  let oldCount = 0;
  let inserted = 0;
  const tx = db.transaction(() => {
    const before = db.prepare(`SELECT COUNT(*) AS c FROM colors`).get() as { c: number };
    oldCount = before.c;
    // 全删（颜色被 job 用过的话，job 的 params JSON 里有 name+hex 快照不会丢）
    db.prepare(`DELETE FROM colors`).run();
    for (const c of NEW_COLORS) {
      insert.run(c);
      inserted += 1;
    }
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, notes) VALUES (?, 'done', ?)`,
    ).run(
      FLAG,
      `色卡库 v2 替换（删 ${oldCount} 老色，插 ${inserted} 新色：50 种 / 9 色系）`,
    );
  });
  tx();
  console.log(
    `[db] migrateReplaceColorsV2: 删 ${oldCount} 老色 → 插 ${inserted} 新色（已标记 ${FLAG}=done）`,
  );
}

/**
 * 老库通用模特 v2 重置（2026-05 用户提供新 11 张原型变体形象）
 *
 * 行为：
 *   1. 删除所有 category='universal' 的 identity，但保留 name='通用 12' 的那条
 *   2. 把 seed-assets/identities/universal/universal_new_01..11.* 拷到 DATA_DIR 并入库
 *      name 用 "通用新 01".."通用新 11"
 *
 * 安全性：historical batch-photo job 在创建时 snapshot 了 {id, name, image_path}
 * 进 params JSON，删 models 表的行不破坏历史 job 显示（图片文件还在 DATA_DIR）。
 *
 * FLAG=migrated_identities_universal_v2 一次性。
 */
function migrateResetUniversalIdentitiesV2(db: Database.Database) {
  const FLAG = "migrated_identities_universal_v2";
  const flag = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(FLAG) as { value: string } | undefined;
  if (flag?.value === "done") return;

  let copySeedAsset: typeof import("./seed-assets").copySeedAsset;
  try {
    const seedAssets = require("./seed-assets") as typeof import("./seed-assets");
    if (!seedAssets.hasSeedAssets()) {
      console.log("[db] seed-assets/ not found, 跳过 migrateResetUniversalIdentitiesV2");
      return;
    }
    copySeedAsset = seedAssets.copySeedAsset;
  } catch (err) {
    console.warn("[db] migrateResetUniversalIdentitiesV2 加载 seed-assets 失败:", err);
    return;
  }

  // 11 张新模特图（拷贝时第一张 sabrine 是 .jpg，其他 10 张是 .png）
  type NewIdSeed = { file: string; name: string; sort_order: number };
  const NEW_UNIVERSAL: NewIdSeed[] = [
    { file: "identities/universal/universal_new_01.jpg", name: "通用新 01", sort_order: 1101 },
    { file: "identities/universal/universal_new_02.png", name: "通用新 02", sort_order: 1102 },
    { file: "identities/universal/universal_new_03.png", name: "通用新 03", sort_order: 1103 },
    { file: "identities/universal/universal_new_04.png", name: "通用新 04", sort_order: 1104 },
    { file: "identities/universal/universal_new_05.png", name: "通用新 05", sort_order: 1105 },
    { file: "identities/universal/universal_new_06.png", name: "通用新 06", sort_order: 1106 },
    { file: "identities/universal/universal_new_07.png", name: "通用新 07", sort_order: 1107 },
    { file: "identities/universal/universal_new_08.png", name: "通用新 08", sort_order: 1108 },
    { file: "identities/universal/universal_new_09.png", name: "通用新 09", sort_order: 1109 },
    { file: "identities/universal/universal_new_10.png", name: "通用新 10", sort_order: 1110 },
    { file: "identities/universal/universal_new_11.png", name: "通用新 11", sort_order: 1111 },
  ];

  let deleted = 0;
  let inserted = 0;
  const insert = db.prepare(
    `INSERT INTO models (kind, name, image_path, tags, category, sort_order)
     VALUES ('identity', @name, @image_path, '通用', 'universal', @sort_order)`,
  );

  const tx = db.transaction(() => {
    // 删除 universal 除"通用 12"外的所有 identity
    const res = db
      .prepare(
        `DELETE FROM models
         WHERE kind = 'identity' AND category = 'universal' AND name <> '通用 12'`,
      )
      .run();
    deleted = res.changes;

    // 拷贝并入库 11 张新图
    for (const seed of NEW_UNIVERSAL) {
      try {
        const { relPath } = copySeedAsset(seed.file, "identities");
        insert.run({
          name: seed.name,
          image_path: relPath,
          sort_order: seed.sort_order,
        });
        inserted += 1;
      } catch (err) {
        console.warn(
          `[db] migrateResetUniversalIdentitiesV2 拷贝失败 (${seed.file}):`,
          err,
        );
      }
    }

    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, notes) VALUES (?, 'done', ?)`,
    ).run(
      FLAG,
      `通用模特 v2 重置（删 ${deleted} 旧 universal，保留"通用 12"，插 ${inserted} 张新形象）`,
    );
  });
  tx();
  console.log(
    `[db] migrateResetUniversalIdentitiesV2: 删 ${deleted} → 插 ${inserted}（已标记 ${FLAG}=done）`,
  );
}

/**
 * 老库新主图场景 v3 补种（2026-05 用户提供 28 张 OpenAI Playground 生成的纯场景图）
 *
 * 这一批和 v2 不同：v2 是大场景（廊柱、外景全景），用户已经清掉了。
 * v3 全是"小场景 / 易摆姿势"的纯场景图（无人、有家具/门/桌/楼梯/栏杆等可互动物件）。
 * 跟新的场景 prompt v3"读场景物件自由互动"配合最好。
 *
 * 按 name 幂等：之前如果已经手动入过同名场景，跳过不重复插。
 * 不删除老库的现有场景（保留用户已挑过的，让用户在 admin 里自己清理无用的）。
 *
 * FLAG=migrated_scenes_v3 一次性。
 */
function migrateInsertNewScenesV3(db: Database.Database) {
  const FLAG = "migrated_scenes_v3";
  const flag = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(FLAG) as { value: string } | undefined;
  if (flag?.value === "done") return;

  let copySeedAsset: typeof import("./seed-assets").copySeedAsset;
  try {
    const seedAssets = require("./seed-assets") as typeof import("./seed-assets");
    if (!seedAssets.hasSeedAssets()) {
      console.log("[db] seed-assets/ not found, 跳过 migrateInsertNewScenesV3");
      return;
    }
    copySeedAsset = seedAssets.copySeedAsset;
  } catch (err) {
    console.warn("[db] migrateInsertNewScenesV3 加载 seed-assets 失败:", err);
    return;
  }

  // 28 张：第 1 张是 .jpg（Scene (10).jpg 改名而来），其他 27 张是 .png
  // category 全标 null（未分类），用户后续在 admin 里改
  type NewSceneSeed = { file: string; name: string; sort_order: number };
  const NEW_SCENES: NewSceneSeed[] = Array.from({ length: 28 }, (_, i) => {
    const idx = i + 1;
    const ext = idx === 1 ? "jpg" : "png";
    return {
      file: `scenes/single/scene_new_${String(idx).padStart(2, "0")}.${ext}`,
      name: `新场景 ${String(idx).padStart(2, "0")}`,
      sort_order: 3000 + idx,
    };
  });

  let inserted = 0;
  const insert = db.prepare(
    `INSERT INTO scenes (name, image_path, tags, category, usage, sort_order)
     VALUES (@name, @image_path, NULL, NULL, 'single', @sort_order)`,
  );
  const exists = db.prepare(`SELECT id FROM scenes WHERE name = ?`);

  const tx = db.transaction(() => {
    for (const seed of NEW_SCENES) {
      if (exists.get(seed.name)) continue;
      try {
        const { relPath } = copySeedAsset(seed.file, "scenes");
        insert.run({
          name: seed.name,
          image_path: relPath,
          sort_order: seed.sort_order,
        });
        inserted += 1;
      } catch (err) {
        console.warn(
          `[db] migrateInsertNewScenesV3 拷贝失败 (${seed.file}):`,
          err,
        );
      }
    }

    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, notes) VALUES (?, 'done', ?)`,
    ).run(
      FLAG,
      `新主图场景 v3 补种（OpenAI Playground 生成的 28 张纯场景图 / 小场景 / 易摆姿势）`,
    );
  });
  tx();
  if (inserted > 0) {
    console.log(
      `[db] migrateInsertNewScenesV3: 补种 ${inserted} 张新场景（已标记 ${FLAG}=done）`,
    );
  }
}

/**
 * 文字场景预设 v1 种子（2026-05-12）
 *
 * 把 lib/text-scene-presets.ts 里硬编码的 28 条预设种进 text_scenes 表。
 * 之后 admin/scenes 的"新增文字场景" tab 可以继续往里加自定义条目。
 *
 * 按 name 幂等（UNIQUE 约束兜底）。FLAG=migrated_text_scenes_v1 防重复跑。
 */
function migrateSeedTextScenesV1(db: Database.Database) {
  const FLAG = "migrated_text_scenes_v1";
  const flag = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(FLAG) as { value: string } | undefined;
  if (flag?.value === "done") return;

  // 动态 import 避免循环依赖（text-scene-presets.ts 不依赖 db）
  let presets: Array<{
    name: string;
    text: string;
    group: string;
    thumb?: string;
  }>;
  try {
    const mod = require("./text-scene-presets") as {
      TEXT_SCENE_PRESETS: Array<{
        name: string;
        text: string;
        group: string;
        thumb?: string;
      }>;
    };
    presets = mod.TEXT_SCENE_PRESETS;
  } catch (err) {
    console.warn(
      "[db] migrateSeedTextScenesV1 加载 text-scene-presets 失败:",
      err,
    );
    return;
  }

  const insert = db.prepare(
    `INSERT OR IGNORE INTO text_scenes
       (name, group_name, text_prompt, thumb_path, sort_order)
     VALUES (@name, @group_name, @text_prompt, @thumb_path, @sort_order)`,
  );
  let inserted = 0;
  const tx = db.transaction(() => {
    presets.forEach((p, i) => {
      const result = insert.run({
        name: p.name,
        group_name: p.group,
        text_prompt: p.text,
        // thumb 字段 lib 那边是 /assets/uploads/scenes/scene_new_NN.{jpg|png}
        // 截掉前缀 /assets/ 存相对路径，跟 scenes 表 image_path 的约定一致
        thumb_path: p.thumb?.replace(/^\/assets\//, "") ?? null,
        sort_order: (i + 1) * 10,
      });
      if (result.changes > 0) inserted += 1;
    });
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, notes) VALUES (?, 'done', ?)`,
    ).run(
      FLAG,
      `文字场景预设 v1 种子（${presets.length} 条预设，新插 ${inserted} 条；其余已存在跳过）`,
    );
  });
  tx();
  console.log(
    `[db] migrateSeedTextScenesV1: 种 ${inserted}/${presets.length} 条文字场景预设（已标记 ${FLAG}=done）`,
  );
}

/**
 * 场景分类 v1 种子（2026-05-12）
 *
 * 把 lib/scene-categories.ts 的 6 个分类种进 scene_categories 表。
 * 之后 admin/scenes tab 4 能在 DB 里增删改。
 *
 * FLAG=migrated_scene_categories_v1，按 key 幂等。
 */
function migrateSeedSceneCategoriesV1(db: Database.Database) {
  const FLAG = "migrated_scene_categories_v1";
  const flag = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(FLAG) as { value: string } | undefined;
  if (flag?.value === "done") return;

  // 跟 lib/scene-categories.ts 的 SCENE_CATEGORY_ORDER + LABELS 对齐
  const SEED: Array<{ key_id: string; label: string; sort_order: number }> = [
    { key_id: "wedding", label: "婚礼", sort_order: 10 },
    { key_id: "outdoor", label: "户外", sort_order: 20 },
    { key_id: "studio", label: "影棚", sort_order: 30 },
    { key_id: "street", label: "街拍", sort_order: 40 },
    { key_id: "indoor", label: "室内", sort_order: 50 },
    { key_id: "garden", label: "花园", sort_order: 60 },
  ];

  let inserted = 0;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO scene_categories (key_id, label, sort_order)
     VALUES (@key_id, @label, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const s of SEED) {
      const r = insert.run(s);
      if (r.changes > 0) inserted += 1;
    }
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value, notes) VALUES (?, 'done', ?)`,
    ).run(
      FLAG,
      `场景分类 v1 种子（共 ${SEED.length} 条，新插 ${inserted} 条；其余已存在跳过）`,
    );
  });
  tx();
  console.log(
    `[db] migrateSeedSceneCategoriesV1: 种 ${inserted}/${SEED.length} 个分类（已标记 ${FLAG}=done）`,
  );
}