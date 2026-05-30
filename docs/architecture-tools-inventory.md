# buqiqi-ai-tool 工具架构盘点

> 用于规划 Gemini + Image 2 双模型并存方案的决策依据。
> 修改方法：在每个工具节点旁标注【Gemini】/【Image 2】/【两者并存】，决定后回到对话告诉 Claude 实施。

---

## A · 工具清单（树状图）

```
buqiqi-ai-tool（伴娘服 AI 批量图片工具）
│
├── 📦 用户工作流主线（user-facing）
│   │
│   ├── 🎨 /recolor · 换色
│   │   ├─ 输入：1 张产品图 + 目标颜色（HEX / 色卡）
│   │   ├─ 输出：1 张换色后的图
│   │   ├─ 流程：异步 job
│   │   ├─ 模型：gemini-3-pro-image-preview + 色卡 PNG
│   │   └─ 决策：________
│   │
│   └── 📸 /batch-photo · 批量摄影 ⭐ 主力工具
│       ├─ 输入：1-3 张产品图 + identity + N 个姿势 + 纯色背景 + ≤ 2 张额外场景
│       ├─ 输出：N 张纯色姿势 + M 张场景姿势（M ≤ 2）
│       ├─ 流程：异步 job + worker 并发
│       ├─ 模型：gemini-3-pro-image-preview · 4K · batch_seed 锁脸
│       └─ 决策：________（注：batch 一致性是 Image 2 的弱点，需测试）
│
├── 🛠️ /admin/scene-tools · 场景工具组（管理员专属）
│   │
│   ├── 🌅 background-swap · 背景换图
│   │   ├─ 输入：1 张原片 + 1 张 single 场景图 + mode
│   │   ├─ 输出：1 张换背景图
│   │   ├─ 模式：composition（推荐 / 重新合成）· edit（兜底 / 锁姿势）
│   │   ├─ 模型：gemini-3-pro-image-preview · 4K
│   │   └─ 决策：________
│   │
│   ├── 👥 poster · 氛围海报（多人 KV）
│   │   ├─ 输入：N 张原片（≤5）+ 1 张 poster 场景图 + composition
│   │   ├─ 输出：1 张海报 KV（hero / banner 用）
│   │   ├─ 模式：static（分区站位）· gathering（松散群组）
│   │   ├─ 模型：gemini-3-pro-image-preview · 4K
│   │   └─ 决策：________
│   │
│   ├── 📱 social-snap · 社媒图（phone-snap 风格）
│   │   ├─ 输入：N 张原片（≤3）+ 1 张场景图 + vibe
│   │   ├─ 输出：1 张手机抓拍感成片
│   │   ├─ vibe：casual · party · street · lifestyle
│   │   ├─ 模型：gemini-3-pro-image-preview
│   │   └─ 决策：________
│   │
│   ├── 🪞 replicate · 仿图（参考图驱动多人合成）
│   │   ├─ 步骤 1 - analyze
│   │   │   ├─ 输入：1 张参考图（多人合影）
│   │   │   ├─ 输出：JSON {count, models:[{label A-E, position, role, pose, view, framing}]}
│   │   │   └─ 模型：gemini-2.5-flash · vision · responseMimeType=application/json
│   │   ├─ 步骤 2 - compose
│   │   │   ├─ 输入：参考图 + N 张产品图（按编号 A/B/C/D/E 配对）
│   │   │   ├─ 输出：1 张合成（保留参考图场景 / 光线 / 构图，模特换成你的）
│   │   │   └─ 模型：gemini-3-pro-image-preview · 4K
│   │   ├─ 不锁姿势（让模型自由发挥更自然）
│   │   └─ 决策：analyze________  compose________
│   │
│   ├── ✍️ text-shoot · 文字模式（独立测试 · 刚做完）
│   │   ├─ 输入：1 张原片 + 文字场景描述（≤ 500 字）+ 可选 pose / hint
│   │   ├─ 输出：1 张氛围片（无 plate 约束，模型自由发挥）
│   │   ├─ 8 个预设场景（古典柱廊 / 巴洛克栏杆 / 意式石阶 / 拱窗白墙 / 热带花园 / 复古叶纹墙 / 黄昏石廊 / 湖边礁石）
│   │   ├─ 模型：gemini-3-pro-image-preview · 4K
│   │   └─ 决策：________（OpenAI 文档显示这是 Image 2 的强项场景）
│   │
│   └── 💡【拟新增】try-on · 虚拟试穿
│       ├─ 输入：1 张模特身体图 + N 张服装平铺图（白底）+ 可选场景描述
│       ├─ 输出：1 张模特穿着这些服装的成片
│       ├─ 价值：⭐ 不用每款新伴娘服都拍模特实穿原片，直接用电商平铺图就出图
│       ├─ 模型：必须 Image 2（gpt-image-2 多图 edit · 来自 5.2 Virtual Try-On 文档）
│       └─ 是否新增：________
│
├── 🧬 /admin/identity-generator · 形象生成
│   ├─ 输入：文字描述（人种 / 年龄 / 体型 / 五官 / 服饰偏好）
│   ├─ 输出：1 张模特身份图（透明 / 浅底）→ commit 进 identity 库
│   ├─ 流程：generate（temp）+ commit（入库）两步
│   ├─ 模型：gemini-3-pro-image-preview
│   └─ 决策：________
│
├── 📋 /history · 任务历史
│   └─ 7 类 feature tab：recolor · batch_photo · background_swap · poster · social_snap · replicate · text_shoot
│       └─ 每条 job 显示：缩略图 / 模型 / 配置 / 状态 / 耗时 / 成本
│
└── ⚙️ /admin · 管理后台
    ├─ /admin/scenes · 场景库（usage=single|poster · 25 张 + 用户自传）
    ├─ /admin/identities · 模特库
    ├─ /admin/poses · 姿势库
    ├─ /admin/expressions · 表情库
    ├─ /admin/materials · 材质库
    ├─ /admin/photography · 摄影参数预设
    ├─ /admin/realism · 真实感预设
    ├─ /admin/colors · 颜色库
    ├─ /admin/prompts · Prompt 模板（kind='on_model'）
    ├─ /admin/ai-models · 模型注册（白名单）
    ├─ /admin/model-prices · 单价 / 汇率
    ├─ /admin/users · 用户管理
    ├─ /admin/billing · 团队账单
    ├─ /admin/announcements · 公告
    └─ /admin/settings · 系统设置（AI Provider 切换 / Gemini API key 等）
```

---

## B · 当前模型分布

```
gemini-3-pro-image-preview · 4K ─┬─ 换色
                                 ├─ 批量摄影（solid + scene）
                                 ├─ 形象生成
                                 ├─ 背景换图
                                 ├─ 氛围海报
                                 ├─ 社媒图
                                 ├─ 仿图（compose 步骤）
                                 └─ 文字模式

gemini-2.5-flash · vision JSON ──┬─ 批量摄影款式解析
                                 └─ 仿图 analyze 步骤
```

---

## C · 各工具与 Image 2 适配评估表

| 工具 | 真实感（Image 2 优势）| 一致性（Gemini 优势）| 多图输入需求 | 4K 需求 | Image 2 适配度 |
|---|---|---|---|---|---|
| 换色 | 中 | 高（色精度）| 产品+色卡 | 高 | 低（Gemini 更稳）|
| 批量摄影 · solid | 高 | **关键**（同模特 N 张）| 产品+identity | 高 | 待测一致性 |
| 批量摄影 · scene | 高 | **关键** | 产品+identity | 高 | 待测一致性 |
| 形象生成 | 高 | / | 0 张（纯文字）| 高 | 高 |
| 背景换图 | **高** | / | 原片+场景 | 高 | **高** |
| 氛围海报 | 中 | 多模特一致性差 | 多原片+场景 | 高 | 中-低 |
| 社媒图 | 高 | 中 | 多原片+场景 | / | 高 |
| 仿图 analyze | / | / | 1 张参考图 | / | 低（Gemini Flash JSON 已经稳）|
| 仿图 compose | **高** | 中 | 参考图+多产品图 | 高 | **高**（Image 2 multi-image 强项）|
| 文字模式 | **高** | / | 1 张原片 | 高 | **王者场景** |
| 【新】Try-On | **高** | / | 模特+多平铺图 | 高 | **只有 Image 2 能做** |

---

## D · 价格对比

| 尺寸 / 质量 | gpt-image-2（USD）| gpt-image-2（CNY ≈ ×7.1）| Gemini Pro 4K |
|---|---|---|---|
| 1024×1536 High | $0.165 | ¥1.18 | ¥1.7 |
| 1024×1536 Medium | $0.041 | ¥0.29 | / |
| 1024×1536 Low | $0.005 | ¥0.04 | / |
| 1024×1024 High | $0.211 | ¥1.50 | / |
| 4K（3840×2160）| 较高 | 估 ¥2-3 | ¥1.7（自适应） |

**典型场景成本：**
- 批量摄影 N=8 姿势纯色 + 2 场景：
  - Gemini：10 × ¥1.7 = ¥17
  - Image 2 Medium 纯色 + High 场景：8 × ¥0.29 + 2 × ¥1.18 ≈ ¥4.68
  - **节省约 70%**
- 单张氛围片（背景换图 / 文字模式 / 海报）：
  - Gemini：¥1.7
  - Image 2 High 1024×1536：¥1.18
  - **节省约 30%**

---

## E · 后端层级架构

```
app/<tool>/page.tsx                        ← UI（React）
  └─ POST formData / fetch
app/api/<tool>/route.ts                    ← API 入口
  ├─ requireAdmin / requireUser            ← 鉴权
  ├─ assertWithinBudget                    ← 预算闸
  ├─ formData parse + validate
  ├─ DB lookups（identities / scenes / poses / templates）
  ├─ buildXxxPrompt()                      ← lib/scene-tools-prompt.ts 或 lib/identity-prompt.ts
  ├─ generateImage(inputs, prompt, model, options)
  │     └─ lib/gemini-image.ts             ← 当前唯一出图 wrapper
  │           └─ lib/genai-client.ts       ← provider 切换（vertex / gemini_api）
  ├─ writeFile 落盘到 DATA_DIR/outputs/
  ├─ recordUsage()                         ← lib/usage.ts
  └─ recordSingleShotJob() 或 createJob + startJobWorker
        └─ lib/jobs-db.ts                  ← render_jobs / render_job_items
```

**异步 job 走另一条路线（batch_photo / recolor）：**

```
createJob → render_job_items（一行一个 item）
startJobWorker → 后台并发处理每个 item → 调 generateImage → 写产物
GET /api/jobs/:id 轮询进度
```

---

## F · 关键 Library 一览

| 模块 | 作用 | 是否需改 |
|---|---|---|
| `lib/db.ts` | SQLite 主库 + 各表 schema + seed + migration | 加 ai_models.provider 列 |
| `lib/genai-client.ts` | 构造 GoogleGenAI 实例，按 settings 切 provider | 加 openai 第三种 |
| `lib/gemini-image.ts` | `generateImage()` 出图 + `buildRecolorPrompt()` | 拆成 `lib/image-gen.ts` 统一入口 |
| `lib/openai-image.ts` | **新建**，包装 OpenAI images.edit / images.generate | 新建 |
| `lib/gemini.ts` | `analyzeGarment()` vision 解析 | 不动 |
| `lib/scene-tools-prompt.ts` | 5 个 scene-tools 的 prompt builder | 部分 builder 加 OpenAI 风格变体 |
| `lib/identity-prompt.ts` | identity 生成 prompt | 视情况加变体 |
| `lib/ai-models.ts` | model_id 白名单校验 | 加 gpt-image-2 注册 |
| `lib/materials.ts` | 材质 / 真实感预设 | 不动 |
| `lib/pricing.ts` | 单价计算 + 预算闸 | 加 gpt-image-2 计价（按 size×quality）|
| `lib/jobs-db.ts` | render_jobs / render_job_items | 不动 |
| `lib/usage.ts` | 计费日志 | 不动 |

---

## G · 数据库主要表

```
users / sessions               账号
identities (kind='identity')   模特形象库
scenes (usage='single'|'poster')  场景库
poses                          姿势库
expressions                    表情库
photography_params             摄影参数预设
realism_presets                真实感预设
materials                      材质库
prompt_templates               批量摄影模板
ai_models                      模型注册（拟加 provider 列）
model_prices                   单价（按 model_id 分单价规则）
settings (key/value)           系统设置（含 ai_provider / gemini_api_key / 拟加 openai_api_key）
render_jobs / render_job_items 任务历史
generations / usage_log        计费日志
```

---

## H · 当前 Gemini 全局假设的 6 个耦合点

如果要让 Image 2 并存，下列地方需要"开口子"：

1. `lib/gemini-image.ts` `generateImage()` 的 `options` 是 Gemini 专属（`thinkingConfig` / `seed` / `imageConfig.imageSize='4K'`）。OpenAI 不支持 seed，size 用具体像素数表示
2. `lib/genai-client.ts` 只识别 vertex / gemini_api，要加 openai 第三种
3. `ai_models` 表没有 `provider` 列
4. `model_prices` 计费模型是 token-based；OpenAI gpt-image-2 是按 size × quality 固定价
5. 各 prompt builder 风格（重型 emoji 大段）适合 Gemini，OpenAI 文档建议简洁声明式
6. 出图回包：Gemini 走 `response.candidates[].content.parts[].inlineData`，OpenAI 走 `result.data[0].b64_json`

---

## I · 并存架构的两种实现思路

### 思路 1 · 每个工具固定模型
- 比如：换色固定 Gemini，文字模式固定 Image 2，背景换图允许选
- 实现：每个 route.ts 写死调谁；`lib/openai-image.ts` 单独建一个 wrapper
- 优点：简单，零选择压力
- 缺点：用户没法 A/B 同一工具的两边效果

### 思路 2 · 全工具加 provider 选项
- 每个工具 UI 加一个"模型"下拉（gemini-pro-image / gpt-image-2-high / gpt-image-2-medium）
- 后端 `generateImage(...)` 根据 model_id 内部分发到 Gemini 或 OpenAI 实现
- 实现：`lib/image-gen.ts` 做统一入口，按 model_id 前缀路由（`gpt-image-*` → OpenAI；`gemini-*` → Gemini）；`ai_models` 表加 `provider` 列
- 优点：未来再加新 provider 也很容易；用户可以在同一工具里 A/B
- 缺点：每个 UI 多个选项；prompt builder 可能要写两套（Gemini 风格 + OpenAI 风格）

---

## J · 我的待决策清单（请填）

- [ ] 整体并存架构走【思路 1】还是【思路 2】？
- [ ] OpenAI API key 准备情况：______
- [ ] 哪些工具迁到 Image 2（按 A 节中标注的决策）：______
- [ ] 是否新增 Try-On 工具：______
- [ ] 第一阶段实施范围（最小试错）：______
- [ ] 价格预算闸是否要分模型设置（避免误用 High 把预算烧光）：______
