"use client";

import { useEffect, useState } from "react";

type AnalyzeResult = Record<string, string | string[]>;
type AiModel = {
  id: number;
  model_id: string;
  label: string;
  description: string | null;
  badge: string | null;
  is_default: 0 | 1;
};

/**
 * 客户端压缩图片：长边最大 1024 像素，JPEG 质量 0.9
 */
async function resizeImage(file: File, maxSize = 1024): Promise<Blob> {
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
        0.9,
      );
    };
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = URL.createObjectURL(file);
  });
}

export default function AnalyzePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  // 模型选择
  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  const [model, setModel] = useState<string>("");

  useEffect(() => {
    fetch("/api/ai-models?category=vision")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: AiModel[]) => {
        setAiModels(list);
        const def =
          list.find((m) => m.is_default === 1)?.model_id || list[0]?.model_id;
        if (def) setModel(def);
      })
      .catch(() => setAiModels([]));
  }, []);

  function onPickFiles(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list).slice(0, 2);
    setFiles(picked);
    setResult(null);
    setError(null);
  }

  async function handleAnalyze() {
    if (files.length === 0) {
      setError("请至少上传一张服装图");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setElapsed(null);
    const startedAt = Date.now();

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        const blob = await resizeImage(files[i], 1024);
        formData.append(`image${i}`, blob, `image${i}.jpg`);
      }
      if (model) formData.append("model", model);

      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as AnalyzeResult;
      setResult(data);
      setElapsed(Date.now() - startedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-fg-primary">服饰特征解析</h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          上传正面 / 背面图，AI 提取结构化属性
        </p>
      </header>

      <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6">
        {/* 模型选择 */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-fg-secondary mb-2">
            选择解析模型
          </label>
          {aiModels.length === 0 ? (
            <div className="text-xs text-fg-tertiary p-3 bg-bg-tertiary rounded border border-dashed border-border-default">
              暂无可用模型，请让管理员在
              <a href="/admin/ai-models" className="text-brand-400 underline">
                AI 模型管理
              </a>
              中启用至少一个 vision 模型
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {aiModels.map((m) => {
                const active = model === m.model_id;
                return (
                  <button
                    key={m.model_id}
                    type="button"
                    onClick={() => setModel(m.model_id)}
                    className={`text-left p-3 rounded-md border transition ${
                      active
                        ? "border-brand-500 bg-[var(--brand-50-bg)] ring-1 ring-blue-500"
                        : "border-border-default hover:border-border-strong"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fg-primary">
                        {m.label}
                      </span>
                      {m.badge && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-600 text-white">
                          {m.badge}
                        </span>
                      )}
                    </div>
                    {m.description && (
                      <div className="text-xs text-fg-tertiary mt-1">
                        {m.description}
                      </div>
                    )}
                    <div className="text-[10px] text-fg-tertiary font-mono mt-1">
                      {m.model_id}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-fg-secondary mb-2">
            上传服装图（最多 2 张）
          </label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => onPickFiles(e.target.files)}
            className="block w-full text-sm text-fg-secondary
              file:mr-4 file:py-2 file:px-4
              file:rounded-md file:border-0
              file:text-sm file:font-medium
              file:bg-[var(--brand-50-bg)] file:text-brand-400
              hover:file:bg-[var(--brand-100-bg)]"
          />
        </div>

        {files.length > 0 && (
          <div className="flex gap-3 flex-wrap mb-4">
            {files.map((f, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(f)}
                  alt={`预览 ${i + 1}`}
                  className="w-32 h-32 object-cover rounded-md border border-border-subtle"
                />
                <div className="mt-1 text-xs text-fg-tertiary truncate w-32">
                  {f.name}
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleAnalyze}
          disabled={loading || files.length === 0}
          className="inline-flex items-center px-6 py-2
            bg-brand-600 text-white text-sm font-medium rounded-md
            hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed
            transition"
        >
          {loading ? (
            <>
              <span className="inline-block w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
              解析中...
            </>
          ) : (
            "开始解析"
          )}
        </button>

        {error && (
          <div className="mt-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
            <div className="font-medium mb-1">解析失败</div>
            <div className="text-xs whitespace-pre-wrap break-all">{error}</div>
          </div>
        )}

        {result && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-fg-primary">解析结果</h2>
              {elapsed !== null && (
                <span className="text-xs text-fg-tertiary">
                  耗时 {(elapsed / 1000).toFixed(1)}s
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(result)
                .filter(([key]) => !key.startsWith("_"))
                .map(([key, value]) => (
                  <div
                    key={key}
                    className="p-3 bg-bg-tertiary border border-border-subtle rounded"
                  >
                    <div className="text-xs font-medium text-fg-tertiary mb-1">
                      {key}
                    </div>
                    <div className="text-sm text-fg-primary">
                      {Array.isArray(value) ? value.join("、") : String(value)}
                    </div>
                  </div>
                ))}
            </div>

            <details className="mt-4">
              <summary className="text-xs text-fg-tertiary cursor-pointer">
                查看原始 JSON
              </summary>
              <pre className="mt-2 p-3 bg-gray-900 text-green-400 text-xs rounded overflow-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </section>
    </main>
  );
}
