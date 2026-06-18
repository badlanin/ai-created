"use client";

import { createRef, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

export default function WatermarksAdminPage() {
  const [watermarks, setWatermarks] = useState<Array<{ id: string; name: string; previewUrl: string }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = createRef<HTMLInputElement>();

  async function load() {
    try {
      const res = await fetch("/api/watermark");
      if (!res.ok) return;
      const data = await res.json();
      setWatermarks(data.watermarks || []);
      setLoadError(null);
    } catch {
      setLoadError("加载水印失败");
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!newName.trim()) { setLoadError("请先输入水印名称"); return; }
    if (!file.type.startsWith("image/png")) { setLoadError("水印仅支持 PNG 格式"); return; }
    setUploading(true);
    setLoadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("name", newName.trim());
      const res = await fetch("/api/watermark", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "上传失败");
      setNewName("");
      await load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定删除水印「${name}」？`)) return;
    try {
      const res = await fetch("/api/watermark", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      await load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-fg-primary">品牌水印</h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          上传透明背景 PNG 水印，可上传多个。产品上架时子账户可从列表中选择使用。
        </p>
      </header>

      <section className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-border-subtle bg-bg-secondary p-4 shadow-sm">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-fg-secondary mb-1">水印名称</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="如 FANNYWE / 品牌Logo"
            className="w-full h-9 px-3 rounded-md border border-border-default bg-bg-primary text-sm"
          />
        </div>
        <input
          type="file"
          accept="image/png"
          ref={inputRef}
          onChange={handleUpload}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="shrink-0 h-9 px-4 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50"
        >
          {uploading ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
          上传水印
        </button>
      </section>

      {loadError && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-600">{loadError}</div>
      )}

      {watermarks.length > 0 ? (
        <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {watermarks.map((wm) => (
            <div key={wm.id} className="relative group rounded-lg border border-border-subtle bg-bg-primary p-3 shadow-sm">
              <button
                type="button"
                onClick={() => handleDelete(wm.id, wm.name)}
                className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-white/80 text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                title="删除"
              >
                <Trash2 size={13} />
              </button>
              <div className="h-20 flex items-center justify-center">
                <img src={wm.previewUrl} alt={wm.name} className="max-h-full max-w-full object-contain" />
              </div>
              <p className="mt-2 text-center text-xs text-fg-secondary truncate">{wm.name}</p>
            </div>
          ))}
        </section>
      ) : (
        <div className="rounded-lg border border-dashed border-border-subtle p-12 text-center text-sm text-fg-tertiary">
          暂无水印，请上传透明背景的 PNG 文件
        </div>
      )}
    </main>
  );
}
