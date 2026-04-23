"use client";

import { useEffect, useState } from "react";

type Photography = {
  id: number;
  name: string;
  description: string | null;
  params_text: string;
  is_default: 0 | 1;
  sort_order: number;
};

export default function PhotographyAdminPage() {
  const [items, setItems] = useState<Photography[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    params_text: "",
    is_default: false,
    sort_order: 0,
  });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/photography");
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setItems(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.params_text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/photography", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setForm({
        name: "",
        description: "",
        params_text: "",
        is_default: false,
        sort_order: 0,
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
      const res = await fetch(`/api/photography/${id}`, {
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
    if (!confirm("确定删除这个摄影参数预设？")) return;
    try {
      const res = await fetch(`/api/photography/${id}`, { method: "DELETE" });
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
          <h1 className="text-2xl font-bold text-gray-900">摄影参数库</h1>
          <p className="mt-1 text-sm text-gray-500">
            镜头、光圈、角度、光源、色调等摄影指令预设。生成时会注入 Prompt 的 {"{{photography_params}}"} 占位符
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
        >
          {showForm ? "取消" : "+ 添加预设"}
        </button>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
          {error}
        </div>
      )}

      {showForm && (
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：商品级标准图"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                简短说明
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="UI 上显示，方便团队选择"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                摄影参数内容 <span className="text-red-500">*</span>
                <span className="ml-2 text-gray-400">
                  （Markdown 格式，会原样注入 Prompt）
                </span>
              </label>
              <textarea
                value={form.params_text}
                onChange={(e) =>
                  setForm({ ...form, params_text: e.target.value })
                }
                rows={10}
                placeholder={`【摄影参数】
- 镜头：85mm
- 光圈：f/4
- 角度：平视
- 光源：柔光箱
- 色调：自然中性
- 构图：三分法`}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
              />
            </div>
            <div className="flex items-center gap-4">
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
              <div>
                <label className="text-xs text-gray-600 mr-2">排序</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm({ ...form, sort_order: Number(e.target.value) })
                  }
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "保存中..." : "保存"}
            </button>
          </form>
        </section>
      )}

      <section className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-800">
            已有预设 <span className="text-gray-400">({items.length})</span>
          </h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-gray-500">加载中...</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">暂无</div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {items.map((p) => (
              <PhotographyRow
                key={p.id}
                item={p}
                onPatch={handlePatch}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function PhotographyRow({
  item,
  onPatch,
  onDelete,
}: {
  item: Photography;
  onPatch: (id: number, patch: Record<string, unknown>) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState({
    name: item.name,
    description: item.description || "",
    params_text: item.params_text,
  });

  if (editing) {
    return (
      <li className="px-6 py-4 bg-blue-50 space-y-2">
        <input
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <input
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          placeholder="简短说明"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
        <textarea
          rows={10}
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm font-mono"
          value={draft.params_text}
          onChange={(e) => setDraft({ ...draft, params_text: e.target.value })}
        />
        <div className="flex gap-2">
          <button
            onClick={() => {
              onPatch(item.id, draft);
              setEditing(false);
            }}
            className="px-3 py-1 bg-blue-600 text-white text-xs rounded"
          >
            保存
          </button>
          <button
            onClick={() => setEditing(false)}
            className="px-3 py-1 text-gray-600 text-xs rounded hover:bg-gray-100"
          >
            取消
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="px-6 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">
              {item.name}
            </span>
            {item.is_default === 1 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-300">
                默认
              </span>
            )}
          </div>
          {item.description && (
            <div className="text-xs text-gray-500 mt-0.5">
              {item.description}
            </div>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-xs text-blue-600 hover:underline"
          >
            {expanded ? "收起参数" : "查看参数"}
          </button>
          {expanded && (
            <pre className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700 whitespace-pre-wrap">
              {item.params_text}
            </pre>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {item.is_default !== 1 && (
            <button
              onClick={() => onPatch(item.id, { is_default: true })}
              className="text-xs px-2 py-1 rounded border border-green-500 text-green-700 hover:bg-green-50"
            >
              设为默认
            </button>
          )}
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1"
          >
            编辑
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="text-xs text-red-600 hover:text-red-800 px-2 py-1"
          >
            删除
          </button>
        </div>
      </div>
    </li>
  );
}
