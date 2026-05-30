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
  category: string | null;
  category_label: string | null;
  sort_order: number;
};

const CATEGORY_OPTIONS = [
  { value: "", label: "未分类" },
  { value: "universal", label: "通用" },
  { value: "plus_size", label: "大码" },
  { value: "maternity", label: "孕妇" },
  { value: "teen", label: "青少年" },
];

export default function ModelsAdminPage() {
  const [items, setItems] = useState<Identity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 新增表单
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("");
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
      if (category) fd.append("category", category);
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
      setCategory("");
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
        <h1 className="text-2xl font-bold text-fg-primary">模特形象库</h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          模特的身份参考图（脸 / 肤色 / 发型 / 体型）。
          支持 <strong>PNG（推荐透明底）</strong> 或 <strong>JPG</strong>。
        </p>
        <p className="mt-1 text-xs text-fg-tertiary">
          💡 透明底（PNG 抠图后）合成效果最干净；带背景的图也能用，AI 会自己识别主体。抠图工具推荐：
          <a
            href="https://www.remove.bg/zh"
            target="_blank"
            rel="noopener"
            className="text-brand-400 underline mx-1"
          >
            Remove.bg
          </a>
          ·
          <a
            href="https://www.pixelcut.ai/"
            target="_blank"
            rel="noopener"
            className="text-brand-400 underline mx-1"
          >
            Pixelcut
          </a>
          · Photoshop · Canva
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6 mb-6">
        <h2 className="text-sm font-semibold text-fg-secondary mb-3">
          新增模特形象
        </h2>
        <form onSubmit={handleUpload} className="space-y-3">
          <div>
            <label className="block text-xs text-fg-secondary mb-1">
              图片 <span className="text-danger">*</span>
              <span className="ml-2 text-fg-tertiary font-normal">
                PNG（推荐透明底）/ JPG / WebP
              </span>
            </label>
            <input
              id="identity-file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-fg-secondary
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-medium
                file:bg-[var(--brand-50-bg)] file:text-brand-400
                hover:file:bg-[var(--brand-100-bg)]"
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
              <label className="block text-xs text-fg-secondary mb-1">
                名称 <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：亚洲长发女模 A"
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-fg-secondary mb-1">
                标签（逗号分隔）
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="如：亚洲,长发,清秀"
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-fg-secondary mb-1">分类</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm bg-bg-secondary"
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-fg-secondary mb-1">备注</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-fg-secondary mb-1">排序</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={uploading || !file || !name.trim()}
            className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50"
          >
            {uploading ? "上传中..." : "新增"}
          </button>
        </form>
      </section>

      <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle">
        <div className="px-6 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-fg-secondary">
            已有模特 ({items.length})
          </h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-fg-tertiary">加载中...</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-fg-tertiary">
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
    category: item.category || "",
  });

  return (
    <li className="border border-border-subtle rounded-lg overflow-hidden">
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
            className="w-full px-2 py-1 border border-border-default rounded text-xs"
          />
          <input
            value={draft.tags}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
            placeholder="标签"
            className="w-full px-2 py-1 border border-border-default rounded text-xs"
          />
          <input
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="备注"
            className="w-full px-2 py-1 border border-border-default rounded text-xs"
          />
          <select
            value={draft.category}
            onChange={(e) =>
              setDraft({ ...draft, category: e.target.value })
            }
            className="w-full px-2 py-1 border border-border-default rounded text-xs bg-bg-secondary"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <button
              onClick={() => {
                onPatch(item.id, {
                  ...draft,
                  // category 空字符串显式映射成 null（清空分类）
                  category: draft.category || null,
                });
                setEditing(false);
              }}
              className="flex-1 px-2 py-1 bg-brand-600 text-white text-xs rounded"
            >
              保存
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-2 py-1 text-fg-secondary text-xs rounded hover:bg-bg-tertiary"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3">
          <div className="text-sm font-medium text-fg-primary truncate flex items-center gap-1.5">
            <span className="truncate">{item.name}</span>
            {item.category_label && (
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[var(--brand-50-bg)] text-brand-400 border border-[rgba(59,130,246,0.3)]">
                {item.category_label}
              </span>
            )}
          </div>
          {item.tags && (
            <div className="flex flex-wrap gap-1 mt-1">
              {item.tags.split(",").map((t, i) => (
                <span
                  key={i}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-fg-secondary"
                >
                  {t.trim()}
                </span>
              ))}
            </div>
          )}
          {item.notes && (
            <div className="text-xs text-fg-tertiary mt-1 truncate">
              {item.notes}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-fg-secondary hover:text-fg-primary"
            >
              编辑
            </button>
            <button
              onClick={() => onDelete(item.id)}
              className="text-xs text-danger hover:text-red-800"
            >
              删除
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
