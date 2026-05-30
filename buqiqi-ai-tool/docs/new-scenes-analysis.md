# 新主图场景预设 · 分析 + 实施方案 + 素材网站关键词

> 看了 7 张代表性样张（Scene 1/4/7/10/12/13/15）。这些样张都是**带模特的成片**——所以"直接当场景"无法用，需要做"提取场景 / 去人"处理。

---

## 共性分析（7 张代表）

| 样张 | 主体场景 | 关键元素 | 调性 |
|---|---|---|---|
| Scene 1 | 木屋室内角落 | 暖木板墙 + 木椅 + 白瓷罐插花 | 田园生活感 |
| Scene 4 | 复古沙龙楼梯间 | 黑铁艺栏杆 + 油画墙 + 红地毯 + 蓝色印花地毯 | 端庄宫廷感 |
| Scene 7 | 地中海阳台 | 黄色灰泥外墙 + 拱廊 + 黑铁艺栏杆 + 瓷砖地 | 度假典雅 |
| Scene 10 | 古典走廊 | 拱形天花板 + 烛形吊灯 + 拱窗 + 米色大理石地 | 宫廷宏伟 |
| Scene 12 | 极简米色背景墙 | 拱形墙凹陷 + 暖米色 + 哑光地坪 | 极简棚拍 |
| Scene 13 | 摩洛哥风楼梯 | 黑铁艺栏杆 + 白墙 + 拱形深木门 + 石阶 | 南欧情调 |
| Scene 15 | 复古沙龙墙 | 米黄涂料墙 + 多幅油画 + 巴洛克金边镜 + 红玫瑰花瓶 + 壁炉烛台 | 复古典雅 |

**共性 5 条：**
1. 全是**生活化室内 / 半室外**（沒一张棚拍 + 灰色无趣背景）
2. 每张都有**具体可倚靠 / 互动的物件**（栏杆、木椅、墙角、楼梯、镜子、桌面）
3. 调性**偏欧式古典 / 地中海 / 复古**（不是现代极简风）
4. 光线**柔和自然**（窗光 / 室内漫射 / 暖光，无强直射）
5. 颜色**暖中性调**（米黄 / 暖白 / 浅木 / 哑光金）—— 适合搭配伴娘服 / 妈妈装的柔和色彩

**没有的（你之前的旧场景库有的）：**
- 现代极简棚拍纯色背景 → 已经被解除（用色值选择器替代）
- 强广角大全景柱廊 → 这次的样张取景都更紧凑
- 高对比强阳光晒过的户外婚礼草坪 → 没出现

---

## 实施方案对比

| 方案 | 描述 | 优点 | 缺点 | 难度 |
|---|---|---|---|---|
| **A · 文字 prompt 生成空场景图** | 把样张特征提取成文字 → 让 Gemini Pro Image 生成无人版本 → 入 scenes 库 | 完全可控、版权干净、可复用 | 生成的图未必和原图风格一致；样张越具体越难复刻 | 中 |
| **B · 直接 P 掉人入场景库** | 用 nano banana / GPT-image-2 的 edit 模式：上传样张 + prompt "remove the person, keep everything else" → 得到无人版入库 | 视觉调性最一致；快 | 可能 P 不干净（漏一只手 / 影子）；版权依赖样张来源 | 低-中 |
| **C · 样张作为风格参考不入库** | 出图时把样张作为 reference image 一起喂模型，加 prompt "use this image's atmosphere/lighting as inspiration, but don't include the person" | 不用预处理；每次都能精准 | 每次都要传额外图，调用 token 翻倍；样张里的人会"漏"进新图 | 低 |
| **D · 网上找类似的真正空场景** | 从素材网站找类似调性的**真无人**场景图 → 直接入库 | 最干净；版权清晰（用 free / paid stock） | 找图费时；不一定百分百匹配 | 中-高 |

---

## 我的推荐：B + D 组合

**B（P 人入库）**：先把这批样张 P 掉人，**最快得到一组高质量场景库**。具体执行：

1. 对每张样张跑一次 GPT-image-2 edit：
   ```
   Remove the woman from this photo. Reconstruct the background, floor, and any
   occluded scene elements naturally. Keep all architecture, furniture, lighting,
   color palette, and camera framing exactly as in the original. The final image
   should look like the same location photographed without a person, ready to
   composite a model into.
   ```
2. 检查结果，漏的地方手动 photoshop 补一下
3. 入 `seed-assets/scenes/single/` 命名 `scene_real_*.webp`

**D（素材网站找）**：去下面这些网站搜以下关键词，补充更多变化（避免 15 张场景看上去都是同款"古典欧式"）

---

## 素材网站搜索关键词（按调性分类）

### 复古欧式室内（Scene 1, 4, 13, 15 类）
- "vintage interior photography no people"
- "antique salon empty"
- "european manor staircase empty"
- "rococo interior wallpaper no person"
- "boutique hotel hallway oil paintings"
- "old world parlor velvet curtains"
- "english country house drawing room"

### 地中海 / 度假（Scene 7 类）
- "mediterranean balcony architecture"
- "tuscan villa courtyard empty"
- "spanish colonial archway"
- "santorini white stucco wall"
- "italian terrace iron railing"
- "moroccan riad courtyard"
- "andalusian patio tile floor"

### 极简棚拍 / 单色拱门（Scene 12 类）
- "minimal beige curved wall studio"
- "warm neutral plaster arch backdrop"
- "monochrome textured wall photo studio"
- "earthy tone seamless backdrop"
- "scandi minimal beige room"

### 木质田园 / 暖色生活感（Scene 1 类）
- "rustic wooden interior cottage"
- "farmhouse window light empty"
- "wooden cabin nook interior"
- "boho neutral room"
- "country kitchen window vase"

### 古典宫廷 / 拱廊（Scene 10 类）
- "neoclassical interior chandelier no people"
- "palace hallway arched ceiling empty"
- "marble hallway grand interior"
- "rococo gallery interior"
- "baroque corridor architecture"

### 通用关键词（任何调性都加）
- `no people` / `empty` / `no person` / `unoccupied`
- `wide angle` 或 `vertical` （根据需要）
- `natural light` / `soft daylight` （避免那种过曝度假 hdr）
- `interior design photography` （比 "stock photo" 出图质量更好）

### 推荐网站（按"无人场景 + 商用授权"优先级）
1. **Pexels** (https://pexels.com) — 免费 + 商用 + 大量真实室内场景
2. **Unsplash** (https://unsplash.com) — 同上
3. **Pixabay** (https://pixabay.com) — 免费 + 商用，质量略低
4. **Adobe Stock** — 付费，质量最高，有"empty room"专题
5. **小红书** — 关键词搜"室内空场景 / 复古沙龙空镜 / 拱形墙摄影背景" 找博主拍的更接地气
6. **Pinterest** — 拼图灵感板，找到喜欢的反查原始网站

---

## 工作流建议

**短期（1-2 天能跑完）：**
1. 你跑下面这个 GPT-image-2 P 人 prompt，把现有 7-15 张样张全跑一遍
2. 输出落到 `seed-assets/scenes/single/` 入库
3. 同时去 Pexels 关键词搜，挑 5-10 张补充

**P 人 prompt（直接复用）：**

```
Remove all people from this image. Reconstruct any background, floor, wall,
furniture, or other scene elements that were occluded by the person, blending
seamlessly with the surrounding architecture and lighting. Keep every other
visual element identical: same camera angle, framing, lighting, color
temperature, materials, decorations, and overall composition. The output
should look like the exact same location photographed without anyone in
frame, with no traces of the person (no shadows on floor, no missing wall
sections, no warped lines). Photorealistic, magazine-editorial quality.
```

**长期（持续 1-2 周）：**
- 用上面的关键词每天去 stock 网站找 3-5 张
- 累积 30-50 张多样化无人场景
- 按调性打 category 标签（生活田园 / 地中海 / 古典宫廷 / 极简棚拍 / 复古沙龙）

---

## 数据库映射建议

`scenes` 表 category 列可以扩展为：

| category 值 | 中文 | 适配品类 |
|---|---|---|
| `rustic` | 田园木质 | 伴娘服 / 毕业 |
| `mediterranean` | 地中海 | 晚会 / 度假 |
| `vintage` | 复古沙龙 | 妈妈装 / 晚会 |
| `neoclassical` | 古典宫廷 | 舞会 / 重要场合 |
| `minimal` | 极简棚拍 | 通用 |
| `boutique` | 精品店 | 通用 |

UI 层 admin 可以加按 category 筛选，用户在 batch-photo 选场景时也能按品类过滤。

---

## 我需要你回答的问题

1. **P 人方案要不要用 Image 2 跑**？（你账号 Tier 1，5 IPM，单张 ¥0.04-0.16，跑 15 张大概 ¥1-3，几分钟搞定）
2. **要不要我帮你写一个一次性脚本**，用 OpenAI API 批量跑 P 人？（参考 `scripts/regen-scenes.ts` 但改成 OpenAI）
3. **从样张提取场景"标签"**这件事现在做还是等你 stock 找完一起做？
