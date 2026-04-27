"use client";

import { useEffect, useMemo, useState } from "react";
import { Landmark, Upload, X } from "lucide-react";
import { Thumbnail, ThumbnailBadge } from "@/app/_components/thumbnail";
import {
  CollapsibleSection,
  Dropzone,
} from "@/app/_components/ui";
import {
  SCENE_CATEGORY_LABELS,
  SCENE_CATEGORY_LIST,
  SCENE_CATEGORY_ORDER,
} from "@/lib/scene-categories";

type Scene = {
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

export default function ScenesAdminPage() {
  const [items, setItems] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>(""); // 空 = 未分类
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
      if (category) fd.append("category", category);
      if (tags.trim()) fd.append("tags", tags.trim());
      if (notes.trim()) fd.append("notes", notes.trim());
      fd.append("sort_order", String(sortOrder));

      const res = await fetch("/api/scenes", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setFile(null);
      setName("");
      setCategory("");
      setTags("");
      setNotes("");
      setSortOrder(0);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function handlePatch(
    id: number,
    patch: Partial<Scene> & { category?: string | null },
  ) {
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

  // 按分类分组
  const groupedItems = useMemo(() => {
    const groups = new Map<string, Scene[]>();
    for (const s of items) {
      const key = s.category || "_uncategorized";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    const ordered = [
      ...SCENE_CATEGORY_ORDER.filter((k) => groups.has(k)),
      // 数据库里出现但常量表里没的（兼容旧数据），按字母序追加
      ...Array.from(groups.keys()).filter(
        (k) =>
          k !== "_uncategorized" && !SCENE_CATEGORY_ORDER.includes(k),
      ),
    ];
    if (groups.has("_uncategorized")) ordered.push("_uncategorized");
    return ordered.map((key) => ({
      key,
      label:
        key === "_uncategorized"
          ? "未分类"
          : SCENE_CATEGORY_LABELS[key] || key,
      items: groups.get(key)!,
    }));
  }, [items]);

  return (
    <main className="mx-auto w-full max-w-7xl p-5 md:p-8">
      <header className="mb-6 flex items-center gap-3">
        <span
          className="w-10 h-10 rounded-md flex items-center justify-center text-white"
          style={{
            background: "var(--brand-gradient)",
            boxShadow: "0 0 16px var(--brand-glow)",
          }}
        >
          <Landmark size={18} strokeWidth={2.2} />
        </span>
        <div>
          <h1 className="text-[22px] font-bold text-fg-primary tracking-tight">
            场景库
          </h1>
          <p className="mt-0.5 text-[13px] text-fg-tertiary">
            拍摄场景的背景图（教堂 / 户外 / 影棚 / 室内）。图里
            <strong className="text-danger mx-0.5">不要有任何人物</strong>
            ，否则会出现"场景里已有人 + 要合成的模特"双人
          </p>
        </div>
      </header>

      {error && (
        <div
          className="mb-4 p-3 rounded-md text-[13px] border"
          style={{
            background: "var(--danger-bg)",
            borderColor: "rgba(239, 68, 68, 0.3)",
            color: "var(--danger)",
          }}
        >
          {error}
        </div>
      )}

      <CollapsibleSection
        title="新增场景"
        description="上传图片 + 选择分类，便于在批量摄影 / 换色页按分类找场景"
        defaultOpen
        className="mb-4"
      >
        <form onSubmit={handleUpload} className="space-y-4">
          {/* 上传 */}
          <div>
            <label className="block text-[12px] text-fg-secondary mb-2">
              场景图（JPG / PNG / WEBP，最大 20MB）
              <span className="text-danger ml-1">*</span>
            </label>
            {file ? (
              <div className="flex items-start gap-3">
                <div className="w-40">
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
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="btn btn-ghost btn-sm"
                >
                  <X size={12} strokeWidth={2.2} />
                  重选
                </button>
              </div>
            ) : (
              <Dropzone
                accept="image/*"
                onFiles={(files) => setFile(files[0] || null)}
                icon={<Upload size={28} strokeWidth={1.6} />}
                title="拖拽 / 点击 / Ctrl+V 上传场景图"
                description="JPG / PNG / WEBP · 最大 20MB"
              />
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] text-fg-secondary mb-1.5">
                名称 <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：西式教堂内景"
                className="input"
              />
            </div>
            <div>
              <label className="block text-[12px] text-fg-secondary mb-1.5">
                分类
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="input select"
              >
                <option value="">未分类</option>
                {SCENE_CATEGORY_LIST.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[12px] text-fg-secondary mb-1.5">
                标签（逗号分隔）
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="如：教堂,室内,彩色玻璃"
                className="input"
              />
            </div>
            <div>
              <label className="block text-[12px] text-fg-secondary mb-1.5">
                排序
              </label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="input"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] text-fg-secondary mb-1.5">
              备注（可选）
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input"
            />
          </div>

          <button
            type="submit"
            disabled={uploading || !file || !name.trim()}
            className="btn btn-primary btn-md"
          >
            {uploading ? "上传中..." : "新增"}
          </button>
        </form>
      </CollapsibleSection>

      <CollapsibleSection
        title="已有场景"
        badge={items.length}
        description="按分类折叠，点击下方组进入"
        defaultOpen
      >
        {loading ? (
          <div className="text-sm text-fg-tertiary py-6">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-fg-tertiary py-6">还没有场景</div>
        ) : (
          <div className="space-y-2">
            {groupedItems.map((g, idx) => (
              <CollapsibleSection
                key={g.key}
                variant="minimal"
                title={g.label}
                badge={g.items.length}
                defaultOpen={idx === 0 || g.items.length <= 3}
              >
                <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-2">
                  {g.items.map((s) => (
                    <SceneCard
                      key={s.id}
                      item={s}
                      onPatch={handlePatch}
                      onDelete={handleDelete}
                    />
                  ))}
                </ul>
              </CollapsibleSection>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </main>
  );
}

function SceneCard({
  item,
  onPatch,
  onDelete,
}: {
  item: Scene;
  onPatch: (
    id: number,
    patch: Partial<Scene> & { category?: string | null },
  ) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: item.name,
    category: item.category || "",
    tags: item.tags || "",
    notes: item.notes || "",
  });

  return (
    <li className="border border-border-subtle rounded-md overflow-hidden bg-bg-card">
      <Thumbnail
        src={item.image_url}
        alt={item.name}
        ratio="3/4"
        fit="contain"
        className="rounded-none border-0"
      />
      {editing ? (
        <div className="p-3 space-y-2">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="input h-8 text-[12px]"
            placeholder="名称"
          />
          <select
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            className="input select h-8 text-[12px]"
          >
            <option value="">未分类</option>
            {SCENE_CATEGORY_LIST.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            value={draft.tags}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
            placeholder="标签"
            className="input h-8 text-[12px]"
          />
          <input
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="备注"
            className="input h-8 text-[12px]"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                onPatch(item.id, {
                  name: draft.name,
                  category: draft.category || null,
                  tags: draft.tags,
                  notes: draft.notes,
                });
                setEditing(false);
              }}
              className="btn btn-primary btn-sm flex-1"
            >
              保存
            </button>
            <button
              onClick={() => setEditing(false)}
              className="btn btn-ghost btn-sm"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[13px] font-medium text-fg-primary truncate">
              {item.name}
            </div>
            {item.category_label && (
              <span className="chip chip-brand text-[10px] shrink-0">
                {item.category_label}
              </span>
            )}
          </div>
          {item.tags && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {item.tags.split(",").map((t, i) => (
                <span key={i} className="chip chip-gray text-[10px]">
                  {t.trim()}
                </span>
              ))}
            </div>
          )}
          {item.notes && (
            <div className="text-[11px] text-fg-tertiary mt-1.5 truncate">
              {item.notes}
            </div>
          )}
          <div className="flex gap-3 mt-2.5">
            <button
              onClick={() => setEditing(true)}
              className="text-[12px] text-fg-secondary hover:text-fg-primary"
            >
              编辑
            </button>
            <button
              onClick={() => onDelete(item.id)}
              className="text-[12px] text-danger hover:opacity-80"
            >
              删除
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
