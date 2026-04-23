"use client";

import { useEffect, useState } from "react";
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL } from "@/lib/image-models";

type Color = { id: number; name: string; hex: string };

type RecolorResult = {
  color_id: number;
  color_name: string;
  hex: string;
  success: boolean;
  image_url?: string;
  error?: string;
};

/**
 * 客户端压缩图片（和 analyze 页一致）
 * 换色不用压太狠，长边 1280 效果更好
 */
async function resizeImage(file: File, maxSize = 1280): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas 不可用"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("压缩失败"))),
        "image/jpeg",
        0.92,
      );
    };
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = URL.createObjectURL(file);
  });
}

export default function RecolorPage() {
  const [colors, setColors] = useState<Color[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RecolorResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  // 自定义颜色
  const [customName, setCustomName] = useState("");
  const [customHex, setCustomHex] = useState("#722F37");

  // 模型选择
  const [model, setModel] = useState<string>(DEFAULT_IMAGE_MODEL);

  useEffect(() => {
    fetch("/api/colors")
      .then((r) => (r.ok ? r.json() : []))
      .then(setColors)
      .catch(() => setColors([]));
  }, []);

  function toggleColor(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (!file) {
      setError("请先上传产品图");
      return;
    }
    const useCustom = customName.trim().length > 0;
    if (selectedIds.size === 0 && !useCustom) {
      setError("请至少选择一个颜色，或填一个临时颜色");
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);
    setElapsed(null);
    const startedAt = Date.now();

    try {
      const blob = await resizeImage(file, 1280);
      const formData = new FormData();
      formData.append("image", blob, file.name);
      if (selectedIds.size > 0) {
        formData.append("color_ids", JSON.stringify([...selectedIds]));
      }
      if (useCustom) {
        formData.append(
          "custom_colors",
          JSON.stringify([{ name: customName.trim(), hex: customHex }]),
        );
      }
      formData.append("model", model);

      const res = await fetch("/api/recolor", {
        method: "POST",
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setResults(body.results as RecolorResult[]);
      setElapsed(Date.now() - startedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">HEX 精准换色</h1>
        <p className="mt-1 text-sm text-gray-500">
          上传一张产品图，选择目标颜色，批量生成同款不同颜色
        </p>
      </header>

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        {/* 上传原图 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            1. 上传产品图
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setFile(f);
              setResults(null);
            }}
            className="block w-full text-sm text-gray-600
              file:mr-4 file:py-2 file:px-4
              file:rounded-md file:border-0
              file:text-sm file:font-medium
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100"
          />
          {file && (
            <div className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={URL.createObjectURL(file)}
                alt="原图预览"
                className="w-40 h-40 object-cover rounded-md border border-gray-200"
              />
            </div>
          )}
        </div>

        {/* 模型选择 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            2. 选择生成模型
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {IMAGE_MODELS.map((m) => {
              const active = model === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModel(m.id)}
                  className={`text-left p-3 rounded-md border transition ${
                    active
                      ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                      : "border-gray-300 hover:border-gray-400"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {m.label}
                    </span>
                    {m.badge && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600 text-white">
                        {m.badge}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{m.desc}</div>
                  <div className="text-[10px] text-gray-400 font-mono mt-1">
                    {m.id}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            如果生成失败报「模型不存在」，说明当前区域暂未上线该模型，换另一个试试
          </p>
        </div>

        {/* 选择颜色 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            3. 选择目标颜色（可多选）
          </label>
          {colors.length === 0 ? (
            <div className="text-xs text-gray-500 p-3 bg-gray-50 rounded border border-dashed border-gray-300">
              颜色库还是空的，
              <a href="/admin/colors" className="text-blue-600 underline">
                去添加
              </a>
              ，或者使用下面的「临时颜色」
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {colors.map((c) => {
                const active = selectedIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleColor(c.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition ${
                      active
                        ? "border-blue-500 bg-blue-50 text-blue-800"
                        : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-gray-300 shrink-0"
                      style={{ backgroundColor: c.hex }}
                    />
                    <span>{c.name}</span>
                    <span className="text-xs text-gray-500 font-mono">
                      {c.hex}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex items-end gap-3 p-3 bg-gray-50 rounded border border-gray-200">
            <div className="flex-1">
              <label className="block text-xs text-gray-600 mb-1">
                临时颜色名（选填，不保存到库里）
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="如：酒红"
                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">HEX</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={customHex}
                  onChange={(e) => setCustomHex(e.target.value.toUpperCase())}
                  className="w-8 h-8 border border-gray-300 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={customHex}
                  onChange={(e) => setCustomHex(e.target.value.toUpperCase())}
                  className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || !file}
          className="inline-flex items-center px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <span className="inline-block w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
              生成中（每张约 10-15 秒）...
            </>
          ) : (
            `开始换色 (${selectedIds.size + (customName.trim() ? 1 : 0)} 张)`
          )}
        </button>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
            <div className="font-medium mb-1">失败</div>
            <div className="text-xs whitespace-pre-wrap break-all">{error}</div>
          </div>
        )}
      </section>

      {results && (
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">生成结果</h2>
            {elapsed !== null && (
              <span className="text-xs text-gray-500">
                总耗时 {(elapsed / 1000).toFixed(1)}s · 共 {results.length} 张
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((r, i) => (
              <div
                key={i}
                className="border border-gray-200 rounded-md overflow-hidden"
              >
                <div className="aspect-square bg-gray-100 flex items-center justify-center">
                  {r.success && r.image_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={r.image_url}
                      alt={r.color_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-xs text-red-600 p-4 text-center">
                      失败：{r.error || "未知错误"}
                    </div>
                  )}
                </div>
                <div className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-4 h-4 rounded border border-gray-200"
                      style={{ backgroundColor: r.hex }}
                    />
                    <span className="text-sm text-gray-900">
                      {r.color_name}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">
                      {r.hex}
                    </span>
                  </div>
                  {r.success && r.image_url && (
                    <a
                      href={r.image_url}
                      download={`recolor_${r.color_name}.png`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      下载
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
