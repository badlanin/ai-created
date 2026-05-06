"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  Upload,
  Download,
  RefreshCw,
  ImageIcon,
  X,
} from "lucide-react";
import { Thumbnail, ThumbnailBadge } from "@/app/_components/thumbnail";

/* ─────────────────────────────────────────────────────────
 *  类型
 * ───────────────────────────────────────────────────────── */

type Scene = {
  id: number;
  name: string;
  image_url: string;
  usage: "single" | "poster";
  category_label: string | null;
};

type PosterResult = {
  result_id: string;
  result_image_url: string;
  tokens: { prompt: number; completion: number };
  scene: { id: number; name: string };
  source_count: number;
  composition: string;
  aspect_ratio: string;
};

type Composition = "static" | "gathering";

const COMPOSITION_OPTIONS: Array<{
  value: Composition;
  label: string;
  desc: string;
}> = [
  {
    value: "static",
    label: "分区站位",
    desc: "每人占一区，无重叠 · 最稳",
  },
  {
    value: "gathering",
    label: "松散群组",
    desc: "可对视、轻接触 · 中等难度",
  },
];

const ASPECT_RATIOS = [
  { value: "16:9", label: "16:9 横（PC Hero）" },
  { value: "9:16", label: "9:16 竖（手机 Hero / 海报）" },
  { value: "1:1", label: "1:1 方（社媒 KV）" },
  { value: "21:9", label: "21:9 超宽 banner" },
  { value: "4:3", label: "4:3 横" },
  { value: "3:2", label: "3:2 横" },
];

const MAX_SOURCES = 5;

/* ─────────────────────────────────────────────────────────
 *  页面主体
 * ───────────────────────────────────────────────────────── */

export default function PosterPage() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loadingScenes, setLoadingScenes] = useState(true);

  // 表单
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [sourceUrls, setSourceUrls] = useState<string[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [composition, setComposition] = useState<Composition>("static");
  const [userHint, setUserHint] = useState("");

  // 状态
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PosterResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 加载 scenes（all usage —— 海报场景倾向 poster 库但 single 也能强行用）
  useEffect(() => {
    fetch("/api/scenes")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Scene[]) => setScenes(data))
      .catch(() => {})
      .finally(() => setLoadingScenes(false));
  }, []);

  // 维护 sourceUrls
  useEffect(() => {
    const urls = sourceFiles.map((f) => URL.createObjectURL(f));
    setSourceUrls(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [sourceFiles]);

  function onPickSources(files: FileList | null) {
    if (!files || files.length === 0) return;
    const valid: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.type.startsWith("image/")) valid.push(f);
    }
    if (valid.length === 0) {
      setError("请上传图片格式（PNG / JPG / WebP）");
      return;
    }
    setSourceFiles((prev) => [...prev, ...valid].slice(0, MAX_SOURCES));
    setError(null);
    setResult(null);
  }

  function removeSource(index: number) {
    setSourceFiles((prev) => prev.filter((_, i) => i !== index));
    setResult(null);
  }

  async function handleSubmit() {
    if (sourceFiles.length === 0) {
      setError("请至少上传 1 张原片");
      return;
    }
    if (!selectedSceneId) {
      setError("请选 1 张场景图");
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const fd = new FormData();
      sourceFiles.forEach((f, i) => {
        fd.append(`source_image${i}`, f, f.name || `source${i}.jpg`);
      });
      fd.append("scene_id", String(selectedSceneId));
      fd.append("aspect_ratio", aspectRatio);
      fd.append("composition", composition);
      if (userHint.trim()) fd.append("user_hint", userHint.trim());

      const res = await fetch("/api/scene-tools/poster", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || res.statusText);
      }
      const data = (await res.json()) as PosterResult;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // 估算成本：Pro 4K ~ ¥1.7
  const estCostCny =
    result &&
    (
      ((result.tokens.prompt * 2 + result.tokens.completion * 120) /
        1_000_000) *
      6.83
    ).toFixed(2);

  return (
    <main className="max-w-7xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-fg-primary flex items-center gap-2">
          <Sparkles size={20} className="text-brand-400" strokeWidth={2.2} />
          氛围海报（KV / Banner）
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          上传 1-5 张已有的产品成片 → 选 1 张场景（推荐海报库的 16:9 大场景）→
          AI 把这些人合成到一张 editorial 大片里。适合网站 hero、横幅 KV、营销海报。
        </p>
        <p className="mt-1 text-[11px] text-fg-muted">
          Pro 模型 + 4K ≈ ¥1.7/张。多人合成是 AI 弱项 —— 第一版可能要试 2-3 次挑最好的。
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左：原片上传 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ① 上传原片
            <span className="ml-2 text-[11px] text-fg-tertiary font-normal">
              {sourceFiles.length}/{MAX_SOURCES} · 每张 1 位模特 + 服装
            </span>
          </h2>

          {sourceFiles.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {sourceUrls.map((url, i) => (
                <div
                  key={i}
                  className="relative aspect-[3/4] rounded border border-border-subtle overflow-hidden bg-bg-tertiary"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`原片 ${i + 1}`}
                    className="w-full h-full object-contain"
                  />
                  <div
                    className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-white text-[10px] font-medium"
                    style={{ background: "rgba(0,0,0,0.6)" }}
                  >
                    {i + 1}
                  </div>
                  <button
                    onClick={() => removeSource(i)}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/70 text-white rounded flex items-center justify-center hover:bg-black/90"
                    title="删除"
                  >
                    <X size={11} strokeWidth={2.4} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {sourceFiles.length < MAX_SOURCES && (
            <label className="block">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => onPickSources(e.target.files)}
                className="hidden"
              />
              <div className="border border-dashed border-border-default rounded p-6 text-center cursor-pointer hover:border-brand-400 hover:bg-bg-hover transition-colors">
                <Upload
                  size={20}
                  strokeWidth={1.6}
                  className="text-fg-tertiary mx-auto mb-1"
                />
                <div className="text-[12px] text-fg-primary">
                  {sourceFiles.length === 0
                    ? "点击上传 1-5 张原片"
                    : `继续添加（还可加 ${MAX_SOURCES - sourceFiles.length} 张）`}
                </div>
                <div className="text-[10px] text-fg-muted mt-1">
                  支持一次选多张 · PNG / JPG / WebP · 限 20MB / 张
                </div>
              </div>
            </label>
          )}

          <div className="text-[10px] text-fg-muted mt-3 leading-relaxed">
            💡 推荐用之前 <a href="/batch-photo" className="text-brand-400 hover:underline">批量摄影</a> 出过的多 SKU 成片。
            每张图里的模特+服装会被保留，多人合成到海报里。
          </div>
        </section>

        {/* 中：场景选择 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ② 选场景
            <span className="ml-2 text-[11px] text-fg-tertiary font-normal">
              推荐选海报库（叙事完整）
            </span>
          </h2>
          {loadingScenes ? (
            <div className="text-sm text-fg-tertiary py-6 text-center">
              加载中...
            </div>
          ) : scenes.length === 0 ? (
            <div className="text-sm text-fg-tertiary p-4 border border-dashed border-border-default rounded">
              场景库为空，
              <a
                href="/admin/scenes"
                className="text-brand-400 hover:underline ml-1"
              >
                去添加
              </a>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 max-h-[480px] overflow-y-auto pr-1">
              {scenes.map((s) => (
                <div key={s.id} className="relative">
                  <Thumbnail
                    src={s.image_url}
                    alt={s.name}
                    ratio="3/4"
                    fit="contain"
                    selected={selectedSceneId === s.id}
                    onClick={() => setSelectedSceneId(s.id)}
                    badge={
                      selectedSceneId === s.id ? (
                        <ThumbnailBadge tone="blue">已选</ThumbnailBadge>
                      ) : undefined
                    }
                  />
                  <span
                    className={`absolute top-1 left-1 chip text-[9px] ${
                      s.usage === "poster" ? "chip-warn" : "chip-success"
                    }`}
                    style={{ pointerEvents: "none" }}
                  >
                    {s.usage === "poster" ? "海报" : "主图"}
                  </span>
                </div>
              ))}
            </div>
          )}
          {selectedSceneId && (
            <div className="mt-3 text-[12px] text-fg-secondary">
              已选：{scenes.find((s) => s.id === selectedSceneId)?.name}
            </div>
          )}
        </section>

        {/* 右：参数 + 提交 + 结果 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ③ 构图 + 生成
          </h2>

          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-[11px] text-fg-tertiary mb-1">
                构图模式
              </label>
              <div className="space-y-1.5">
                {COMPOSITION_OPTIONS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setComposition(c.value)}
                    className={`w-full text-left p-2 rounded-md border text-[12px] transition-colors ${
                      composition === c.value
                        ? "border-transparent text-brand-400"
                        : "border-border-default text-fg-secondary hover:border-border-strong"
                    }`}
                    style={
                      composition === c.value
                        ? {
                            background: "var(--brand-50-bg)",
                            borderColor: "rgba(59, 130, 246, 0.4)",
                          }
                        : undefined
                    }
                  >
                    <div className="font-medium">{c.label}</div>
                    <div className="text-fg-tertiary mt-0.5 text-[11px]">
                      {c.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-fg-tertiary mb-1">
                输出比例
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="input select text-sm h-9"
              >
                {ASPECT_RATIOS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-fg-tertiary mb-1">
                创意指令（可选）
              </label>
              <textarea
                value={userHint}
                onChange={(e) => setUserHint(e.target.value)}
                rows={2}
                placeholder="如：模特们在长桌前举杯、其中一位转身回望"
                className="input text-[12px] resize-none"
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={
                submitting || sourceFiles.length === 0 || !selectedSceneId
              }
              className="btn btn-primary w-full"
            >
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  生成中… 30-90 秒
                </>
              ) : (
                <>
                  <Sparkles size={14} strokeWidth={2.2} />
                  开始生成
                </>
              )}
            </button>
          </div>

          {/* 结果 */}
          {result ? (
            <div className="space-y-3 border-t border-border-subtle pt-3">
              <div className="bg-bg-tertiary rounded border border-border-subtle overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.result_image_url}
                  alt="海报结果"
                  className="w-full h-auto"
                  style={{ maxHeight: 480, objectFit: "contain" }}
                />
              </div>
              <div className="text-[11px] text-fg-muted leading-relaxed">
                {result.source_count} 张原片 · {result.scene.name} ·{" "}
                {result.composition} · {result.aspect_ratio} · ¥{estCostCny}
              </div>
              <div className="flex gap-2">
                <a
                  href={result.result_image_url}
                  download={`poster_${result.result_id}.png`}
                  className="btn btn-primary btn-sm flex-1"
                >
                  <Download size={12} strokeWidth={2.2} />
                  下载
                </a>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="btn btn-secondary btn-sm flex-1"
                >
                  <RefreshCw size={12} strokeWidth={2.2} />
                  重生成
                </button>
              </div>
            </div>
          ) : !submitting ? (
            <div className="text-[11px] text-fg-muted p-3 border border-dashed border-border-default rounded text-center">
              <ImageIcon
                size={20}
                className="text-fg-tertiary mx-auto mb-1"
                strokeWidth={1.6}
              />
              出图后预览在这里
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
