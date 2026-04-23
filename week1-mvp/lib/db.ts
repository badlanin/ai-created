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
  seedPoses(db);
  seedPhotographyParams(db);
  seedPromptTemplates(db);
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

export const DATA_DIR_PATH = DATA_DIR;
