"use client";

import { useState } from "react";
import { Sparkles, RefreshCw, Save, ArrowLeft, ExternalLink } from "lucide-react";

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

export default function IdentityGeneratorPage() {
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

  // commit 表单（保存阶段才用到）
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [sortOrder, setSortOrder] = useState(0);

  // ─────── 操作 ───────

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    setGenerated(null);
    try {
      const res = await fetch("/api/identities/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
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
          按 5 个参数生成高质量 identity 参考图（Pro 模型 · 4K · 比例严格 ·
          毛孔级真实感）。预览满意后保存到形象库，立刻在批量摄影里能选。
        </p>
        <p className="mt-1 text-[11px] text-fg-muted">
          单张成本约 ¥1.7（Pro + 4K）；不满意可重生成多次再选最好的保存。
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 左：参数表单 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-4">
            ① 配置参数
          </h2>
          <div className="space-y-3">
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

            <button
              onClick={handleGenerate}
              disabled={generating}
              className="btn btn-primary w-full mt-2"
            >
              {generating ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  生成中…（Pro 4K，约 30-90 秒）
                </>
              ) : (
                <>
                  <Sparkles size={14} strokeWidth={2.2} />
                  生成
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

          {!generated && !generating && (
            <div className="text-sm text-fg-tertiary p-8 text-center border border-dashed border-border-default rounded">
              左边配好参数，点"生成"
              <br />
              <span className="text-[11px] text-fg-muted">
                出图后会显示在这里
              </span>
            </div>
          )}

          {generating && (
            <div className="text-sm text-fg-tertiary p-8 text-center border border-dashed border-border-default rounded">
              <span className="inline-block w-5 h-5 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mb-2" />
              <br />
              Pro 模型在思考 + 渲染 4K 全身像，请耐心等约 30-90 秒…
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
                tokens · {generated.tokens.prompt} prompt /{" "}
                {generated.tokens.completion} completion · 约 ¥
                {generatedCostCny}
              </div>

              {/* 重生成 / 调整 / 保存 三个动作 */}
              <div className="flex gap-2">
                <button
                  onClick={handleGenerate}
                  disabled={generating || committing}
                  className="btn btn-secondary btn-sm flex-1"
                  title="同样参数再生成一张"
                >
                  <RefreshCw size={12} strokeWidth={2.2} />
                  重生成
                </button>
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
