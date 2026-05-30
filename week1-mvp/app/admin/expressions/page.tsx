"use client";

import { useEffect, useState } from "react";

type Expression = {
  id: number;
  name: string;
  text: string;
  is_default: number;
  sort_order: number;
};

export default function ExpressionsAdminPage() {
  const [items, setItems] = useState<Expression[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    text: "",
    is_default: false,
    sort_order: 0,
  });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/expressions");
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
    if (!form.name.trim() || !form.text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/expressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setForm({ name: "", text: "", is_default: false, sort_order: 0 });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(id: number, patch: Partial<Expression>) {
    setError(null);
    try {
      const res = await fetch(`/api/expressions/${id}`, {
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
    if (!confirm("确定删除这个表情？")) return;
    try {
      const res = await fetch(`/api/expressions/${id}`, { method: "DELETE" });
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
          <h1 className="text-2xl font-bold text-fg-primary">表情库</h1>
          <p className="mt-1 text-sm text-fg-tertiary">
            独立于姿势的全局维度——批量摄影时所有姿势共用同一个表情。
            <strong className="text-fg-primary">仅描述脸部 / 眼神 / 嘴部 / 视线 / 情绪</strong>
            ，不要混入身体动作。
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700"
        >
          {showForm ? "取消" : "+ 添加表情"}
        </button>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      {showForm && (
        <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6 mb-6">
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="block text-xs text-fg-secondary mb-1">
                名称 <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：温柔微笑"
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-fg-secondary mb-1">
                表情描述 <span className="text-danger">*</span>
              </label>
              <textarea
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
                rows={3}
                placeholder="只描述脸部细节：嘴角的弧度、眼神方向、眉眼舒展度、整体情绪..."
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-fg-secondary mb-1">
                  排序
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
              <label className="flex items-center gap-2 self-end mb-2 text-xs text-fg-secondary">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) =>
                    setForm({ ...form, is_default: e.target.checked })
                  }
                />
                设为默认（用户未选时使用）
              </label>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? "保存中..." : "保存"}
            </button>
          </form>
        </section>
      )}

      <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle">
        <div className="px-6 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-fg-primary">
            所有表情 ({items.length})
          </h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-fg-tertiary">加载中...</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-fg-tertiary">暂无</div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {items.map((p) => (
              <ExpressionRow
                key={p.id}
                item={p}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ExpressionRow({
  item,
  onUpdate,
  onDelete,
}: {
  item: Expression;
  onUpdate: (id: number, patch: Partial<Expression>) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: item.name,
    text: item.text,
    is_default: item.is_default === 1,
  });

  if (editing) {
    return (
      <li className="px-6 py-4 bg-[var(--brand-50-bg)] space-y-2">
        <input
          className="w-full px-2 py-1 border border-border-default rounded text-sm"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <textarea
          className="w-full px-2 py-1 border border-border-default rounded text-sm"
          rows={3}
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <input
            type="checkbox"
            checked={draft.is_default}
            onChange={(e) =>
              setDraft({ ...draft, is_default: e.target.checked })
            }
          />
          设为默认
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => {
              onUpdate(item.id, {
                name: draft.name,
                text: draft.text,
                is_default: draft.is_default ? 1 : 0,
              } as Partial<Expression>);
              setEditing(false);
            }}
            className="px-3 py-1 bg-brand-600 text-white text-xs rounded"
          >
            保存
          </button>
          <button
            onClick={() => setEditing(false)}
            className="px-3 py-1 text-fg-secondary text-xs rounded hover:bg-bg-tertiary"
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
          <div className="text-sm font-medium text-fg-primary flex items-center gap-1.5">
            <span>{item.name}</span>
            {item.is_default === 1 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200 font-normal">
                默认
              </span>
            )}
          </div>
          <div className="text-xs text-fg-secondary mt-1 leading-relaxed">
            {item.text}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-fg-secondary hover:text-fg-primary px-2 py-1"
          >
            编辑
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="text-xs text-danger hover:opacity-80 px-2 py-1"
          >
            删除
          </button>
        </div>
      </div>
    </li>
  );
}
