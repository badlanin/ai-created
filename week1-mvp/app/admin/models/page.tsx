"use client";

import { useEffect, useState } from "react";
import { Thumbnail, ThumbnailBadge } from "@/app/_components/thumbnail";

type Identity = {
  id: number;
  name: string;
  image_path: string;
  image_url: string;
  tags: string | null;
  notes: string | null;
  sort_order: number;
};

export default function ModelsAdminPage() {
  const [items, setItems] = useState<Identity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 新增表单
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
      const res = await fetch("/api/identities");
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

      const res = await fetch("/api/identities", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setFile(null);
      setName("");
      setTags("");
      setNotes("");
      setSortOrder(0);
      // reset file input
      const input = document.getElementById("identity-file-input") as HTMLInputElement | null;
      if (input) input.value = "";
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function handlePatch(id: number, patch: Partial<Identity>) {
    try {
      const res = await fetch(`/api/identities/${id}`, {
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
      const res = await fetch(`/api/identities/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">模特形象库</h1>
        <p className="mt-1 text-sm text-gray-500">
          模特的身份参考图（脸 / 肤色 / 发型 / 体型）。
          支持 <strong>PNG（推荐透明底）</strong> 或 <strong>JPG</strong>。
        </p>
        <p className="mt-1 text-xs text-gray-500">
          💡 透明底（PNG 抠图后）合成效果最干净；带背景的图也能用，AI 会自己识别主体。抠图工具推荐：
          <a
            href="https://www.remove.bg/zh"
            target="_blank"
            rel="noopener"
            className="text-blue-600 underline mx-1"
          >
            Remove.bg
          </a>
          ·
          <a
            href="https://www.pixelcut.ai/"
            target="_blank"
            rel="noopener"
            className="text-blue-600 underline mx-1"
          >
            Pixelcut
          </a>
          · Photoshop · Canva
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
          {error}
        </div>
      )}

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          新增模特形象
        </h2>
        <form onSubmit={handleUpload} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              图片 <span className="text-red-500">*</span>
              <span className="ml-2 text-gray-400 font-normal">
                PNG（推荐透明底）/ JPG / WebP
              </span>
            </label>
            <input
              id="identity-file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-600
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-medium
                file:bg-blue-50 file:text-blue-700
                hover:file:bg-blue-100"
            />
            {file && (
              <div className="mt-2 relative inline-block w-40">
                <Thumbnail
                  src={URL.createObjectURL(file)}
                  alt="预览"
                  ratio="3/4"
                  fit="contain"
                  badge={
                    <ThumbnailBadge tone="gray">
                      {(file.size / 1024).toFixed(0)} KB
                    </ThumbnailBadge>
                  }
                />
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
                placeholder="如：亚洲长发女模 A"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                标签（逗号分隔）
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="如：亚洲,长发,清秀"
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
            已有模特 ({items.length})
          </h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-gray-500">加载中...</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">
            还没有模特，先上传至少一个
          </div>
        ) : (
          <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
            {items.map((m) => (
              <IdentityCard
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

function IdentityCard({
  item,
  onPatch,
  onDelete,
}: {
  item: Identity;
  onPatch: (id: number, patch: Partial<Identity>) => void;
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
      <Thumbnail
        src={item.image_url}
        alt={item.name}
        ratio="3/4"
        fit="contain"
        className="rounded-none"
      />
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
