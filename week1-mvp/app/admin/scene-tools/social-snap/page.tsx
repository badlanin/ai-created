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

type Identity = {
  id: number;
  name: string;
  image_url: string;
  category_label: string | null;
};

type Scene = {
  id: number;
  name: string;
  image_url: string;
  usage: "single" | "poster";
  category_label: string | null;
};

type SnapResult = {
  result_id: string;
  result_image_url: string;
  tokens: { prompt: number; completion: number };
  scene: { id: number; name: string };
  identities: Array<{ id: number; name: string }>;
  vibe: string;
};

type Vibe = "casual" | "party" | "street" | "lifestyle";

const VIBE_OPTIONS: Array<{ value: Vibe; label: string }> = [
  { value: "casual", label: "日常 Casual" },
  { value: "party", label: "派对 Party" },
  { value: "street", label: "街拍 Street" },
  { value: "lifestyle", label: "Lifestyle 生活" },
];

const ASPECT_RATIOS = [
  { value: "9:16", label: "9:16 竖（Stories / Reels）" },
  { value: "4:5", label: "4:5 竖（Feed）" },
  { value: "1:1", label: "1:1 方（Feed）" },
  { value: "16:9", label: "16:9 横（横屏 Stories）" },
  { value: "3:4", label: "3:4 标准竖" },
];

/* ─────────────────────────────────────────────────────────
 *  页面主体
 * ───────────────────────────────────────────────────────── */

export default function SocialSnapPage() {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // 表单
  const [productFile, setProductFile] = useState<File | null>(null);
  const [productUrl, setProductUrl] = useState<string | null>(null);
  const [selectedIdentityIds, setSelectedIdentityIds] = useState<number[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState<string>("9:16");
  const [vibe, setVibe] = useState<Vibe>("casual");

  // 状态
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SnapResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 加载 identities + scenes（all usage，社媒可在任何场景里）
  useEffect(() => {
    Promise.all([
      fetch("/api/identities").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/scenes").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([ids, scs]) => {
        setIdentities(ids as Identity[]);
        setScenes(scs as Scene[]);
      })
      .catch(() => {})
      .finally(() => setLoadingData(false));
  }, []);

  useEffect(() => {
    if (!productFile) {
      setProductUrl(null);
      return;
    }
    const url = URL.createObjectURL(productFile);
    setProductUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [productFile]);

  function onPickProduct(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      setError("请上传图片格式（PNG / JPG / WebP）");
      return;
    }
    setProductFile(file);
    setError(null);
    setResult(null);
  }

  function toggleIdentity(id: number) {
    setSelectedIdentityIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev; // 最多 3
      return [...prev, id];
    });
  }

  async function handleSubmit() {
    if (!productFile) {
      setError("请先上传产品图");
      return;
    }
    if (selectedIdentityIds.length === 0) {
      setError("请至少选 1 个 identity");
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
      fd.append("product_image", productFile);
      fd.append("identity_ids", JSON.stringify(selectedIdentityIds));
      fd.append("scene_id", String(selectedSceneId));
      fd.append("aspect_ratio", aspectRatio);
      fd.append("vibe", vibe);

      const res = await fetch("/api/scene-tools/social-snap", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || res.statusText);
      }
      const data = (await res.json()) as SnapResult;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // 估算成本：Pro 2K ~ ¥0.9（Pro 4K 是 ¥1.7，2K 减半档）
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
          社媒图（Phone Snap）
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          1-3 个模特 + 产品 + 场景 → 故意"拍坏"的手机随手拍效果。
          适合发小红书、Ins、抖音的日常推广图。
        </p>
        <p className="mt-1 text-[11px] text-fg-muted">
          Pro 模型 + 2K ≈ ¥0.9/张。多人合成是 AI 弱项，第一版可能要试几次。
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左：输入 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5 space-y-4">
          {/* 产品图 */}
          <div>
            <h2 className="text-sm font-semibold text-fg-primary mb-2">
              ① 产品图
            </h2>
            {productUrl ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={productUrl}
                  alt="产品图"
                  className="w-full rounded border border-border-subtle"
                  style={{ maxHeight: 200, objectFit: "contain" }}
                />
                <button
                  onClick={() => setProductFile(null)}
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
                  onChange={(e) => onPickProduct(e.target.files)}
                  className="hidden"
                />
                <div className="border border-dashed border-border-default rounded p-6 text-center cursor-pointer hover:border-brand-400 hover:bg-bg-hover transition-colors">
                  <Upload
                    size={20}
                    strokeWidth={1.6}
                    className="text-fg-tertiary mx-auto mb-1"
                  />
                  <div className="text-[12px] text-fg-primary">
                    点击上传产品图
                  </div>
                </div>
              </label>
            )}
          </div>

          {/* identity 多选 */}
          <div>
            <h2 className="text-sm font-semibold text-fg-primary mb-2">
              ② 选 1-3 个 Identity
              <span className="ml-2 text-[11px] text-fg-tertiary font-normal">
                {selectedIdentityIds.length}/3
              </span>
            </h2>
            {loadingData ? (
              <div className="text-sm text-fg-tertiary py-4 text-center">
                加载中...
              </div>
            ) : identities.length === 0 ? (
              <div className="text-sm text-fg-tertiary p-3 border border-dashed border-border-default rounded">
                Identity 库为空，
                <a href="/admin/models" className="text-brand-400 hover:underline ml-1">
                  去添加
                </a>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 max-h-[280px] overflow-y-auto pr-1">
                {identities.map((m) => {
                  const idx = selectedIdentityIds.indexOf(m.id);
                  const selected = idx >= 0;
                  return (
                    <Thumbnail
                      key={m.id}
                      src={m.image_url}
                      alt={m.name}
                      ratio="3/4"
                      fit="contain"
                      selected={selected}
                      onClick={() => toggleIdentity(m.id)}
                      badge={
                        selected ? (
                          <ThumbnailBadge tone="blue">
                            {idx + 1}
                          </ThumbnailBadge>
                        ) : undefined
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* 中：场景选择 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ③ 选场景
            <span className="ml-2 text-[11px] text-fg-tertiary font-normal">
              主图库 + 海报库都能用
            </span>
          </h2>
          {loadingData ? (
            <div className="text-sm text-fg-tertiary py-6 text-center">
              加载中...
            </div>
          ) : scenes.length === 0 ? (
            <div className="text-sm text-fg-tertiary p-4 border border-dashed border-border-default rounded">
              场景库为空，
              <a href="/admin/scenes" className="text-brand-400 hover:underline ml-1">
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
        </section>

        {/* 右：参数 + 提交 + 结果 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ④ 风格 + 生成
          </h2>

          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-[11px] text-fg-tertiary mb-1">
                氛围
              </label>
              <select
                value={vibe}
                onChange={(e) => setVibe(e.target.value as Vibe)}
                className="input select text-sm h-9"
              >
                {VIBE_OPTIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
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

            <button
              onClick={handleSubmit}
              disabled={
                submitting ||
                !productFile ||
                selectedIdentityIds.length === 0 ||
                !selectedSceneId
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
                  alt="社媒图结果"
                  className="w-full h-auto"
                  style={{ maxHeight: 480, objectFit: "contain" }}
                />
              </div>
              <div className="text-[11px] text-fg-muted leading-relaxed">
                {result.identities.length} 模特 · {result.scene.name} ·{" "}
                {result.vibe} · ¥{estCostCny}
              </div>
              <div className="flex gap-2">
                <a
                  href={result.result_image_url}
                  download={`social_snap_${result.result_id}.png`}
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
