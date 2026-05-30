"use client";

import { useEffect, useMemo, useState } from "react";

type PromptKind = "on_model" | "recolor" | "generic";
type Prompt = {
  id: number;
  name: string;
  kind: PromptKind;
  template: string;
  notes: string | null;
  sort_order: number;
};

const KIND_LABEL: Record<PromptKind, string> = {
  on_model: "模特换装",
  recolor: "换色",
  generic: "通用",
};

const KIND_HINT: Record<PromptKind, string> = {
  on_model:
    "用于 /on-model 换装。占位符：{{garment_attrs}} {{pose}} {{photography_params}} {{user_seed}} {{n}}",
  recolor: "用于 /recolor 换色。占位符：{{color_name}} {{hex}}",
  generic: "通用模板",
};

export default function PromptsAdminPage() {
  const [items, setItems] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    kind: "on_model" as PromptKind,
    template: "",
    notes: "",
    sort_order: 0,
  });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/prompts");
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

  const grouped = useMemo(() => {
    const map: Record<PromptKind, Prompt[]> = {
      on_model: [],
      recolor: [],
      generic: [],
    };
    for (const p of items) map[p.kind].push(p);
    return map;
  }, [items]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.template.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setForm({
        name: "",
        kind: form.kind,
        template: "",
        notes: "",
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

  async function handlePatch(id: number, patch: Partial<Prompt>) {
    setError(null);
    try {
      const res = await fetch(`/api/prompts/${id}`, {
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
    if (!confirm("确定删除这个模板？删除后 /on-model 页将失去它作为选项")) return;
    try {
      const res = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
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
          <h1 className="text-2xl font-bold text-fg-primary">Prompt 模板库</h1>
          <p className="mt-1 text-sm text-fg-tertiary">
            生成任务使用的指令模板。占位符会在调用时自动替换
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700"
        >
          {showForm ? "取消" : "+ 添加模板"}
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-fg-secondary mb-1">
                  名称 <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如：标准模特穿着图"
                  className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-fg-secondary mb-1">
                  类型 <span className="text-danger">*</span>
                </label>
                <select
                  value={form.kind}
                  onChange={(e) =>
                    setForm({ ...form, kind: e.target.value as PromptKind })
                  }
                  className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
                >
                  <option value="on_model">模特换装 on_model</option>
                  <option value="recolor">换色 recolor</option>
                  <option value="generic">通用 generic</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-fg-secondary mb-1">备注</label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="简短描述这个模板的用途 / 风格"
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-fg-secondary mb-1">
                模板内容 <span className="text-danger">*</span>
                <span className="ml-2 text-fg-tertiary">
                  {KIND_HINT[form.kind]}
                </span>
              </label>
              <textarea
                value={form.template}
                onChange={(e) =>
                  setForm({ ...form, template: e.target.value })
                }
                rows={14}
                placeholder="完整 Prompt 文本，使用 {{占位符}} 作为动态注入点"
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm font-mono"
              />
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

      {(["on_model", "recolor", "generic"] as PromptKind[]).map((kind) => (
        <section
          key={kind}
          className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle mb-6"
        >
          <div className="px-6 py-3 border-b border-border-subtle">
            <h2 className="text-sm font-semibold text-fg-primary">
              {KIND_LABEL[kind]}
              <span className="ml-2 text-fg-tertiary">
                ({grouped[kind].length})
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-fg-tertiary">{KIND_HINT[kind]}</p>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-fg-tertiary">加载中...</div>
          ) : grouped[kind].length === 0 ? (
            <div className="p-6 text-sm text-fg-tertiary">暂无模板</div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {grouped[kind].map((p) => (
                <PromptRow
                  key={p.id}
                  prompt={p}
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

function PromptRow({
  prompt,
  onPatch,
  onDelete,
}: {
  prompt: Prompt;
  onPatch: (id: number, patch: Partial<Prompt>) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState({
    name: prompt.name,
    notes: prompt.notes || "",
    template: prompt.template,
  });

  if (editing) {
    return (
      <li className="px-6 py-4 bg-[var(--brand-50-bg)] space-y-2">
        <input
          className="w-full px-2 py-1 border border-border-default rounded text-sm"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <input
          className="w-full px-2 py-1 border border-border-default rounded text-sm"
          placeholder="备注"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
        <textarea
          rows={14}
          className="w-full px-2 py-1 border border-border-default rounded text-sm font-mono"
          value={draft.template}
          onChange={(e) => setDraft({ ...draft, template: e.target.value })}
        />
        <div className="flex gap-2">
          <button
            onClick={() => {
              onPatch(prompt.id, draft);
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
          <div className="text-sm font-medium text-fg-primary">{prompt.name}</div>
          {prompt.notes && (
            <div className="text-xs text-fg-tertiary mt-0.5">{prompt.notes}</div>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-xs text-brand-400 hover:underline"
          >
            {expanded ? "收起模板" : "查看模板"}
          </button>
          {expanded && (
            <pre className="mt-2 p-2 bg-bg-tertiary border border-border-subtle rounded text-xs text-fg-secondary whitespace-pre-wrap max-h-96 overflow-auto">
              {prompt.template}
            </pre>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-fg-secondary hover:text-fg-primary px-2 py-1"
          >
            编辑
          </button>
          <button
            onClick={() => onDelete(prompt.id)}
            className="text-xs text-danger hover:text-red-800 px-2 py-1"
          >
            删除
          </button>
        </div>
      </div>
    </li>
  );
}
