"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, Save, ArrowLeft, ExternalLink, Upload, X } from "lucide-react";
import { Dropzone } from "@/app/_components/ui";

type AiModel = {
  id: number;
  model_id: string;
  label: string;
  description: string | null;
  badge: string | null;
  is_default: 0 | 1;
};

/* ─────────────────────────────────────────────────────────
 *  类型与选项 — 跟 lib/identity-prompt.ts 对齐
 *  这里前端用纯字符串，提交时由后端类型守卫校验
 * ───────────────────────────────────────────────────────── */

type IdentityParams = {
  ethnicity: string;
  age: string;
  hairColor: string;
  hairStyle: string;
  bodyShape: string;
};

const ETHNICITY_OPTIONS = [
  { value: "east-asian", label: "东亚（中日韩）" },
  { value: "southeast-asian", label: "东南亚" },
  { value: "south-asian", label: "南亚（印度等）" },
  { value: "european-fair", label: "北欧 / 西欧（白皙）" },
  { value: "european-mediterranean", label: "南欧（地中海橄榄色）" },
  { value: "african", label: "非裔" },
  { value: "latin-american", label: "拉美" },
  { value: "middle-eastern", label: "中东" },
  { value: "mixed", label: "混血" },
];

const AGE_OPTIONS = [
  { value: "20-25", label: "20-25 岁" },
  { value: "25-30", label: "25-30 岁" },
  { value: "30-35", label: "30-35 岁" },
  { value: "35-40", label: "35-40 岁" },
];

const HAIR_COLOR_OPTIONS = [
  { value: "black", label: "黑色" },
  { value: "dark-brown", label: "深栗棕" },
  { value: "brown", label: "中棕" },
  { value: "blonde-light", label: "浅金" },
  { value: "blonde-medium", label: "蜂蜜金" },
  { value: "red", label: "红棕" },
  { value: "gray-silver", label: "灰白" },
];

const HAIR_STYLE_OPTIONS = [
  { value: "long-straight", label: "长直发（中背长）" },
  { value: "long-wavy", label: "长波浪（中背长）" },
  { value: "medium-shoulder", label: "齐肩内卷" },
  { value: "short-bob", label: "波波短发" },
  { value: "updo-bun", label: "低盘发" },
];

const BODY_SHAPE_OPTIONS = [
  { value: "slim", label: "纤瘦" },
  { value: "standard", label: "标准" },
  { value: "athletic", label: "运动健康" },
  { value: "curvy", label: "曲线丰满" },
  { value: "plus", label: "大码" },
  { value: "maternity", label: "孕妇" },
  { value: "teen", label: "青少年" },
];

const CATEGORY_OPTIONS = [
  { value: "", label: "未分类" },
  { value: "universal", label: "通用" },
  { value: "plus_size", label: "大码" },
  { value: "maternity", label: "孕妇" },
  { value: "teen", label: "青少年" },
];

/* ─────────────────────────────────────────────────────────
 *  状态：3 个阶段 — form / preview / success
 * ───────────────────────────────────────────────────────── */

type GeneratedResult = {
  gen_id: string;
  image_url: string;
  params: IdentityParams;
  mime_type: string;
  tokens: { prompt: number; completion: number };
};

type CommittedResult = {
  id: number;
  name: string;
  image_url: string;
  category_label: string | null;
};

type Variant = {
  gen_id: string;
  image_url: string;
  mime_type: string;
};

type Mode = "text" | "prototype";

export default function IdentityGeneratorPage() {
  // 模式：纯文生图 vs 原型 + 变体
  const [mode, setMode] = useState<Mode>("text");

  // 可选模型列表 + 当前选中
  // 默认 Pro Image（gemini-3-pro-image-preview）；用户可以切到 OpenAI 或 Flash
  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  const [modelId, setModelId] = useState<string>(
    "gemini-3-pro-image-preview",
  );
  // 画质：1K (HD) / 2K (推荐) / 4K (最佳但慢)
  const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("2K");

  // 表单
  const [params, setParams] = useState<IdentityParams>({
    ethnicity: "east-asian",
    age: "25-30",
    hairColor: "black",
    hairStyle: "long-straight",
    bodyShape: "standard",
  });

  // 阶段
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<CommittedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 原型 + 变体模式专用
  const [prototypeFile, setPrototypeFile] = useState<File | null>(null);
  const [prototypeUrl, setPrototypeUrl] = useState<string>("");
  const [variantCount, setVariantCount] = useState<number>(2);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    null,
  );

  // commit 表单（保存阶段才用到）
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [sortOrder, setSortOrder] = useState(0);

  // ─────── 加载可选模型列表（image_gen 类） ───────
  useEffect(() => {
    fetch("/api/ai-models?category=image_gen")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: AiModel[]) => {
        if (!Array.isArray(list) || list.length === 0) return;
        setAiModels(list);
        // 优先用默认（Pro Image），其次是 list 里 is_default = 1 的
        const hasPro = list.find(
          (m) => m.model_id === "gemini-3-pro-image-preview",
        );
        const def = hasPro
          ? hasPro.model_id
          : list.find((m) => m.is_default === 1)?.model_id ||
            list[0].model_id;
        setModelId(def);
      })
      .catch(() => {
        /* 拉不到就用默认值 */
      });
  }, []);

  // ─────── 操作 ───────

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    setGenerated(null);
    try {
      const res = await fetch("/api/identities/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, model: modelId, imageSize }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || res.statusText);
      }
      const result = (await res.json()) as GeneratedResult;
      setGenerated(result);
      // 初始化 commit 表单的默认 name
      const ethnicityLabel =
        ETHNICITY_OPTIONS.find((e) => e.value === params.ethnicity)?.label ||
        "";
      const bodyLabel =
        BODY_SHAPE_OPTIONS.find((b) => b.value === params.bodyShape)?.label ||
        "";
      setName(`${ethnicityLabel}·${bodyLabel}·${params.age}`);
      // 自动猜一个 category
      const guessedCategory =
        params.bodyShape === "maternity"
          ? "maternity"
          : params.bodyShape === "plus"
            ? "plus_size"
            : params.bodyShape === "teen"
              ? "teen"
              : "universal";
      setCategory(guessedCategory);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function handleCommit() {
    if (!generated || !name.trim()) {
      setError("名称必填");
      return;
    }
    setError(null);
    setCommitting(true);
    try {
      // 从 image_url 推 ext：例 /assets/temp/identity-gen/xxx.png → "png"
      const ext = generated.image_url.split(".").pop() || "png";
      const res = await fetch("/api/identities/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gen_id: generated.gen_id,
          ext,
          name: name.trim(),
          category: category || undefined,
          tags: tags.trim() || undefined,
          sort_order: sortOrder,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || res.statusText);
      }
      const row = (await res.json()) as CommittedResult;
      setCommitted(row);
      setGenerated(null);
      // 重置表单为下一次生成做准备
      setName("");
      setTags("");
      setSortOrder(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }

  function handleReset() {
    setGenerated(null);
    setCommitted(null);
    setError(null);
    setVariants([]);
    setSelectedVariantId(null);
  }

  /* ── 原型 + 变体模式 handlers ── */

  function handlePickPrototype(files: File[]) {
    const f = files[0];
    if (!f) return;
    // 释放上一张的 blob url
    if (prototypeUrl) URL.revokeObjectURL(prototypeUrl);
    setPrototypeFile(f);
    setPrototypeUrl(URL.createObjectURL(f));
    // 切换原型后清空变体结果
    setVariants([]);
    setSelectedVariantId(null);
    setGenerated(null);
    setError(null);
  }

  function handleClearPrototype() {
    if (prototypeUrl) URL.revokeObjectURL(prototypeUrl);
    setPrototypeFile(null);
    setPrototypeUrl("");
    setVariants([]);
    setSelectedVariantId(null);
  }

  async function handleGenerateVariants() {
    if (!prototypeFile) {
      setError("请先上传原型图");
      return;
    }
    setError(null);
    setGenerating(true);
    setVariants([]);
    setSelectedVariantId(null);
    setGenerated(null);
    try {
      const fd = new FormData();
      fd.append("prototype", prototypeFile);
      fd.append("ethnicity", params.ethnicity);
      fd.append("age", params.age);
      fd.append("hairColor", params.hairColor);
      fd.append("hairStyle", params.hairStyle);
      fd.append("n", String(variantCount));
      fd.append("model", modelId);
      fd.append("imageSize", imageSize);

      const res = await fetch("/api/identities/generate-variants", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || res.statusText);
      }
      const result = (await res.json()) as {
        variants: Variant[];
        params: IdentityParams;
      };
      setVariants(result.variants);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  /**
   * 用户挑中某个变体 → 把它套进 generated 状态，复用既有的 commit 流程
   */
  function selectVariant(v: Variant) {
    setSelectedVariantId(v.gen_id);
    // 把 variant 包装成 GeneratedResult 形状，复用 commit form
    setGenerated({
      gen_id: v.gen_id,
      image_url: v.image_url,
      params,
      mime_type: v.mime_type,
      tokens: { prompt: 0, completion: 0 }, // OpenAI 是固定单价，token 字段意义不大
    });
    // 默认 name：种族 + "原型变体" + 年龄 + variant id 后 6 位
    const ethnicityLabel =
      ETHNICITY_OPTIONS.find((e) => e.value === params.ethnicity)?.label || "";
    const idSuffix = v.gen_id.slice(-6);
    setName(`${ethnicityLabel}·原型变体·${params.age}·${idSuffix}`.slice(0, 50));
    setCategory("universal");
  }

  // 估算单张成本：~2000 output tokens × $120/1M = $0.24，加 prompt 大约 ¥1.7
  // 这是写死的提示，准确数字看 generated.tokens
  const generatedCostCny =
    generated &&
    (
      ((generated.tokens.prompt * 2 + generated.tokens.completion * 120) /
        1_000_000) *
      6.83
    ).toFixed(2);

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-8">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-fg-primary flex items-center gap-2">
          <Sparkles size={20} className="text-brand-400" strokeWidth={2.2} />
          形象生成器
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          按 5 个参数生成高质量 identity 参考图（默认 Pro 2K · 3:4 ·
          毛孔级真实感）。预览满意后保存到形象库，立刻在批量摄影里能选。
        </p>
        <p className="mt-1 text-[11px] text-fg-muted">
          先用 1K/2K 找对参数方向，再切 4K 出最终版；不满意可重生成多次再选最好的保存。
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      {/* 提交成功 banner */}
      {committed && (
        <div className="mb-6 p-4 rounded-lg border" style={{
          background: "var(--success-bg)",
          borderColor: "rgba(34, 197, 94, 0.4)",
        }}>
          <div className="flex items-start gap-3">
            <img
              src={committed.image_url}
              alt={committed.name}
              className="w-16 h-20 rounded object-cover border border-border-subtle shrink-0"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-success flex items-center gap-2">
                ✅ 已保存到形象库：{committed.name}
                {committed.category_label && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-bg-tertiary text-fg-tertiary">
                    {committed.category_label}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[12px] text-fg-secondary">
                ID #{committed.id} · 现在可以在批量摄影 / 模特库里选用
              </div>
              <div className="mt-2 flex gap-2">
                <a
                  href="/admin/models"
                  className="text-xs text-brand-400 hover:underline inline-flex items-center gap-1"
                >
                  打开模特库 <ExternalLink size={11} />
                </a>
                <button
                  onClick={() => setCommitted(null)}
                  className="text-xs text-fg-secondary hover:text-fg-primary"
                >
                  继续生成下一个
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 模式切换 */}
      <div className="mb-4 flex gap-1 p-1 bg-bg-tertiary border border-border-subtle rounded-md w-fit">
        <button
          onClick={() => {
            setMode("text");
            handleReset();
          }}
          className={
            mode === "text"
              ? "px-3 py-1.5 text-xs rounded bg-brand-500 text-white font-medium"
              : "px-3 py-1.5 text-xs rounded text-fg-secondary hover:text-fg-primary"
          }
        >
          纯文生图
        </button>
        <button
          onClick={() => {
            setMode("prototype");
            handleReset();
          }}
          className={
            mode === "prototype"
              ? "px-3 py-1.5 text-xs rounded bg-brand-500 text-white font-medium"
              : "px-3 py-1.5 text-xs rounded text-fg-secondary hover:text-fg-primary"
          }
        >
          原型 + 变体
          <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-brand-200 text-brand-700">
            NEW
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 左：参数表单 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-4">
            {mode === "text" ? "① 配置参数" : "① 上传原型 + 配置变体"}
          </h2>
          <div className="space-y-3">
            {/* 出图模型（两种模式共享） */}
            <Field label="出图模型">
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="input select text-sm h-9"
                disabled={aiModels.length === 0}
              >
                {aiModels.length === 0 ? (
                  <option value={modelId}>{modelId}</option>
                ) : (
                  aiModels.map((m) => (
                    <option key={m.model_id} value={m.model_id}>
                      {m.label}
                      {m.badge ? ` · ${m.badge}` : ""}
                    </option>
                  ))
                )}
              </select>
              <div className="mt-1 text-[10px] text-fg-muted leading-tight">
                {aiModels.find((m) => m.model_id === modelId)?.description ||
                  ""}
                {modelId.startsWith("gpt-image") && (
                  <span className="text-[10px] text-warning ml-1">
                    · OpenAI Tier 1 限 5 IPM，慢且可能 429
                  </span>
                )}
              </div>
            </Field>

            {/* 画质（影响出图速度 + 成本） */}
            <Field label="画质">
              <div className="flex gap-1.5">
                {(
                  [
                    {
                      v: "1K" as const,
                      label: "1K (HD)",
                      desc: "最快 · ~10-20 秒",
                    },
                    {
                      v: "2K" as const,
                      label: "2K",
                      desc: "推荐 · ~30-60 秒",
                    },
                    {
                      v: "4K" as const,
                      label: "4K",
                      desc: "最佳但慢 · 60-120 秒，OpenAI 易超时",
                    },
                  ]
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setImageSize(opt.v)}
                    title={opt.desc}
                    className={
                      imageSize === opt.v
                        ? "flex-1 py-1.5 rounded text-sm bg-brand-500 text-white font-medium"
                        : "flex-1 py-1.5 rounded text-sm bg-bg-base text-fg-secondary border border-border-subtle hover:bg-brand-50 hover:text-brand-600"
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-fg-muted">
                {imageSize === "1K" &&
                  "最快档 — 适合先试参数找方向，不满意再升画质"}
                {imageSize === "2K" && "推荐 — 速度与画质平衡，多数场景够用"}
                {imageSize === "4K" &&
                  "最佳画质，但 OpenAI 路径耗时长且 Tier 1 易 429。"}
              </div>
            </Field>

            {/* 原型模式：上传原型图 */}
            {mode === "prototype" && (
              <Field label="原型图（真人参考 · 保留身体 + 姿势 + 背景）">
                {!prototypeFile ? (
                  <Dropzone
                    accept="image/*"
                    multiple={false}
                    onFiles={handlePickPrototype}
                    icon={<Upload size={20} strokeWidth={1.6} />}
                    title="拖拽 / 点击 / Ctrl+V 粘贴原型"
                    description="PNG / JPG · 限 20MB · 推荐 3:4 全身像"
                    compact
                  />
                ) : (
                  <div className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={prototypeUrl}
                      alt="prototype"
                      className="w-full max-h-[280px] object-contain rounded border border-border-subtle bg-bg-tertiary"
                    />
                    <button
                      type="button"
                      onClick={handleClearPrototype}
                      className="absolute top-1 right-1 p-1 bg-black/60 text-white rounded hover:bg-black/80"
                      title="移除"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </Field>
            )}

            <Field label="种族 / 肤色">
              <select
                value={params.ethnicity}
                onChange={(e) =>
                  setParams({ ...params, ethnicity: e.target.value })
                }
                className="input select text-sm h-9"
              >
                {ETHNICITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="年龄段">
              <select
                value={params.age}
                onChange={(e) => setParams({ ...params, age: e.target.value })}
                className="input select text-sm h-9"
              >
                {AGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="发色">
              <select
                value={params.hairColor}
                onChange={(e) =>
                  setParams({ ...params, hairColor: e.target.value })
                }
                className="input select text-sm h-9"
              >
                {HAIR_COLOR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="发型">
              <select
                value={params.hairStyle}
                onChange={(e) =>
                  setParams({ ...params, hairStyle: e.target.value })
                }
                className="input select text-sm h-9"
              >
                {HAIR_STYLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            {/* 体型只在文生图模式选；原型模式下体型由原型图决定 */}
            {mode === "text" && (
              <Field label="体型">
                <select
                  value={params.bodyShape}
                  onChange={(e) =>
                    setParams({ ...params, bodyShape: e.target.value })
                  }
                  className="input select text-sm h-9"
                >
                  {BODY_SHAPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {/* 原型模式：变体数 1..4 */}
            {mode === "prototype" && (
              <Field label="变体数 (一次出几张换头版本)">
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setVariantCount(n)}
                      className={
                        variantCount === n
                          ? "flex-1 py-2 rounded text-sm bg-brand-500 text-white font-medium"
                          : "flex-1 py-2 rounded text-sm bg-bg-base text-fg-secondary border border-border-subtle hover:bg-brand-50 hover:text-brand-600"
                      }
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="mt-1 text-[10px] text-fg-muted">
                  {modelId.startsWith("gpt-image")
                    ? "N × OpenAI 固定单价（gpt-image-2 high 1024×1536 一张约 ¥1.13）"
                    : "N × Gemini Pro 4K 约 ¥1.7 / 张（按 token 计）"}
                </div>
              </Field>
            )}

            <button
              onClick={
                mode === "text" ? handleGenerate : handleGenerateVariants
              }
              disabled={
                generating || (mode === "prototype" && !prototypeFile)
              }
              className="btn btn-primary w-full mt-2"
            >
              {generating ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {mode === "text"
                    ? "生成中…（Pro 4K，约 30-90 秒）"
                    : `生成 ${variantCount} 张变体中…（约 ${variantCount * 20}-${variantCount * 40} 秒）`}
                </>
              ) : (
                <>
                  <Sparkles size={14} strokeWidth={2.2} />
                  {mode === "text" ? "生成" : `生成 ${variantCount} 张变体`}
                </>
              )}
            </button>
          </div>
        </section>

        {/* 右：预览区 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-4">
            ② 预览 / 保存
          </h2>

          {!generated && !generating && variants.length === 0 && (
            <div className="text-sm text-fg-tertiary p-8 text-center border border-dashed border-border-default rounded">
              {mode === "text"
                ? "左边配好参数，点\"生成\""
                : "左边上传原型 + 配置变体，点\"生成 N 张变体\""}
              <br />
              <span className="text-[11px] text-fg-muted">
                {mode === "text" ? "出图后会显示在这里" : "N 张变体出图后会显示在这里，点中意的那张去保存"}
              </span>
            </div>
          )}

          {generating && (
            <div className="text-sm text-fg-tertiary p-8 text-center border border-dashed border-border-default rounded">
              <span className="inline-block w-5 h-5 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mb-2" />
              <br />
              {mode === "text"
                ? `${aiModels.find((m) => m.model_id === modelId)?.label || modelId} 在思考 + 渲染，请耐心等约 30-90 秒…`
                : `${aiModels.find((m) => m.model_id === modelId)?.label || modelId} 并行跑 ${variantCount} 张换头变体，约 ${variantCount * 20}-${variantCount * 40} 秒…`}
            </div>
          )}

          {/* 原型模式：N 张变体网格 */}
          {mode === "prototype" && variants.length > 0 && !generated && (
            <div className="space-y-3">
              <div className="text-[12px] text-fg-secondary">
                出了 {variants.length} 张变体 · 点中意的那张去填写名称保存
              </div>
              <div className="grid grid-cols-2 gap-2">
                {variants.map((v) => (
                  <button
                    key={v.gen_id}
                    type="button"
                    onClick={() => selectVariant(v)}
                    className="relative group rounded border-2 border-transparent hover:border-brand-400 overflow-hidden"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={v.image_url}
                      alt={`variant ${v.gen_id}`}
                      className="w-full aspect-[3/4] object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[11px] text-white font-medium">
                        选这张 →
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              <button
                onClick={handleGenerateVariants}
                disabled={generating || !prototypeFile}
                className="btn btn-secondary btn-sm w-full"
                title="重新跑一组变体"
              >
                <RefreshCw size={12} strokeWidth={2.2} />
                重跑这一组（{variantCount} 张）
              </button>
            </div>
          )}

          {generated && (
            <div className="space-y-3">
              {/* 预览图 */}
              <div className="bg-bg-tertiary rounded border border-border-subtle overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={generated.image_url}
                  alt="生成的 identity"
                  className="w-full h-auto"
                  style={{ maxHeight: 600, objectFit: "contain" }}
                />
              </div>

              <div className="text-[11px] text-fg-muted">
                {modelId.startsWith("gpt-image") ? (
                  <>
                    {aiModels.find((m) => m.model_id === modelId)?.label ||
                      modelId}{" "}
                    · 固定单价（按 size×quality 查表，详见 admin 系统设置）
                  </>
                ) : (
                  <>
                    tokens · {generated.tokens.prompt} prompt /{" "}
                    {generated.tokens.completion} completion · 约 ¥
                    {generatedCostCny}
                  </>
                )}
              </div>

              {/* 重生成 / 调整 / 保存 三个动作 */}
              <div className="flex gap-2">
                <button
                  onClick={
                    mode === "text" ? handleGenerate : handleGenerateVariants
                  }
                  disabled={generating || committing}
                  className="btn btn-secondary btn-sm flex-1"
                  title={
                    mode === "text"
                      ? "同样参数再生成一张"
                      : "重新跑一组变体"
                  }
                >
                  <RefreshCw size={12} strokeWidth={2.2} />
                  {mode === "text"
                    ? "重生成"
                    : `重跑 ${variantCount} 张变体`}
                </button>
                {mode === "prototype" && variants.length > 0 && (
                  <button
                    onClick={() => {
                      // 回到变体网格选其他变体（不重新跑）
                      setGenerated(null);
                      setSelectedVariantId(null);
                    }}
                    disabled={generating || committing}
                    className="btn btn-secondary btn-sm flex-1"
                    title="返回变体网格挑别的"
                  >
                    <ArrowLeft size={12} strokeWidth={2.2} />
                    挑其他变体
                  </button>
                )}
                <button
                  onClick={handleReset}
                  disabled={generating || committing}
                  className="btn btn-ghost btn-sm flex-1"
                  title="清空当前预览，重新调参数"
                >
                  <ArrowLeft size={12} strokeWidth={2.2} />
                  调参数
                </button>
              </div>

              {/* 保存表单 */}
              <div className="border-t border-border-subtle pt-3 space-y-2.5">
                <Field label="名称（必填）">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="如：东亚·标准·25-30"
                    className="input text-sm h-9"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="分类">
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="input select text-sm h-9"
                    >
                      {CATEGORY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="排序">
                    <input
                      type="number"
                      value={sortOrder}
                      onChange={(e) => setSortOrder(Number(e.target.value))}
                      className="input text-sm h-9"
                    />
                  </Field>
                </div>

                <Field label="标签（逗号分隔）">
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="如：东亚,标准,长直发"
                    className="input text-sm h-9"
                  />
                </Field>

                <button
                  onClick={handleCommit}
                  disabled={committing || !name.trim()}
                  className="btn btn-primary w-full mt-1"
                >
                  {committing ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      保存中…
                    </>
                  ) : (
                    <>
                      <Save size={13} strokeWidth={2.2} />
                      保存到形象库
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────
 *  小工具组件
 * ───────────────────────────────────────────────────────── */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] text-fg-tertiary mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
