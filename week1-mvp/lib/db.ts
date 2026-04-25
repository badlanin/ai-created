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

    -- ==========================================
    -- M2: 姿势库（纯文字）
    -- ==========================================
    CREATE TABLE IF NOT EXISTS poses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,               -- 如 "站立正面"
      text       TEXT NOT NULL,               -- 完整描述，会注入 prompt
      type       TEXT NOT NULL DEFAULT 'full', -- 'full'(全身)|'half'(半身)|'closeup'(特写)
      tags       TEXT,                         -- 逗号分隔
      notes      TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_poses_type ON poses(type, sort_order);

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
  // 新增索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_models_category ON models(kind, category, sort_order);
    CREATE INDEX IF NOT EXISTS idx_colors_group ON colors(color_group, sort_order);
  `);

  // 启动时恢复：把被进程重启打断的 item 标为 failed
  recoverOrphanJobs(db);

  seedAiModels(db);
  seedPoses(db);
  seedPhotographyParams(db);
  seedPromptTemplates(db);
  seedRealismPresets(db);
  seedMaterials(db);
  seedModelPrices(db);
  seedSettings(db);
  // 新实例预设：色卡 + 模特图 + 场景图（来自 seed-assets/）
  seedColors(db);
  seedIdentitiesFromAssets(db);
  seedScenesFromAssets(db);
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
    sort_order: number;
  }> = [
    // --- 全身 ---
    {
      name: "站立正面",
      text: "模特正对镜头直立，双脚与肩同宽，双手自然下垂，表情自然平静",
      type: "full",
      tags: "正面,直立,经典",
      sort_order: 10,
    },
    {
      name: "站立 45 度侧身",
      text: "模特 45 度侧身对镜头，身体微微倾斜，展示服装的侧面轮廓，目光看向镜头",
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
      text: "模特自然向前走动，一条腿微微抬起向前迈步，长发和裙摆随动作轻轻飘动，表情自然",
      type: "full",
      tags: "动态,走动,飘逸",
      sort_order: 40,
    },
    {
      name: "回眸",
      text: "模特背对镜头站立，上半身回身，透过肩膀向后看向镜头，嘴角浅笑",
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
    // --- 半身 ---
    {
      name: "胸部以上正面",
      text: "半身构图，模特正面胸部以上入镜，展示领口、面部和发型，表情温柔",
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
    `INSERT INTO poses (name, text, type, tags, sort_order)
     VALUES (@name, @text, @type, @tags, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const p of poses) stmt.run(p);
  });
  tx();
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
      notes: "最通用的模板，适合日常商品图批量生成",
      template: `你是一位专业的服装电商摄影师。请根据我提供的参考图和指令，生成 {{n}} 张高质量的服装模特摄影图。

【参考图说明】
- 参考图 1-2：产品服装（正面 + 背面），这是要让模特穿着的衣服
- 参考图 3：模特形象（透明背景 PNG），这就是要出现在最终图里的模特本人
- 参考图 4：场景背景，这是最终图的背景环境

【款式信息】
{{garment_attrs}}

【任务】
请让参考图 3 里的这位模特，穿着参考图 1-2 里的服装，在参考图 4 的场景中，按以下不同姿势拍摄 {{n}} 张图，每张图对应一个姿势：

{{pose}}

{{photography_params}}

【一致性约束（非常重要）】
- 每张输出图都必须只包含 1 个人（就是参考图 3 里的那位模特）
- 所有 {{n}} 张图里的模特必须是同一个人：同样的脸型、肤色、发型、眼睛和体型
- 所有图里的服装必须和参考图 1-2 完全一致：颜色、面料、版型、长度、领口、袖型、装饰（蕾丝/珠片/刺绣/褶皱/蝴蝶结等）都不能改
- 所有图的场景、光线氛围、色调必须保持一致（参考图 4 的风格）
- 只有姿势和构图可以不同

【禁止事项】
- 不要在图里添加其他人物、模特、路人
- 不要添加水印、logo、文字、图章
- 不要改变服装的颜色或纹理
- 不要改变模特的脸部特征

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

【质量要求】
- 所有图里人物、服装、场景必须高度一致
- 每张图只有 1 位模特，面容和身材固定
- 服装颜色、面料、每一处装饰（珠片/蕾丝/刺绣/褶皱）都与原图完全相同
- 如果是特写镜头，面料纹理、针脚、光泽要清晰可见

【禁止】多人物、替换模特、修改服装、水印、文字、logo

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

【禁止事项】
- 不要在图里画出假人模特（已被真人替换）
- 不要添加其他人物、路人、第二个模特
- 不要添加水印、logo、文字、图章、品牌标识
- 不要改变背景颜色 / 光线方向 / 相机角度
- 不要改变服装的颜色或纹理
- 不要改变模特的脸部特征
- 不要在不同图之间改变背景的任何细节

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
      texture_rules: "经纬线纹理规整清晰，表面平整",
      dont_confuse_with: "不要画成针织的弹性线圈结构；不要画得有光泽感",
      sort_order: 100,
    },
    {
      name: "针织",
      english_name: "knit",
      aliases: "针织,knit,knitted,jersey",
      description: "线圈编织结构的面料，有弹性",
      visual_traits:
        "表面可见线圈结构（stitches）、凹凸立体感、有自然弹性、垂顺贴身、温暖感",
      light_behavior: "漫反射；线圈结构产生细密的规律性光影图案",
      texture_rules: "可见线圈的凹凸感；表面有肌理颗粒感",
      dont_confuse_with: "不要画成平滑的梭织（必须有立体线圈）；不要画得像粗糙毛衣",
      sort_order: 110,
    },
    {
      name: "亮片",
      english_name: "sequin",
      aliases: "亮片,sequin,sequined,glitter",
      description: "缀满亮片的装饰面料",
      visual_traits:
        "缀满反光亮片（细碎或整片覆盖）、闪烁感强、每个亮片独立反光、奢华晚礼服感",
      light_behavior:
        "每个亮片独立镜面反光；角度不同呈现闪烁变化；在光源下形成大量高光点",
      texture_rules: "亮片大小应符合实际（不要大到不合比例）；排列可规整或随机",
      dont_confuse_with:
        "不要画成连续的光泽面料（必须是离散的亮片）；不要过度夸张失真",
      sort_order: 120,
    },
  ];

  const stmt = db.prepare(
    `INSERT INTO materials
       (name, english_name, aliases, description, visual_traits, light_behavior, texture_rules, dont_confuse_with, sort_order)
     VALUES (@name, @english_name, @aliases, @description, @visual_traits, @light_behavior, @texture_rules, @dont_confuse_with, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const m of materials) stmt.run(m);
  });
  tx();
}

/**
 * 种子模型单价（Google 标准档位）
 * 数据来源：2026-04 官方 + 用户实测的 token 计数反算
 */
function seedModelPrices(db: Database.Database) {
  const prices: Array<{
    model_id: string;
    input_per_1m_usd: number;
    output_per_1m_usd: number;
    tier: string;
    notes: string;
  }> = [
    // 纯文本模型（Vision 解析用）
    {
      model_id: "gemini-2.5-flash",
      input_per_1m_usd: 0.15,
      output_per_1m_usd: 0.6,
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

    // 图像生成模型（图片输出按 token 计，费率高）
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
 * 种子全局配置
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
  sort_order: number;
}

/**
 * 种子色卡（50 个，按色系分组）
 *
 * 数据来源：seed-assets/colors.json（由 预设/色卡.xlsx 编译）
 * 仅在 colors 表为空时执行，不会覆盖管理员后续添加的颜色
 */
function seedColors(db: Database.Database) {
  const exists = db.prepare(`SELECT COUNT(*) AS c FROM colors`).get() as {
    c: number;
  };
  if (exists.c > 0) return;

  let colors: SeedColorEntry[];
  try {
    // 延迟 import 避免在没有 seed-assets 时影响其他 seed
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
 *
 * 步骤：
 *   1. 表为空才跑
 *   2. 读 manifest.json
 *   3. 把每张图从 seed-assets/ 复制到 data/uploads/identities/
 *   4. INSERT 一行 models（kind='identity'）
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

  // 1) 先把图复制好，记下每条对应的 image_path
  const prepared: Array<SeedIdentityEntry & { image_path: string }> = [];
  for (const e of entries) {
    try {
      const { relPath } = copySeedAsset(e.file, "identities");
      prepared.push({ ...e, image_path: relPath });
    } catch (err) {
      console.warn(`[db] 模特图复制失败 (${e.file}):`, err);
    }
  }

  // 2) 一次性写库
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
    `INSERT INTO scenes (name, image_path, tags, sort_order)
     VALUES (@name, @image_path, @tags, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const p of prepared) {
      stmt.run({
        name: p.name,
        image_path: p.image_path,
        tags: p.tags || null,
        sort_order: p.sort_order,
      });
    }
  });
  tx();
  console.log(`[db] seedScenesFromAssets: 写入 ${prepared.length} 张场景图`);
}
