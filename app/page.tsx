"use client";

import { useState } from "react";

type AnalyzeResult = Record<string, string | string[]>;

/**
 * 客户端压缩图片：长边最大 1024 像素，JPEG 质量 0.9
 * 避免上传过大图片导致内存问题
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

export default function HomePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

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
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            伴娘服 AI 图像工具
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Week 1 MVP · 服饰特征视觉解析
          </p>
        </header>

        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              上传服装图（支持正面 / 背面，最多 2 张）
            </label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onPickFiles(e.target.files)}
              className="block w-full text-sm text-gray-600
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-medium
                file:bg-blue-50 file:text-blue-700
                hover:file:bg-blue-100"
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
                    className="w-32 h-32 object-cover rounded-md border border-gray-200"
                  />
                  <div className="mt-1 text-xs text-gray-500 truncate w-32">
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
              bg-blue-600 text-white text-sm font-medium rounded-md
              hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
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
            <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
              <div className="font-medium mb-1">解析失败</div>
              <div className="text-xs whitespace-pre-wrap break-all">{error}</div>
            </div>
          )}

          {result && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-900">
                  解析结果
                </h2>
                {elapsed !== null && (
                  <span className="text-xs text-gray-500">
                    耗时 {(elapsed / 1000).toFixed(1)}s
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(result).map(([key, value]) => (
                  <div
                    key={key}
                    className="p-3 bg-gray-50 border border-gray-200 rounded"
                  >
                    <div className="text-xs font-medium text-gray-500 mb-1">
                      {key}
                    </div>
                    <div className="text-sm text-gray-900">
                      {Array.isArray(value) ? value.join("、") : String(value)}
                    </div>
                  </div>
                ))}
              </div>

              <details className="mt-4">
                <summary className="text-xs text-gray-500 cursor-pointer">
                  查看原始 JSON
                </summary>
                <pre className="mt-2 p-3 bg-gray-900 text-green-400 text-xs rounded overflow-auto">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </section>

        <footer className="mt-8 text-center text-xs text-gray-400">
          Week 1 MVP · 仅用于团队内部测试
        </footer>
      </div>
    </main>
  );
}
