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
  tags: string | null;
  category: string | null;
  category_label: string | null;
  usage: "single" | "poster";
};

type SwapResult = {
  result_id: string;
  result_image_url: string;
  mime_type: string;
  tokens: { prompt: number; completion: number };
  scene: { id: number; name: string };
};

const ASPECT_RATIOS = [
  { value: "3:4", label: "3:4 竖（推荐）" },
  { value: "2:3", label: "2:3 竖" },
  { value: "4:5", label: "4:5 竖" },
  { value: "1:1", label: "1:1 方" },
  { value: "16:9", label: "16:9 横" },
];

/* ─────────────────────────────────────────────────────────
 *  页面主体
 * ───────────────────────────────────────────────────────── */

export default function BackgroundSwapPage() {
  // 数据
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loadingScenes, setLoadingScenes] = useState(true);

  // 表单
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState("3:4");

  // 状态
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SwapResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 加载 scenes（usage=single）
  useEffect(() => {
    fetch("/api/scenes?usage=single")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Scene[]) => {
        setScenes(data);
      })
      .catch(() => {})
      .finally(() => setLoadingScenes(false));
  }, []);

  // 当用户选了原图，做一个本地预览 URL（释放在卸载时）
  useEffect(() => {
    if (!sourceFile) {
      setSourceUrl(null);
      return;
    }
    const url = URL.createObjectURL(sourceFile);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sourceFile]);

  function onPickSource(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      setError("请上传图片格式（PNG / JPG / WebP）");
      return;
    }
    setSourceFile(file);
    setError(null);
    setResult(null);
  }

  async function handleSubmit() {
    if (!sourceFile) {
      setError("请先上传原片");
      return;
    }
    if (!selectedSceneId) {
      setError("请选择一张场景图");
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const fd = new FormData();
      fd.append("source_image", sourceFile);
      fd.append("scene_id", String(selectedSceneId));
      fd.append("aspect_ratio", aspectRatio);

      const res = await fetch("/api/scene-tools/background-swap", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || res.statusText);
      }
      const data = (await res.json()) as SwapResult;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // 估算成本：Pro Image 4K ~ ¥1.7（同 identity-generator）
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
          背景换图
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          上传一张已有的产品成片 → 选一张主图场景库的氛围图 → AI
          会保留人物 / 服装 / 姿势，把背景替换为新场景，并匹配新场景的光线方向。
        </p>
        <p className="mt-1 text-[11px] text-fg-muted">
          单次成本约 ¥1.7（Pro 模型 + 4K）。30-90 秒出图。
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左：原图上传 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ① 上传原片
          </h2>
          {sourceUrl ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sourceUrl}
                alt="原片预览"
                className="w-full rounded border border-border-subtle"
                style={{ maxHeight: 480, objectFit: "contain" }}
              />
              <button
                onClick={() => {
                  setSourceFile(null);
                  setResult(null);
                }}
                className="absolute top-2 right-2 px-2 py-1 bg-black/70 text-white text-xs rounded hover:bg-black/90 inline-flex items-center gap-1"
              >
                <X size={12} />
                重选
              </button>
            </div>
          ) : (
            <label className="block">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onPickSource(e.target.files)}
                className="hidden"
              />
              <div className="border border-dashed border-border-default rounded p-8 text-center cursor-pointer hover:border-brand-400 hover:bg-bg-hover transition-colors">
                <Upload
                  size={28}
                  strokeWidth={1.6}
                  className="text-fg-tertiary mx-auto mb-2"
                />
                <div className="text-sm text-fg-primary">点击上传原片</div>
                <div className="text-[11px] text-fg-muted mt-1">
                  PNG / JPG / WebP · 限 20MB
                </div>
                <div className="text-[10px] text-fg-muted mt-2">
                  推荐：批量摄影出过的成片（人物 + 服装清晰，背景纯净）
                </div>
              </div>
            </label>
          )}
        </section>

        {/* 中：场景选择 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ② 选场景图
          </h2>
          {loadingScenes ? (
            <div className="text-sm text-fg-tertiary py-6 text-center">
              加载中...
            </div>
          ) : scenes.length === 0 ? (
            <div className="text-sm text-fg-tertiary p-4 border border-dashed border-border-default rounded">
              主图场景库为空，
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
                <Thumbnail
                  key={s.id}
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
            ③ 生成
          </h2>

          <div className="space-y-3 mb-4">
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
              <div className="text-[10px] text-fg-muted mt-1">
                建议跟原片比例一致，否则会被裁切
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting || !sourceFile || !selectedSceneId}
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
                  开始换图
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
                  alt="换图结果"
                  className="w-full h-auto"
                  style={{ maxHeight: 480, objectFit: "contain" }}
                />
              </div>
              <div className="text-[11px] text-fg-muted">
                场景：{result.scene.name} · tokens {result.tokens.prompt}/
                {result.tokens.completion} · ¥{estCostCny}
              </div>
              <div className="flex gap-2">
                <a
                  href={result.result_image_url}
                  download={`background_swap_${result.result_id}.png`}
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
