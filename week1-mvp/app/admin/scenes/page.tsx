"use client";

import { useEffect, useState } from "react";

type Scene = {
  id: number;
  name: string;
  image_path: string;
  image_url: string;
  tags: string | null;
  notes: string | null;
  sort_order: number;
};

export default function ScenesAdminPage() {
  const [items, setItems] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scenes");
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

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name.trim()) {
      setError("请选择文件并填写名称");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("name", name.trim());
      if (tags.trim()) fd.append("tags", tags.trim());
      if (notes.trim()) fd.append("notes", notes.trim());
      fd.append("sort_order", String(sortOrder));

      const res = await fetch("/api/scenes", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setFile(null);
      setName("");
      setTags("");
      setNotes("");
      setSortOrder(0);
      const input = document.getElementById(
        "scene-file-input",
      ) as HTMLInputElement | null;
      if (input) input.value = "";
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function handlePatch(id: number, patch: Partial<Scene>) {
    try {
      const res = await fetch(`/api/scenes/${id}`, {
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
    if (!confirm("确定删除？图片文件会一起删除")) return;
    try {
      const res = await fetch(`/api/scenes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">场景库</h1>
        <p className="mt-1 text-sm text-gray-500">
          拍摄场景的背景图（教堂 / 户外 / 影棚 / 室内）。图里
          <strong className="text-red-600">不要有任何人物</strong>
          ，否则会出现"场景里已有人 + 要合成的模特"双人
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
          {error}
        </div>
      )}

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">新增场景</h2>
        <form onSubmit={handleUpload} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              场景图（JPG / PNG / WEBP，最大 20MB）{" "}
              <span className="text-red-500">*</span>
            </label>
            <input
              id="scene-file-input"
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-600
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-medium
                file:bg-blue-50 file:text-blue-700
                hover:file:bg-blue-100"
            />
            {file && (
              <div className="mt-2 relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(file)}
                  alt="预览"
                  className="w-48 h-32 object-cover border border-gray-300 rounded"
                />
                <div className="absolute -top-1 -right-1 bg-white text-[10px] px-1 rounded shadow text-gray-600">
                  {(file.size / 1024).toFixed(0)} KB
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：西式教堂内景"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">标签</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="如：教堂,室内,彩色玻璃"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">备注</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">排序</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={uploading || !file || !name.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? "上传中..." : "新增"}
          </button>
        </form>
      </section>

      <section className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700">
            已有场景 ({items.length})
          </h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-gray-500">加载中...</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">还没有场景</div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
            {items.map((s) => (
              <SceneCard
                key={s.id}
                item={s}
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

function SceneCard({
  item,
  onPatch,
  onDelete,
}: {
  item: Scene;
  onPatch: (id: number, patch: Partial<Scene>) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: item.name,
    tags: item.tags || "",
    notes: item.notes || "",
  });

  return (
    <li className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="aspect-video bg-gray-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.image_url}
          alt={item.name}
          className="w-full h-full object-cover"
        />
      </div>
      {editing ? (
        <div className="p-3 space-y-2">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
          />
          <input
            value={draft.tags}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
            placeholder="标签"
            className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
          />
          <input
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="备注"
            className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
          />
          <div className="flex gap-1">
            <button
              onClick={() => {
                onPatch(item.id, draft);
                setEditing(false);
              }}
              className="flex-1 px-2 py-1 bg-blue-600 text-white text-xs rounded"
            >
              保存
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-2 py-1 text-gray-600 text-xs rounded hover:bg-gray-100"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3">
          <div className="text-sm font-medium text-gray-900 truncate">
            {item.name}
          </div>
          {item.tags && (
            <div className="flex flex-wrap gap-1 mt-1">
              {item.tags.split(",").map((t, i) => (
                <span
                  key={i}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600"
                >
                  {t.trim()}
                </span>
              ))}
            </div>
          )}
          {item.notes && (
            <div className="text-xs text-gray-500 mt-1 truncate">
              {item.notes}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-gray-600 hover:text-gray-900"
            >
              编辑
            </button>
            <button
              onClick={() => onDelete(item.id)}
              className="text-xs text-red-600 hover:text-red-800"
            >
              删除
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
