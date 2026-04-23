"use client";

import { useEffect, useMemo, useState } from "react";

type PoseType = "full" | "half" | "closeup";
type Pose = {
  id: number;
  name: string;
  text: string;
  type: PoseType;
  tags: string | null;
  notes: string | null;
  sort_order: number;
};

const TYPE_LABEL: Record<PoseType, string> = {
  full: "全身",
  half: "半身",
  closeup: "特写",
};

export default function PosesAdminPage() {
  const [poses, setPoses] = useState<Pose[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    text: "",
    type: "full" as PoseType,
    tags: "",
    sort_order: 0,
  });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/poses");
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setPoses(await res.json());
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
    const map: Record<PoseType, Pose[]> = { full: [], half: [], closeup: [] };
    for (const p of poses) map[p.type].push(p);
    return map;
  }, [poses]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/poses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setForm({
        name: "",
        text: "",
        type: form.type,
        tags: "",
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

  async function handleUpdate(id: number, patch: Partial<Pose>) {
    setError(null);
    try {
      const res = await fetch(`/api/poses/${id}`, {
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
    if (!confirm("确定删除这个姿势？")) return;
    try {
      const res = await fetch(`/api/poses/${id}`, { method: "DELETE" });
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
          <h1 className="text-2xl font-bold text-gray-900">姿势库</h1>
          <p className="mt-1 text-sm text-gray-500">
            模特摄影的姿势文字描述。按全身 / 半身 / 特写分组，生成时会作为指令注入 Prompt
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
        >
          {showForm ? "取消" : "+ 添加姿势"}
        </button>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
          {error}
        </div>
      )}

      {showForm && (
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：侧身叉腰"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                类型 <span className="text-red-500">*</span>
              </label>
              <select
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as PoseType })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="full">全身</option>
                <option value="half">半身</option>
                <option value="closeup">特写</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">
                姿势描述 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
                rows={3}
                placeholder="用文字详细描述姿势：身体朝向、手的位置、表情、动态感等..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">标签</label>
              <input
                type="text"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="用逗号分隔：侧身,叉腰"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">排序</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) =>
                  setForm({ ...form, sort_order: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div className="col-span-2">
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "保存中..." : "保存"}
              </button>
            </div>
          </form>
        </section>
      )}

      {(["full", "half", "closeup"] as PoseType[]).map((type) => (
        <section
          key={type}
          className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6"
        >
          <div className="px-6 py-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-800">
              {TYPE_LABEL[type]}
              <span className="ml-2 text-gray-400">
                ({grouped[type].length})
              </span>
            </h2>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-gray-500">加载中...</div>
          ) : grouped[type].length === 0 ? (
            <div className="p-6 text-sm text-gray-500">暂无</div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {grouped[type].map((p) => (
                <PoseRow
                  key={p.id}
                  pose={p}
                  onUpdate={handleUpdate}
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

function PoseRow({
  pose,
  onUpdate,
  onDelete,
}: {
  pose: Pose;
  onUpdate: (id: number, patch: Partial<Pose>) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: pose.name,
    text: pose.text,
    tags: pose.tags || "",
  });

  if (editing) {
    return (
      <li className="px-6 py-4 bg-blue-50">
        <input
          className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <textarea
          className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm"
          rows={3}
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
        <input
          className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm"
          placeholder="标签（逗号分隔）"
          value={draft.tags}
          onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
        />
        <div className="flex gap-2">
          <button
            onClick={() => {
              onUpdate(pose.id, draft);
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
          <div className="text-sm font-medium text-gray-900">{pose.name}</div>
          <div className="text-xs text-gray-600 mt-1 leading-relaxed">
            {pose.text}
          </div>
          {pose.tags && (
            <div className="flex gap-1 mt-1">
              {pose.tags.split(",").map((t, i) => (
                <span
                  key={i}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600"
                >
                  {t.trim()}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1"
          >
            编辑
          </button>
          <button
            onClick={() => onDelete(pose.id)}
            className="text-xs text-red-600 hover:text-red-800 px-2 py-1"
          >
            删除
          </button>
        </div>
      </div>
    </li>
  );
}
