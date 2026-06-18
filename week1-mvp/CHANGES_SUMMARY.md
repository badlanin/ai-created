# 产品上架统计功能改动总结

## 改动日期
2026-06-18

## 改动内容

### 1. 移除草稿按钮（保留上架按钮）
**文件**: `app/product-listing/page.tsx`

**改动**:
- ✅ 移除了"保存草稿"按钮
- ✅ 保留了"上架"按钮（独占整行，更醒目）
- ✅ 删除了 `onSaveDraft` 相关代码

**影响**: 用户现在只能直接上架产品，无法保存为草稿状态

---

### 2. 新增上架统计表
**文件**: `lib/db.ts`

**新增表结构**:
```sql
CREATE TABLE shopify_upload_stats (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  source_type     TEXT NOT NULL,  -- 'url_capture' | 'ai_generated' | 'local_upload'
  product_count   INTEGER NOT NULL DEFAULT 1,
  shopify_product_id TEXT,
  status          TEXT NOT NULL DEFAULT 'success',
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_upload_stats_user_source 
  ON shopify_upload_stats(user_id, source_type, created_at DESC);
```

**作用**: 专门记录产品上架动作，与历史记录表独立

---

### 3. 上架时自动记录统计
**文件**: `lib/shopify.ts`

**新增功能**:

1. **来源推断函数** `inferProductSourceType()`:
   - 根据产品 tags 判断（如 url_capture、1688、ai_generated）
   - 根据变体数量判断（>=5个变体 → AI生成）
   - 默认为本地上传

2. **上架统计记录**:
   - 在 `syncShopifyProduct()` 函数成功后自动记录
   - 使用独立 try-catch，统计失败不影响上架
   - 记录内容：用户ID、来源类型、产品ID、状态

```typescript
// 伪代码
try {
  const sourceType = inferProductSourceType(input);
  db.prepare(`INSERT INTO shopify_upload_stats ...`).run(...);
} catch (err) {
  console.warn('统计记录失败（不影响上架）:', err);
}
```

---

### 4. 统计API增强
**文件**: `app/api/admin/product-stats/route.ts`

**新增查询**:
```typescript
// 按来源类型汇总
uploadStats: [
  { source_type: 'url_capture', upload_count: 50, total_products: 50 },
  { source_type: 'ai_generated', upload_count: 30, total_products: 30 },
  { source_type: 'local_upload', upload_count: 20, total_products: 20 }
]

// 按天按来源统计
uploadByDay: [
  { day: '2026-06-18', source_type: 'url_capture', upload_count: 10 },
  { day: '2026-06-18', source_type: 'ai_generated', upload_count: 5 }
]
```

---

## 数据流向

```
┌─────────────────────────────────────────┐
│  历史记录表（保持原有用途）               │
├─────────────────────────────────────────┤
│ url_capture_jobs    → 抓取过程记录       │
│ render_jobs         → AI生成过程记录     │
│ generations         → 所有生成历史       │
└─────────────────────────────────────────┘
                   ↓
         点击"上架到Shopify"按钮
                   ↓
┌─────────────────────────────────────────┐
│  shopify_upload_stats（上架统计专用表）  │
├─────────────────────────────────────────┤
│ 记录：来源类型 + 上架时间 + 产品数量     │
│ 用途：统计最终上架数量                   │
└─────────────────────────────────────────┘
```

---

## 使用方式

### 前端调用统计API
```typescript
const response = await fetch('/api/admin/product-stats?start=2026-06-01&end=2026-06-30');
const data = await response.json();

console.log('上架统计:', data.uploadStats);
// [
//   { source_type: 'url_capture', upload_count: 123 },
//   { source_type: 'ai_generated', upload_count: 456 },
//   { source_type: 'local_upload', upload_count: 789 }
// ]
```

### 显示统计卡片
```tsx
<Card title="URL抓取上架">{data.uploadStats.find(s => s.source_type === 'url_capture')?.upload_count || 0}</Card>
<Card title="AI处理上架">{data.uploadStats.find(s => s.source_type === 'ai_generated')?.upload_count || 0}</Card>
<Card title="本地上传上架">{data.uploadStats.find(s => s.source_type === 'local_upload')?.upload_count || 0}</Card>
```

---

## 来源判断规则

### 1. URL抓取 (url_capture)
- 产品 tags 包含: `url_capture`、`1688`、`淘宝`

### 2. AI处理 (ai_generated)
- 产品 tags 包含: `ai_generated`、`批量摄影`、`ai换色`
- **或** 产品变体数量 >= 5 个

### 3. 本地上传 (local_upload)
- 以上条件都不满足时的默认值

---

## 改进建议（可选）

### 未来可以在产品上架时明确传递来源标记：
```typescript
// 在产品上架页面添加隐藏字段
const productData = {
  ...otherFields,
  tags: existingTags + ', source:url_capture'  // 明确标记来源
}
```

### 或者在URL抓取/AI生成时自动打标签：
```typescript
// url-captures/route.ts
const job = {
  ...jobData,
  // 保存时给产品添加来源标记
  defaultTags: 'url_capture'
}
```

---

## 测试方法

### 1. 测试统计记录
```bash
# 上架一个产品后查询数据库
sqlite3 /app/data/app.db
> SELECT * FROM shopify_upload_stats ORDER BY created_at DESC LIMIT 10;
```

### 2. 测试API
```bash
curl "http://localhost:3000/api/admin/product-stats?start=2026-06-01&end=2026-06-30"
```

### 3. 测试来源推断
- 上架一个有5个以上变体的产品 → 应该记录为 `ai_generated`
- 上架一个tags包含"1688"的产品 → 应该记录为 `url_capture`
- 上架一个普通产品 → 应该记录为 `local_upload`

---

## 回滚方案

如果需要回滚，只需：

1. **删除统计表**（不影响其他功能）:
```sql
DROP TABLE IF EXISTS shopify_upload_stats;
```

2. **移除统计记录代码**（lib/shopify.ts 第2833-2844行）

3. **移除API返回字段**（app/api/admin/product-stats/route.ts）

---

## 总结

✅ **完成内容**:
1. 移除草稿按钮，保留上架按钮
2. 新增独立的上架统计表
3. 上架时自动记录来源类型
4. 统计API增强，支持按来源查询

✅ **不影响**:
- 历史记录功能（完全独立）
- 现有上架流程（只是额外记录）
- 子账户查看功能（查询表不同）

✅ **代码量**:
- 总计约 130 行新增代码
- 0 行删除原有功能代码（只删除了草稿按钮）
- 改动风险极低
