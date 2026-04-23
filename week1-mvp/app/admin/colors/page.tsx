"use client";

import { useEffect, useState } from "react";

type Color = {
  id: number;
  name: string;
  hex: string;
  sort_order: number;
};

export default function ColorsAdminPage() {
  const [colors, setColors] = useState<Color[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 新增表单
  const [newName, setNewName] = useState("");
  const [newHex, setNewHex] = useState("#D4A574");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/colors");
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setColors(await res.json());
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
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/colors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          hex: newHex,
          sort_order: colors.length,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setNewName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("确定删除这个颜色？")) return;
    try {
      const res = await fetch(`/api/colors/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleUpdate(id: number, patch: Partial<Color>) {
    try {
      const res = await fetch(`/api/colors/${id}`, {
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

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">颜色库管理</h1>
        <p className="mt-1 text-sm text-gray-500">
          常用颜色预设，换色时直接选择，避免每次手填 HEX
        </p>
      </header>

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">新增颜色</h2>
        <form
          onSubmit={handleCreate}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-600 mb-1">名称</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="如：香槟金"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">HEX</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={newHex}
                onChange={(e) => setNewHex(e.target.value.toUpperCase())}
                className="w-10 h-10 border border-gray-300 rounded cursor-pointer"
              />
              <input
                type="text"
                value={newHex}
                onChange={(e) => setNewHex(e.target.value.toUpperCase())}
                className="w-28 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? "保存中..." : "新增"}
          </button>
        </form>
      </section>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
          {error}
        </div>
      )}

      <section className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700">
            已有颜色 ({colors.length})
          </h2>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-gray-500">加载中...</div>
        ) : colors.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">
            还没有颜色，先在上面新增几个常用色
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {colors.map((c) => (
              <ColorRow
                key={c.id}
                color={c}
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

function ColorRow({
  color,
  onUpdate,
  onDelete,
}: {
  color: Color;
  onUpdate: (id: number, patch: Partial<Color>) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(color.name);
  const [hex, setHex] = useState(color.hex);

  return (
    <li className="px-6 py-3 flex items-center gap-4">
      <div
        className="w-10 h-10 rounded border border-gray-200 shrink-0"
        style={{ backgroundColor: color.hex }}
      />
      {editing ? (
        <>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
          />
          <input
            type="color"
            value={hex}
            onChange={(e) => setHex(e.target.value.toUpperCase())}
            className="w-8 h-8 border rounded cursor-pointer"
          />
          <input
            type="text"
            value={hex}
            onChange={(e) => setHex(e.target.value.toUpperCase())}
            className="w-24 px-2 py-1 border border-gray-300 rounded text-sm font-mono"
          />
          <button
            onClick={() => {
              onUpdate(color.id, { name, hex });
              setEditing(false);
            }}
            className="px-3 py-1 bg-blue-600 text-white text-xs rounded"
          >
            保存
          </button>
          <button
            onClick={() => {
              setName(color.name);
              setHex(color.hex);
              setEditing(false);
            }}
            className="px-3 py-1 text-gray-600 text-xs rounded hover:bg-gray-100"
          >
            取消
          </button>
        </>
      ) : (
        <>
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">
              {color.name}
            </div>
            <div className="text-xs text-gray-500 font-mono">{color.hex}</div>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1"
          >
            编辑
          </button>
          <button
            onClick={() => onDelete(color.id)}
            className="text-xs text-red-600 hover:text-red-800 px-2 py-1"
          >
            删除
          </button>
        </>
      )}
    </li>
  );
}
