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
          <h1 className="text-2xl font-bold text-gray-900">AI 模型管理</h1>
          <p className="mt-1 text-sm text-gray-500">
            控制哪些模型在前端可见 / 哪个是默认。新发布的 Gemini 模型可以直接录入 ID，不用改代码
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
        >
          {showForm ? "取消" : "+ 添加新模型"}
        </button>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
          {error}
        </div>
      )}

      {showForm && (
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            添加新模型
          </h2>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Category <span className="text-red-500">*</span>
              </label>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as Category })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="image_gen">image_gen（图像生成）</option>
                <option value="vision">vision（视觉理解）</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Model ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.model_id}
                onChange={(e) => setForm({ ...form, model_id: e.target.value })}
                placeholder="如：gemini-3.1-flash-image-preview"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Label <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="如：Nano Banana 2"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Badge</label>
              <input
                type="text"
                value={form.badge}
                onChange={(e) => setForm({ ...form, badge: e.target.value })}
                placeholder="可选，如：推荐"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">
                Description
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="一两句说明，前端会显示"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Sort order
              </label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) =>
                  setForm({ ...form, sort_order: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div className="flex items-center gap-4 pt-5">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm({ ...form, enabled: e.target.checked })
                  }
                />
                启用
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
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
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
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
          className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6"
        >
          <div className="px-6 py-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-800">
              {CATEGORY_LABEL[cat]}{" "}
              <span className="text-gray-400">({grouped[cat].length})</span>
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">{CATEGORY_HINT[cat]}</p>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-gray-500">加载中...</div>
          ) : grouped[cat].length === 0 ? (
            <div className="p-6 text-sm text-gray-500">暂无模型</div>
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
          <span className="text-sm font-medium text-gray-900">
            {model.label}
          </span>
          {model.badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600 text-white">
              {model.badge}
            </span>
          )}
          {model.is_default === 1 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-300">
              默认
            </span>
          )}
          {model.enabled === 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
              已停用
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 font-mono mt-0.5 truncate">
          {model.model_id}
        </div>
        {model.description && (
          <div className="text-xs text-gray-500 mt-0.5 truncate">
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
              ? "border-gray-300 text-gray-700 hover:bg-gray-50"
              : "border-blue-500 text-blue-700 bg-blue-50 hover:bg-blue-100"
          }`}
        >
          {model.enabled === 1 ? "停用" : "启用"}
        </button>
        {model.is_default !== 1 && (
          <button
            onClick={() => onPatch(model.id, { is_default: true })}
            className="text-xs px-2 py-1 rounded border border-green-500 text-green-700 hover:bg-green-50"
          >
            设为默认
          </button>
        )}
        <button
          onClick={() => onDelete(model.id)}
          className="text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50"
        >
          删除
        </button>
      </div>
    </li>
  );
}
