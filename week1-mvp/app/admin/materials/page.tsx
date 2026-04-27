"use client";

import { useEffect, useState } from "react";

type Material = {
  id: number;
  name: string;
  english_name: string | null;
  aliases: string | null;
  description: string | null;
  visual_traits: string | null;
  light_behavior: string | null;
  texture_rules: string | null;
  dont_confuse_with: string | null;
  sort_order: number;
};

const EMPTY_FORM: Omit<Material, "id"> = {
  name: "",
  english_name: "",
  aliases: "",
  description: "",
  visual_traits: "",
  light_behavior: "",
  texture_rules: "",
  dont_confuse_with: "",
  sort_order: 0,
};

export default function MaterialsAdminPage() {
  const [items, setItems] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/materials");
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
    if (!form.name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePatch(id: number, patch: Partial<Material>) {
    setError(null);
    try {
      const res = await fetch(`/api/materials/${id}`, {
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
    if (!confirm("确定删除这个材质？之后依赖它的历史生图不受影响")) return;
    try {
      const res = await fetch(`/api/materials/${id}`, { method: "DELETE" });
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
          <h1 className="text-2xl font-bold text-fg-primary">面料材质库</h1>
          <p className="mt-1 text-sm text-fg-tertiary">
            每种材质的详细描述和视觉特征。换色 / 换装时会根据款式解析自动匹配，并注入 Prompt
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700"
        >
          {showForm ? "取消" : "+ 添加材质"}
        </button>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      {showForm && (
        <MaterialForm
          value={form}
          onChange={setForm}
          onSubmit={handleCreate}
          submitting={submitting}
          submitLabel="保存"
        />
      )}

      <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle">
        <div className="px-6 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-fg-primary">
            全部材质 <span className="text-fg-tertiary">({items.length})</span>
          </h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-fg-tertiary">加载中...</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-fg-tertiary">暂无</div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {items.map((m) => (
              <MaterialRow
                key={m.id}
                item={m}
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

function MaterialForm({
  value,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
}: {
  value: Omit<Material, "id">;
  onChange: (next: Omit<Material, "id">) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  submitLabel: string;
}) {
  const set = (k: keyof Omit<Material, "id">, v: string | number | null) =>
    onChange({ ...value, [k]: v });

  return (
    <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6 mb-6">
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-fg-secondary mb-1">
              名称 <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={value.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="如：雪纺"
              className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-fg-secondary mb-1">英文名</label>
            <input
              type="text"
              value={value.english_name || ""}
              onChange={(e) => set("english_name", e.target.value)}
              placeholder="如：chiffon"
              className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-fg-secondary mb-1">排序</label>
            <input
              type="number"
              value={value.sort_order}
              onChange={(e) => set("sort_order", Number(e.target.value))}
              className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-fg-secondary mb-1">
            别名 / 关键词（逗号分隔，用于自动匹配）
          </label>
          <input
            type="text"
            value={value.aliases || ""}
            onChange={(e) => set("aliases", e.target.value)}
            placeholder="如：雪纺,chiffon,纱,轻纱,乔其纱"
            className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-fg-secondary mb-1">
            简短说明（UI 显示）
          </label>
          <input
            type="text"
            value={value.description || ""}
            onChange={(e) => set("description", e.target.value)}
            className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-fg-secondary mb-1">
            视觉特征（注入 Prompt）
          </label>
          <textarea
            value={value.visual_traits || ""}
            onChange={(e) => set("visual_traits", e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-fg-secondary mb-1">光线特性</label>
          <textarea
            value={value.light_behavior || ""}
            onChange={(e) => set("light_behavior", e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-fg-secondary mb-1">
            纹理 / 编织规则
          </label>
          <textarea
            value={value.texture_rules || ""}
            onChange={(e) => set("texture_rules", e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-fg-secondary mb-1">
            禁止画成（反向约束）
          </label>
          <textarea
            value={value.dont_confuse_with || ""}
            onChange={(e) => set("dont_confuse_with", e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !value.name.trim()}
          className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? "保存中..." : submitLabel}
        </button>
      </form>
    </section>
  );
}

function MaterialRow({
  item,
  onPatch,
  onDelete,
}: {
  item: Material;
  onPatch: (id: number, patch: Partial<Material>) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<Omit<Material, "id">>({
    name: item.name,
    english_name: item.english_name,
    aliases: item.aliases,
    description: item.description,
    visual_traits: item.visual_traits,
    light_behavior: item.light_behavior,
    texture_rules: item.texture_rules,
    dont_confuse_with: item.dont_confuse_with,
    sort_order: item.sort_order,
  });

  if (editing) {
    return (
      <li className="p-4 bg-[var(--brand-50-bg)]">
        <MaterialForm
          value={draft}
          onChange={setDraft}
          onSubmit={(e) => {
            e.preventDefault();
            onPatch(item.id, draft);
            setEditing(false);
          }}
          submitting={false}
          submitLabel="保存修改"
        />
        <button
          onClick={() => setEditing(false)}
          className="mt-2 px-3 py-1 text-fg-secondary text-xs rounded hover:bg-bg-tertiary"
        >
          取消编辑
        </button>
      </li>
    );
  }

  return (
    <li className="px-6 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-fg-primary">
              {item.name}
            </span>
            {item.english_name && (
              <span className="text-xs text-fg-tertiary font-mono">
                {item.english_name}
              </span>
            )}
          </div>
          {item.description && (
            <div className="text-xs text-fg-tertiary mt-0.5">
              {item.description}
            </div>
          )}
          {item.aliases && (
            <div className="text-[10px] text-fg-tertiary mt-1">
              匹配词: {item.aliases}
            </div>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-xs text-brand-400 hover:underline"
          >
            {expanded ? "收起详情" : "查看详细属性"}
          </button>
          {expanded && (
            <div className="mt-2 space-y-1 text-xs text-fg-secondary bg-bg-tertiary p-3 rounded border border-border-subtle">
              {item.visual_traits && (
                <div>
                  <b>视觉特征：</b>
                  {item.visual_traits}
                </div>
              )}
              {item.light_behavior && (
                <div>
                  <b>光线特性：</b>
                  {item.light_behavior}
                </div>
              )}
              {item.texture_rules && (
                <div>
                  <b>纹理规则：</b>
                  {item.texture_rules}
                </div>
              )}
              {item.dont_confuse_with && (
                <div className="text-danger">
                  <b>禁止画成：</b>
                  {item.dont_confuse_with}
                </div>
              )}
            </div>
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
            onClick={() => onDelete(item.id)}
            className="text-xs text-danger hover:text-red-800 px-2 py-1"
          >
            删除
          </button>
        </div>
      </div>
    </li>
  );
}
