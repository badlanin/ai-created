"use client";

import { useEffect, useMemo, useState } from "react";
import { Landmark, Upload, X, Sparkles, ImageIcon, Folder, FileText } from "lucide-react";
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

type AdminTab = "image" | "text" | "manage" | "categories";

type Scene = {
  id: number;
  name: string;
  image_path: string;
  image_url: string;
  tags: string | null;
  notes: string | null;
  category: string | null;
  category_label: string | null;
  usage: "single" | "poster";
  sort_order: number;
};

const USAGE_LABELS: Record<"single" | "poster", string> = {
  single: "主图",
  poster: "海报",
};

export default function ScenesAdminPage() {
  const [tab, setTab] = useState<AdminTab>("image");
  const [items, setItems] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>(""); // 空 = 未分类
  const [usage, setUsage] = useState<"single" | "poster">("single");
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
      fd.append("usage", usage);
      if (tags.trim()) fd.append("tags", tags.trim());
      if (notes.trim()) fd.append("notes", notes.trim());
      fd.append("sort_order", String(sortOrder));

      const res = await fetch("/api/scenes", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setFile(null);
      setName("");
      setCategory("");
      setUsage("single");
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
            管理拍摄场景库（图片场景 + 文字场景）。
          </p>
        </div>
      </header>

      {/* 4 tab 切换 */}
      <div className="mb-6 flex gap-1 p-1 bg-bg-tertiary border border-border-subtle rounded-md w-fit">
        {(
          [
            { value: "image", label: "新增图片场景", icon: ImageIcon },
            { value: "text", label: "新增文字场景", icon: FileText },
            { value: "manage", label: "场景管理", icon: Folder },
            { value: "categories", label: "分类管理", icon: Sparkles },
          ] as Array<{ value: AdminTab; label: string; icon: typeof ImageIcon }>
        ).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={
                tab === t.value
                  ? "px-3 py-1.5 text-xs rounded bg-brand-500 text-white font-medium inline-flex items-center gap-1.5"
                  : "px-3 py-1.5 text-xs rounded text-fg-secondary hover:text-fg-primary inline-flex items-center gap-1.5"
              }
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* tab 内容：文字场景 / 场景管理 / 分类管理（图片场景的内容在下方 conditional 渲染） */}
      {tab === "text" && <TextSceneNewPanel onSaved={load} />}
      {tab === "manage" && <SceneManagePanel imageScenes={items} onChanged={load} />}
      {tab === "categories" && (
        <div className="p-8 border border-dashed border-border-default rounded text-center text-sm text-fg-tertiary">
          分类管理 tab 还没做完 — 当前 6 个分类（婚礼 / 户外 / 影棚 / 街拍 / 室内 / 花园）写在
          <code className="px-1 mx-1 bg-bg-tertiary rounded text-[11px]">
            lib/scene-categories.ts
          </code>
          ，要增删请直接改代码后 deploy。下一轮迭代会做 DB 版分类管理。
        </div>
      )}

      {tab === "image" && error && (
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

      {tab === "image" && (<>
      <CollapsibleSection
        title="新增图片场景"
        description="上传图片 + 选择分类，便于在批量摄影 / 换色页按分类找场景。图里不要有人物（避免双人合成）"
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
                场景库
              </label>
              <select
                value={usage}
                onChange={(e) =>
                  setUsage(e.target.value as "single" | "poster")
                }
                className="input select"
              >
                <option value="single">主图场景库（批量摄影 / 背景换图用）</option>
                <option value="poster">海报大场景库（多人氛围 / 社媒用）</option>
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
      </>)}
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
            <div className="flex gap-1 shrink-0">
              <span
                className={`chip text-[10px] ${
                  item.usage === "poster" ? "chip-warn" : "chip-success"
                }`}
                title={
                  item.usage === "poster"
                    ? "海报大场景库（不会出现在批量摄影里）"
                    : "主图场景库（批量摄影/背景换图用）"
                }
              >
                {USAGE_LABELS[item.usage]}
              </span>
              {item.category_label && (
                <span className="chip chip-brand text-[10px]">
                  {item.category_label}
                </span>
              )}
            </div>
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
              onClick={() =>
                onPatch(item.id, {
                  usage: item.usage === "single" ? "poster" : "single",
                })
              }
              className="text-[12px] text-fg-secondary hover:text-fg-primary"
              title="切换主图/海报库"
            >
              切换 → {item.usage === "single" ? "海报" : "主图"}
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

/* ─────────── Tab 2：新增文字场景 ─────────── */

interface TextScenePresetRow {
  id: number;
  name: string;
  group: string | null;
  text: string;
  thumb: string | null;
  notes: string | null;
  sort_order: number;
}

const KNOWN_GROUPS = [
  "法式门厅",
  "古典宫廷",
  "复古沙龙",
  "庄园楼梯",
  "地中海阳台",
  "户外花园",
  "极简棚拍",
];

function TextSceneNewPanel({ onSaved }: { onSaved?: () => void }) {
  const [refImage, setRefImage] = useState<File | null>(null);
  const [refUrl, setRefUrl] = useState<string>("");
  const [thumbImage, setThumbImage] = useState<File | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string>("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzedRaw, setAnalyzedRaw] = useState<string>("");

  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  function onPickRef(files: File[]) {
    const f = files[0];
    if (!f) return;
    if (refUrl) URL.revokeObjectURL(refUrl);
    setRefImage(f);
    setRefUrl(URL.createObjectURL(f));
    setErr(null);
  }
  function onPickThumb(files: File[]) {
    const f = files[0];
    if (!f) return;
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    setThumbImage(f);
    setThumbUrl(URL.createObjectURL(f));
  }

  async function handleAnalyze() {
    if (!refImage) {
      setErr("请先上传一张参考场景图");
      return;
    }
    setErr(null);
    setOkMsg(null);
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("image", refImage, refImage.name);
      const res = await fetch("/api/text-scenes/analyze", {
        method: "POST",
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setName(body.name || "");
      setGroup(body.group || "");
      setText(body.text || "");
      setAnalyzedRaw(JSON.stringify(body, null, 2));
      // 如果还没设 thumb，自动用参考图作为缩略图候选
      if (!thumbImage && refImage) {
        setThumbImage(refImage);
        if (thumbUrl) URL.revokeObjectURL(thumbUrl);
        setThumbUrl(URL.createObjectURL(refImage));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSave() {
    if (!name.trim() || !text.trim()) {
      setErr("name 和 text 都必填");
      return;
    }
    setErr(null);
    setOkMsg(null);
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("group", group.trim());
      fd.append("text", text.trim());
      if (notes.trim()) fd.append("notes", notes.trim());
      if (thumbImage) fd.append("thumb", thumbImage, thumbImage.name);
      const res = await fetch("/api/text-scenes", {
        method: "POST",
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setOkMsg(`已保存"${body.name}"到文字场景库（id=${body.id}）`);
      // 重置表单
      setRefImage(null);
      if (refUrl) URL.revokeObjectURL(refUrl);
      setRefUrl("");
      setThumbImage(null);
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      setThumbUrl("");
      setName("");
      setGroup("");
      setText("");
      setNotes("");
      setAnalyzedRaw("");
      onSaved?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="p-4 bg-bg-secondary border border-border-subtle rounded-lg">
        <h3 className="text-sm font-semibold text-fg-primary mb-3">
          ① 上传参考场景图（AI 会解析提取场景信息）
        </h3>
        {!refImage ? (
          <Dropzone
            accept="image/*"
            onFiles={onPickRef}
            icon={<Upload size={20} strokeWidth={1.6} />}
            title="拖拽 / 点击 / Ctrl+V 粘贴一张参考场景图"
            description="PNG / JPG / WebP · 限 20MB · 建议无人物的纯场景"
            compact
          />
        ) : (
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={refUrl}
              alt="参考图"
              className="w-32 h-44 object-cover rounded border border-border-subtle"
            />
            <div className="flex-1">
              <div className="text-xs text-fg-secondary mb-1">
                {refImage.name} · {(refImage.size / 1024).toFixed(0)} KB
              </div>
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="btn btn-primary btn-sm"
              >
                {analyzing ? (
                  <>
                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    分析中…（约 5-15 秒）
                  </>
                ) : (
                  <>
                    <Sparkles size={12} strokeWidth={2.2} />
                    AI 解析场景
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  if (refUrl) URL.revokeObjectURL(refUrl);
                  setRefImage(null);
                  setRefUrl("");
                }}
                className="btn btn-ghost btn-sm ml-2"
              >
                <X size={12} />
                换一张
              </button>
              <p className="text-[10px] text-fg-muted mt-1.5">
                调用 Gemini Flash 视觉模型解析（约 ¥0.01 / 次）。也可以跳过 AI 直接手填下方字段。
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-bg-secondary border border-border-subtle rounded-lg space-y-3">
        <h3 className="text-sm font-semibold text-fg-primary">
          ② 编辑场景信息（AI 解析后可改，也可手填）
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-fg-tertiary mb-1">
              短名（必填）
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 30))}
              placeholder="例：粉色法式门厅"
              className="input text-sm h-9"
            />
          </div>
          <div>
            <label className="block text-[11px] text-fg-tertiary mb-1">
              调性分组
            </label>
            <input
              type="text"
              value={group}
              onChange={(e) => setGroup(e.target.value.slice(0, 20))}
              list="known-groups"
              placeholder="选已有或新建"
              className="input text-sm h-9"
            />
            <datalist id="known-groups">
              {KNOWN_GROUPS.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-fg-tertiary mb-1">
            完整场景描述（必填，120-200 字）
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 1000))}
            placeholder="主体场景 + 关键物件 + 光线 + 调性..."
            rows={6}
            className="input text-sm w-full resize-none"
          />
          <div className="text-[10px] text-fg-muted mt-0.5 text-right">
            {text.length}/1000
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-fg-tertiary mb-1">
            备注（可选）
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 200))}
            placeholder="内部记录用，不参与 prompt"
            className="input text-sm h-9"
          />
        </div>

        <div>
          <label className="block text-[11px] text-fg-tertiary mb-1">
            缩略图（可选，不参与 prompt，UI 选择用；不传则用参考图）
          </label>
          {!thumbImage ? (
            <Dropzone
              accept="image/*"
              onFiles={onPickThumb}
              icon={<ImageIcon size={16} strokeWidth={1.6} />}
              title="拖入缩略图"
              description="可跟参考图相同；建议 3:4 比例"
              compact
            />
          ) : (
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbUrl}
                alt="thumb"
                className="w-12 h-16 object-cover rounded border border-border-subtle"
              />
              <span className="text-xs text-fg-secondary flex-1">
                {thumbImage.name}
              </span>
              <button
                onClick={() => {
                  if (thumbUrl) URL.revokeObjectURL(thumbUrl);
                  setThumbImage(null);
                  setThumbUrl("");
                }}
                className="btn btn-ghost btn-sm"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      </div>

      {err && (
        <div className="p-3 rounded text-[12px] bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger">
          {err}
        </div>
      )}
      {okMsg && (
        <div className="p-3 rounded text-[12px] bg-[var(--success-bg)] border border-[rgba(34,197,94,0.3)] text-success">
          {okMsg}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !name.trim() || !text.trim()}
        className="btn btn-primary"
      >
        {saving ? "保存中…" : "保存到文字场景库"}
      </button>

      {analyzedRaw && (
        <details className="mt-2">
          <summary className="text-[11px] text-fg-tertiary cursor-pointer">
            Gemini 解析原始返回（debug）
          </summary>
          <pre className="mt-1 p-2 bg-bg-tertiary border border-border-subtle rounded text-[10px] overflow-auto max-h-40">
            {analyzedRaw}
          </pre>
        </details>
      )}
    </div>
  );
}

/* ─────────── Tab 3：场景管理（文字场景列表 + 编辑/删除） ─────────── */

function SceneManagePanel({
  imageScenes,
  onChanged,
}: {
  imageScenes: Scene[];
  onChanged?: () => void;
}) {
  const [textScenes, setTextScenes] = useState<TextScenePresetRow[]>([]);
  const [loadingText, setLoadingText] = useState(true);

  const loadText = async () => {
    setLoadingText(true);
    try {
      const res = await fetch("/api/text-scenes");
      if (!res.ok) return;
      const data = await res.json();
      setTextScenes(Array.isArray(data) ? data : []);
    } finally {
      setLoadingText(false);
    }
  };

  useEffect(() => {
    loadText();
  }, []);

  const handleDeleteText = async (id: number, name: string) => {
    if (!confirm(`确认删除文字场景"${name}"？`)) return;
    const res = await fetch(`/api/text-scenes/${id}`, { method: "DELETE" });
    if (res.ok) loadText();
    else {
      const body = await res.json();
      alert(body.error || "删除失败");
    }
  };

  return (
    <div className="space-y-6">
      {/* 文字场景列表 */}
      <div>
        <h3 className="text-sm font-semibold text-fg-primary mb-2">
          文字场景库（{textScenes.length}）
        </h3>
        {loadingText ? (
          <div className="text-sm text-fg-tertiary">加载中…</div>
        ) : textScenes.length === 0 ? (
          <div className="text-sm text-fg-tertiary">
            还没有文字场景。去"新增文字场景" tab 添加。
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {textScenes.map((t) => (
              <div
                key={t.id}
                className="p-2 bg-bg-secondary border border-border-subtle rounded text-[12px]"
              >
                {t.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.thumb}
                    alt={t.name}
                    className="w-full aspect-[3/4] object-cover rounded mb-1.5"
                  />
                ) : (
                  <div className="w-full aspect-[3/4] bg-bg-tertiary rounded mb-1.5 flex items-center justify-center text-[10px] text-fg-muted">
                    无缩略图
                  </div>
                )}
                <div className="font-medium text-fg-primary truncate">
                  {t.name}
                </div>
                <div className="text-[10px] text-fg-tertiary mb-1">
                  {t.group || "未分类"}
                </div>
                <div className="text-[10px] text-fg-muted line-clamp-2 mb-1.5">
                  {t.text}
                </div>
                <button
                  onClick={() => handleDeleteText(t.id, t.name)}
                  className="text-[10px] text-danger hover:underline"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 图片场景列表（只读链接到 tab 1） */}
      <div>
        <h3 className="text-sm font-semibold text-fg-primary mb-2">
          图片场景库（{imageScenes.length}）
        </h3>
        <p className="text-[11px] text-fg-muted mb-2">
          图片场景的增删改在"新增图片场景" tab 里做（保留现有 UI 不动）。
        </p>
        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-1.5">
          {imageScenes.slice(0, 28).map((s) => (
            <div
              key={s.id}
              className="aspect-[3/4] rounded overflow-hidden border border-border-subtle relative group"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.image_url}
                alt={s.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1 py-0.5">
                <div className="text-[10px] text-white truncate">{s.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
