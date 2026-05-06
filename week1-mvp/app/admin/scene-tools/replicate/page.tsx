"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Upload,
  Download,
  RefreshCw,
  Wand2,
  X,
  ImageIcon,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────
 *  类型
 * ───────────────────────────────────────────────────────── */

type ModelMeta = {
  label: string;
  position: string;
  role: string;
  pose: string;
  view: string;
  framing: string;
};

type AnalyzeResponse = {
  count: number;
  models: ModelMeta[];
  model: string;
  tokens: { prompt: number; completion: number };
};

type ComposeResponse = {
  result_id: string;
  result_image_url: string;
  mime_type: string;
  tokens: { prompt: number; completion: number };
  count: number;
};

const ASPECT_RATIOS = [
  { value: "3:4", label: "3:4 竖（推荐）" },
  { value: "2:3", label: "2:3 竖" },
  { value: "4:5", label: "4:5 竖" },
  { value: "1:1", label: "1:1 方" },
  { value: "4:3", label: "4:3 横" },
  { value: "16:9", label: "16:9 横" },
];

/* ─────────────────────────────────────────────────────────
 *  页面主体
 * ───────────────────────────────────────────────────────── */

export default function ReplicatePage() {
  // 第 1 步：参考图
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refUrl, setRefUrl] = useState<string | null>(null);

  // 第 2 步：解析结果
  const [analyzing, setAnalyzing] = useState(false);
  const [analyze, setAnalyze] = useState<AnalyzeResponse | null>(null);

  // 第 3 步：每槽产品图
  const [sourceFiles, setSourceFiles] = useState<Record<string, File | null>>(
    {},
  );
  const sourceUrlsRef = useRef<Record<string, string>>({});

  // 第 4 步：生成参数 + 结果
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [userHint, setUserHint] = useState("");
  const [composing, setComposing] = useState(false);
  const [result, setResult] = useState<ComposeResponse | null>(null);

  // 全局 error
  const [error, setError] = useState<string | null>(null);

  // ─── 参考图本地预览 URL ───
  useEffect(() => {
    if (!refFile) {
      setRefUrl(null);
      return;
    }
    const url = URL.createObjectURL(refFile);
    setRefUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [refFile]);

  // ─── 各槽位本地预览 URL ───
  useEffect(() => {
    // revoke 不再需要的
    const oldUrls = sourceUrlsRef.current;
    const newUrls: Record<string, string> = {};
    for (const [label, file] of Object.entries(sourceFiles)) {
      if (file) {
        if (oldUrls[label]) {
          newUrls[label] = oldUrls[label];
        } else {
          newUrls[label] = URL.createObjectURL(file);
        }
      }
    }
    // revoke any URL that's no longer in newUrls
    for (const [label, url] of Object.entries(oldUrls)) {
      if (!newUrls[label]) URL.revokeObjectURL(url);
    }
    sourceUrlsRef.current = newUrls;
    return () => {
      // 卸载时统一释放
      for (const url of Object.values(sourceUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFiles]);

  // 选参考图
  function onPickRef(files: FileList | null) {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (!f.type.startsWith("image/")) {
      setError("请上传图片格式（PNG / JPG / WebP）");
      return;
    }
    setRefFile(f);
    setError(null);
    setAnalyze(null);
    setSourceFiles({});
    setResult(null);
  }

  // 调 analyze
  async function handleAnalyze() {
    if (!refFile) {
      setError("请先上传参考图");
      return;
    }
    setAnalyzing(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("reference_image", refFile);
      const res = await fetch("/api/scene-tools/replicate/analyze", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || res.statusText);
      }
      const data = (await res.json()) as AnalyzeResponse;
      setAnalyze(data);
      // 初始化 sourceFiles 为空槽
      const slots: Record<string, File | null> = {};
      for (const m of data.models) slots[m.label] = null;
      setSourceFiles(slots);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  // 选某个槽的产品图
  function onPickSource(label: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (!f.type.startsWith("image/")) {
      setError("请上传图片格式（PNG / JPG / WebP）");
      return;
    }
    setSourceFiles((prev) => ({ ...prev, [label]: f }));
    setError(null);
    setResult(null);
  }

  function clearSource(label: string) {
    setSourceFiles((prev) => ({ ...prev, [label]: null }));
    setResult(null);
  }

  const allSlotsFilled =
    analyze !== null &&
    analyze.models.every((m) => Boolean(sourceFiles[m.label]));

  // 调 compose
  async function handleCompose() {
    if (!refFile || !analyze || !allSlotsFilled) {
      setError("请先上传参考图、解析、并为每个编号上传产品图");
      return;
    }
    setComposing(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("reference_image", refFile);
      fd.append("models_meta", JSON.stringify(analyze.models));
      fd.append("aspect_ratio", aspectRatio);
      const trimmedHint = userHint.trim();
      if (trimmedHint) fd.append("user_hint", trimmedHint);
      for (const m of analyze.models) {
        const f = sourceFiles[m.label];
        if (f) fd.append(`source_image_${m.label}`, f);
      }
      const res = await fetch("/api/scene-tools/replicate/compose", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || res.statusText);
      }
      const data = (await res.json()) as ComposeResponse;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setComposing(false);
    }
  }

  // 估成本：Pro 4K ~ ¥1.7
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
          <Wand2 size={20} className="text-brand-400" strokeWidth={2.2} />
          仿图 · 参考图驱动的多人合成
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          上传一张多人成片作为参考 → AI 解析参考图里的模特数量和位置 → 你为每个编号
          上传一张自己的产品成片 → AI 把场景 / 光线 / 构图保留，把模特和服装替换为
          你上传的。
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
        {/* 左：参考图 + 解析 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ① 上传参考图
          </h2>
          {refUrl ? (
            <div className="relative mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={refUrl}
                alt="参考图预览"
                className="w-full rounded border border-border-subtle"
                style={{ maxHeight: 360, objectFit: "contain" }}
              />
              <button
                onClick={() => {
                  setRefFile(null);
                  setAnalyze(null);
                  setSourceFiles({});
                  setResult(null);
                }}
                className="absolute top-2 right-2 px-2 py-1 bg-black/70 text-white text-xs rounded hover:bg-black/90 inline-flex items-center gap-1"
              >
                <X size={12} />
                重选
              </button>
            </div>
          ) : (
            <label className="block mb-3">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onPickRef(e.target.files)}
                className="hidden"
              />
              <div className="border border-dashed border-border-default rounded p-8 text-center cursor-pointer hover:border-brand-400 hover:bg-bg-hover transition-colors">
                <Upload
                  size={28}
                  strokeWidth={1.6}
                  className="text-fg-tertiary mx-auto mb-2"
                />
                <div className="text-sm text-fg-primary">点击上传参考图</div>
                <div className="text-[11px] text-fg-muted mt-1">
                  PNG / JPG / WebP · 限 20MB
                </div>
                <div className="text-[10px] text-fg-muted mt-2">
                  推荐：1-5 个模特的多人合影 / 海报
                </div>
              </div>
            </label>
          )}

          <button
            onClick={handleAnalyze}
            disabled={!refFile || analyzing}
            className="btn btn-secondary w-full"
          >
            {analyzing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                解析中...
              </>
            ) : (
              <>
                <Sparkles size={14} strokeWidth={2.2} />
                {analyze ? "重新解析" : "② 解析参考图"}
              </>
            )}
          </button>

          {analyze && (
            <div className="mt-3 text-[11px] text-fg-muted">
              识别到 {analyze.count} 位模特 · 编号 A-
              {String.fromCharCode(64 + analyze.count)}
            </div>
          )}
        </section>

        {/* 中：每槽产品图上传 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ③ 按编号上传产品图
          </h2>
          {!analyze ? (
            <div className="text-sm text-fg-tertiary p-4 border border-dashed border-border-default rounded text-center">
              先上传参考图并解析，会列出每个编号的位置 / 角色 / 姿势 / 视角，方便对应
            </div>
          ) : (
            <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
              {analyze.models.map((m) => {
                const file = sourceFiles[m.label];
                const url = sourceUrlsRef.current[m.label];
                return (
                  <div
                    key={m.label}
                    className="p-2 border border-border-subtle rounded bg-bg-tertiary"
                  >
                    <div className="flex items-start gap-2">
                      <div
                        className="w-7 h-7 shrink-0 rounded-full bg-brand-400 text-white text-sm font-bold flex items-center justify-center"
                        title={`Slot ${m.label}`}
                      >
                        {m.label}
                      </div>
                      <div className="flex-1 min-w-0 text-[11px] leading-snug text-fg-secondary">
                        {[m.role, m.position, m.framing, m.view, m.pose]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    {url && file ? (
                      <div className="relative mt-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`slot ${m.label}`}
                          className="w-full rounded border border-border-subtle"
                          style={{ maxHeight: 120, objectFit: "contain" }}
                        />
                        <button
                          onClick={() => clearSource(m.label)}
                          className="absolute top-1 right-1 px-1.5 py-0.5 bg-black/70 text-white text-[10px] rounded inline-flex items-center gap-0.5"
                        >
                          <X size={10} />
                          重选
                        </button>
                      </div>
                    ) : (
                      <label className="block mt-2">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) =>
                            onPickSource(m.label, e.target.files)
                          }
                          className="hidden"
                        />
                        <div className="border border-dashed border-border-default rounded p-3 text-center cursor-pointer hover:border-brand-400 hover:bg-bg-hover transition-colors">
                          <Upload
                            size={16}
                            strokeWidth={1.6}
                            className="text-fg-tertiary mx-auto mb-1"
                          />
                          <div className="text-[11px] text-fg-primary">
                            上传 Slot {m.label} 的产品图
                          </div>
                          <div className="text-[10px] text-fg-muted mt-0.5">
                            纯色背景成片
                          </div>
                        </div>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 右：参数 + 提交 + 结果 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ④ 生成
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
                建议跟参考图比例一致
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-fg-tertiary mb-1">
                额外提示（可选）
              </label>
              <textarea
                value={userHint}
                onChange={(e) => setUserHint(e.target.value.slice(0, 200))}
                placeholder="例如：模特们更靠近一点；中间的人略转身"
                rows={2}
                className="input text-sm w-full resize-none"
              />
              <div className="text-[10px] text-fg-muted mt-1 flex justify-between">
                <span>给模型一些方向提示</span>
                <span>{userHint.length}/200</span>
              </div>
            </div>

            <button
              onClick={handleCompose}
              disabled={composing || !allSlotsFilled}
              className="btn btn-primary w-full"
            >
              {composing ? (
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

            {analyze && !allSlotsFilled && (
              <div className="text-[10px] text-fg-muted">
                等所有 {analyze.count} 个编号都上传完产品图后才能生成
              </div>
            )}
          </div>

          {/* 结果 */}
          {result ? (
            <div className="space-y-3 border-t border-border-subtle pt-3">
              <div className="bg-bg-tertiary rounded border border-border-subtle overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.result_image_url}
                  alt="仿图结果"
                  className="w-full h-auto"
                  style={{ maxHeight: 480, objectFit: "contain" }}
                />
              </div>
              <div className="text-[11px] text-fg-muted">
                {result.count} 人 · tokens {result.tokens.prompt}/
                {result.tokens.completion} · ¥{estCostCny}
              </div>
              <div className="flex gap-2">
                <a
                  href={result.result_image_url}
                  download={`replicate_${result.result_id}.png`}
                  className="btn btn-primary btn-sm flex-1"
                >
                  <Download size={12} strokeWidth={2.2} />
                  下载
                </a>
                <button
                  onClick={handleCompose}
                  disabled={composing}
                  className="btn btn-secondary btn-sm flex-1"
                >
                  <RefreshCw size={12} strokeWidth={2.2} />
                  重生成
                </button>
              </div>
            </div>
          ) : !composing ? (
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
