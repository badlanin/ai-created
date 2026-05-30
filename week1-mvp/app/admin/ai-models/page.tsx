"use client";

import { useEffect, useMemo, useState } from "react";

type Category = "vision" | "image_gen";

type AiModel = {
  id: number;
  model_id: string;
  label: string;
  description: string | null;
  category: Category;
  enabled: 0 | 1;
  is_default: 0 | 1;
  badge: string | null;
  sort_order: number;
  created_at: number;
};

const CATEGORY_LABEL: Record<Category, string> = {
  vision: "视觉理解（解析图片用）",
  image_gen: "图像生成（换色 / 换模特用）",
};

const CATEGORY_HINT: Record<Category, string> = {
  vision:
    "用于 /analyze 解析图片。推荐 gemini-2.5-flash（性价比高）或 gemini-2.5-pro（识别更细）",
  image_gen:
    "用于 /recolor 换色 和后续 /on-model 换模特。Nano Banana 系列（gemini-*-image-preview）",
};

export default function AiModelsAdminPage() {
  const [models, setModels] = useState<AiModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 新增表单
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    model_id: "",
    label: "",
    description: "",
    category: "image_gen" as Category,
    badge: "",
    sort_order: 0,
    enabled: true,
    is_default: false,
  });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-models");
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setModels(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    const map: Record<Category, AiModel[]> = { vision: [], image_gen: [] };
    for (const m of models) {
      map[m.category].push(m);
    }
    return map;
  }, [models]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.model_id.trim() || !form.label.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: form.model_id.trim(),
          label: form.label.trim(),
          description: form.description.trim() || undefined,
          category: form.category,
          badge: form.badge.trim() || undefined,
          sort_order: Number(form.sort_order) || 0,
          enabled: form.enabled,
          is_default: form.is_default,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setForm({
        model_id: "",
        label: "",
        description: "",
        category: form.category,
        badge: "",
        sort_order: 0,
        enabled: true,
        is_default: false,
      });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePatch(id: number, patch: Record<string, unknown>) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/ai-models/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("确定删除这个模型？前端选择器里会立刻看不到。")) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/ai-models/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-fg-primary">AI 模型管理</h1>
          <p className="mt-1 text-sm text-fg-tertiary">
            控制哪些模型在前端可见 / 哪个是默认。新发布的 Gemini 模型可以直接录入 ID，不用改代码
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700"
        >
          {showForm ? "取消" : "+ 添加新模型"}
        </button>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      {showForm && (
        <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6 mb-6">
          <h2 className="text-sm font-semibold text-fg-secondary mb-3">
            添加新模型
          </h2>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-fg-secondary mb-1">
                Category <span className="text-danger">*</span>
              </label>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as Category })
                }
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
              >
                <option value="image_gen">image_gen（图像生成）</option>
                <option value="vision">vision（视觉理解）</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-fg-secondary mb-1">
                Model ID <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={form.model_id}
                onChange={(e) => setForm({ ...form, model_id: e.target.value })}
                placeholder="如：gemini-3.1-flash-image-preview"
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-fg-secondary mb-1">
                Label <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="如：Nano Banana 2"
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-fg-secondary mb-1">Badge</label>
              <input
                type="text"
                value={form.badge}
                onChange={(e) => setForm({ ...form, badge: e.target.value })}
                placeholder="可选，如：推荐"
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-fg-secondary mb-1">
                Description
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="一两句说明，前端会显示"
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-fg-secondary mb-1">
                Sort order
              </label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) =>
                  setForm({ ...form, sort_order: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
              />
            </div>
            <div className="flex items-center gap-4 pt-5">
              <label className="flex items-center gap-2 text-sm text-fg-secondary">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm({ ...form, enabled: e.target.checked })
                  }
                />
                启用
              </label>
              <label className="flex items-center gap-2 text-sm text-fg-secondary">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) =>
                    setForm({ ...form, is_default: e.target.checked })
                  }
                />
                设为默认
              </label>
            </div>
            <div className="col-span-2">
              <button
                type="submit"
                disabled={
                  submitting || !form.model_id.trim() || !form.label.trim()
                }
                className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50"
              >
                {submitting ? "保存中..." : "保存"}
              </button>
            </div>
          </form>
        </section>
      )}

      {(["image_gen", "vision"] as Category[]).map((cat) => (
        <section
          key={cat}
          className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle mb-6"
        >
          <div className="px-6 py-3 border-b border-border-subtle">
            <h2 className="text-sm font-semibold text-fg-primary">
              {CATEGORY_LABEL[cat]}{" "}
              <span className="text-fg-tertiary">({grouped[cat].length})</span>
            </h2>
            <p className="mt-0.5 text-xs text-fg-tertiary">{CATEGORY_HINT[cat]}</p>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-fg-tertiary">加载中...</div>
          ) : grouped[cat].length === 0 ? (
            <div className="p-6 text-sm text-fg-tertiary">暂无模型</div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {grouped[cat].map((m) => (
                <ModelRow
                  key={m.id}
                  model={m}
                  onPatch={handlePatch}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}

function ModelRow({
  model,
  onPatch,
  onDelete,
}: {
  model: AiModel;
  onPatch: (id: number, patch: Record<string, unknown>) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <li className="px-6 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-fg-primary">
            {model.label}
          </span>
          {model.badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-600 text-white">
              {model.badge}
            </span>
          )}
          {model.is_default === 1 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-success border border-green-300">
              默认
            </span>
          )}
          {model.enabled === 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-fg-secondary">
              已停用
            </span>
          )}
        </div>
        <div className="text-xs text-fg-tertiary font-mono mt-0.5 truncate">
          {model.model_id}
        </div>
        {model.description && (
          <div className="text-xs text-fg-tertiary mt-0.5 truncate">
            {model.description}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() =>
            onPatch(model.id, { enabled: model.enabled === 1 ? false : true })
          }
          className={`text-xs px-2 py-1 rounded border ${
            model.enabled === 1
              ? "border-border-default text-fg-secondary hover:bg-bg-tertiary"
              : "border-brand-500 text-brand-400 bg-[var(--brand-50-bg)] hover:bg-[var(--brand-100-bg)]"
          }`}
        >
          {model.enabled === 1 ? "停用" : "启用"}
        </button>
        {model.is_default !== 1 && (
          <button
            onClick={() => onPatch(model.id, { is_default: true })}
            className="text-xs px-2 py-1 rounded border border-green-500 text-success hover:bg-[var(--success-bg)]"
          >
            设为默认
          </button>
        )}
        <button
          onClick={() => onDelete(model.id)}
          className="text-xs px-2 py-1 rounded text-danger hover:bg-[var(--danger-bg)]"
        >
          删除
        </button>
      </div>
    </li>
  );
}
