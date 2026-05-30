/**
 * 一次性修补脚本：
 *   - poses 表加 is_hero 列
 *   - 创建 expressions 表
 *   - seed 6 条表情、5 条 hero 姿势
 *   - 清洗旧 pose 文本里的表情/眼神残留词
 *   - 在"标准模特穿着图"模板里注入 {{expression}} 占位符
 *
 * 使用：
 *   1. git pull 拉到 VM
 *   2. docker cp scripts/fix-pose-expressions.js buqiqi-app:/tmp/fix.js
 *   3. docker compose exec app node /tmp/fix.js
 *
 * 全部操作幂等——重复跑不会出错。
 */

const Database = require("better-sqlite3");
const db = new Database("/app/data/app.db");

// 1. poses.is_hero 列
try {
  db.exec("ALTER TABLE poses ADD COLUMN is_hero INTEGER NOT NULL DEFAULT 0");
  console.log("+ poses.is_hero 列已添加");
} catch (e) {
  console.log("= poses.is_hero:", e.message);
}

// 2. expressions 表
db.exec(`CREATE TABLE IF NOT EXISTS expressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by INTEGER REFERENCES users(id)
)`);
db.exec("CREATE INDEX IF NOT EXISTS idx_expressions_sort ON expressions(sort_order)");
db.exec("CREATE INDEX IF NOT EXISTS idx_poses_hero ON poses(is_hero, sort_order)");
console.log("+ expressions 表 / 索引已确保");

// 3. seed 6 条表情
const exprs = [
  ["自然平静", "嘴角放松微抿，眼神平和直视镜头，无明显笑意，气质沉静", 0, 10],
  ["温柔微笑", "嘴角自然上扬呈柔和弧度，眼角带轻微笑意，整体温柔亲和", 1, 20],
  ["自信凝视", "下巴微抬，眼神坚定锁定镜头，嘴线略紧，传递自信气场", 0, 30],
  ["灿烂笑容", "牙齿轻露，眼睛弯成月牙，眉眼舒展，传递明朗喜悦", 0, 40],
  ["远眺侧目", "目光看向镜头侧前方约 15 度，嘴唇放松微抿，营造故事感和距离感", 0, 50],
  ["静谧专注", "眼睑微垂或半闭，沉浸于自身世界，嘴线放松，传递宁静专注", 0, 60],
];
const exprStmt = db.prepare(
  "INSERT OR IGNORE INTO expressions (name, text, is_default, sort_order) VALUES (?, ?, ?, ?)",
);
for (const e of exprs) exprStmt.run(...e);
console.log("+ 6 条 expressions 已确保");

// 4. seed 5 条 hero 姿势
const heroes = [
  [
    "首图 · 自然站姿",
    "模特正对镜头，重心微落在右腿，左腿自然前迈半步形成对立平衡（contrapposto）。左手轻搭在裙摆侧面指尖微弯，右臂自然垂下。微微抬下巴。",
    "首图,正面,灵动",
    1,
  ],
  [
    "首图 · 一脚前迈轻扶裙",
    "模特正对镜头，左脚向前轻迈半步，重心在后腿。左手轻提裙摆侧面让层次展开，右手自然垂下指尖微弯。头微侧。",
    "首图,正面,扶裙",
    2,
  ],
  [
    "首图 · 半侧身露肩",
    "模特身体 30 度侧对镜头，重心放在后腿，前腿自然点地。近镜头肩膀微微下沉，远端肩微抬，凸显锁骨颈部线条。头部回正，一手自然下垂，一手轻搭腰部。",
    "首图,侧身,肩颈",
    3,
  ],
  [
    "首图 · 抚发瞬间",
    "模特正对镜头，重心微落在一腿。一手抬起指尖轻拨耳后头发，营造抓拍的瞬间感，另一手垂在身侧。面部正对镜头。",
    "首图,抓拍,抚发",
    4,
  ],
  [
    "首图 · 欲走未走",
    '模特正面，身体正直但有"走来"的微动态——一脚刚踏地，另一脚趾点地准备前迈，裙摆在脚踝处有轻微飘动感。双手前后自然摆动呈走动节奏。',
    "首图,动态,走来",
    5,
  ],
];
const ck = db.prepare("SELECT id FROM poses WHERE name = ?");
const insHero = db.prepare(
  "INSERT INTO poses (name, text, type, tags, is_hero, sort_order) VALUES (?, ?, 'full', ?, 1, ?)",
);
const updHero = db.prepare(
  "UPDATE poses SET is_hero = 1, text = ?, tags = ? WHERE id = ?",
);
let added = 0;
let updated = 0;
for (const h of heroes) {
  const ex = ck.get(h[0]);
  if (ex) {
    updHero.run(h[1], h[2], ex.id);
    updated++;
  } else {
    insHero.run(...h);
    added++;
  }
}
console.log(`+ hero poses: 新增 ${added} / 更新 ${updated}`);

// 5. 清洗旧 pose 文本里的表情/眼神残留词
const cleanups = [
  [
    "站立正面",
    "，表情自然平静",
    "模特正对镜头直立，双脚与肩同宽，双手自然下垂",
  ],
  [
    "站立 45 度侧身",
    "，目光看向镜头",
    "模特 45 度侧身对镜头，身体微微倾斜，展示服装的侧面轮廓",
  ],
  [
    "走动瞬间",
    "，表情自然",
    "模特自然向前走动，一条腿微微抬起向前迈步，长发和裙摆随动作轻轻飘动",
  ],
  [
    "回眸",
    "，嘴角浅笑",
    "模特背对镜头站立，上半身回身，透过肩膀向后看向镜头",
  ],
  [
    "胸部以上正面",
    "，表情温柔",
    "半身构图，模特正面胸部以上入镜，展示领口、面部和发型",
  ],
];
let cleaned = 0;
for (const c of cleanups) {
  const r = db
    .prepare("UPDATE poses SET text = ? WHERE name = ? AND text LIKE ?")
    .run(c[2], c[0], "%" + c[1] + "%");
  if (r.changes > 0) cleaned++;
}
console.log(`+ 清洗 ${cleaned} 条 pose 文本`);

// 6. prompt 模板注入 {{expression}}
const tpl = db
  .prepare(
    "SELECT id, template FROM prompt_templates WHERE kind = 'on_model' AND name = ?",
  )
  .get("标准模特穿着图");
if (tpl && !tpl.template.includes("{{expression}}")) {
  const before = "{{pose}}\n\n{{photography_params}}";
  const after =
    "{{pose}}\n\n【面部表情 / Expression（适用于所有姿势）】\n{{expression}}\n\n{{photography_params}}";
  if (tpl.template.includes(before)) {
    db.prepare("UPDATE prompt_templates SET template = ? WHERE id = ?").run(
      tpl.template.replace(before, after),
      tpl.id,
    );
    console.log(`+ 模板 #${tpl.id} 已注入 {{expression}}`);
  } else {
    console.log(`! 模板 #${tpl.id} 找不到 {{pose}}/{{photography_params}} 锚点，跳过`);
  }
} else {
  console.log("= 模板已含 {{expression}} 或不存在");
}

// 7. 最终状态
console.log("\n=== 完成 ===");
const cols = db
  .prepare("PRAGMA table_info(poses)")
  .all()
  .map((c) => c.name)
  .join(",");
console.log("poses cols:", cols);
console.log(
  "hero poses:",
  db.prepare("SELECT COUNT(*) AS c FROM poses WHERE is_hero = 1").get().c,
);
console.log(
  "expressions:",
  db.prepare("SELECT COUNT(*) AS c FROM expressions").get().c,
);
const def = db.prepare("SELECT name FROM expressions WHERE is_default = 1").get();
console.log("default expr:", def?.name || "(none)");
