"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Sliders } from "lucide-react";
import type { PolledJobItem } from "@/lib/hooks/use-job-polling";

/**
 * 手动校色对话框
 *
 * 用户拖动滑块 → 防抖 300ms → 调 /api/jobs/items/:id/recorrect
 * → 服务端用新参数对 raw 图重新校正 → 返回新图 URL → 模态实时刷新预览
 *
 * 关键 UX：
 *   - 滑动时显示 loading 但不阻塞滑动（debounce）
 *   - 显示"原始 ΔE" + "当前 ΔE" 让用户量化效果
 *   - 默认值 = 当前 item 的设定（从 correction_meta 读）
 *   - 取消 = 不保存任何更改（撤回）
 *   - 保存 = 保留最后一次 recorrect 的结果
 */

interface CorrectionMeta {
  applied?: boolean;
  before_rgb?: [number, number, number];
  before_delta_e?: number;
  multiplier?: [number, number, number];
  masked_pixel_ratio?: number;
  strength?: number;
  mask_threshold?: number;
  target_hex?: string;
}

export interface RecolorAdjustModalProps {
  /** 当前在调整的 item */
  item: PolledJobItem;
  /** 关闭模态 */
  onClose: () => void;
  /** 用户保存后回调（让父组件刷新数据） */
  onSaved: (newItem: { result_image_url: string; correction_meta: CorrectionMeta }) => void;
}

export function RecolorAdjustModal({
  item,
  onClose,
  onSaved,
}: RecolorAdjustModalProps) {
  const initialMeta = parseMeta(item.correction_meta);

  // ─── 当前预览图（每次 recorrect 后更新）───
  const [previewUrl, setPreviewUrl] = useState<string>(
    item.result_image_url || "",
  );
  const [currentMeta, setCurrentMeta] = useState<CorrectionMeta>(initialMeta);

  // 滑块状态
  const [strength, setStrength] = useState<number>(
    initialMeta.strength ?? 1.0,
  );
  const [maskThreshold, setMaskThreshold] = useState<number>(
    initialMeta.mask_threshold ?? 30,
  );
  const [mode, setMode] = useState<"masked" | "global">("masked");

  // 网络状态
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // 跟踪"原始服务器值"，用于"取消"时回滚
  const originalUrlRef = useRef(item.result_image_url || "");
  const originalMetaRef = useRef(initialMeta);

  // 防抖 + 取消旧请求
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  // 滑块变了 → 300ms 后调 API
  useEffect(() => {
    // 跟"初始值"完全相同时不触发请求
    if (
      strength === (initialMeta.strength ?? 1.0) &&
      maskThreshold === (initialMeta.mask_threshold ?? 30) &&
      mode === "masked"
    ) {
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void recorrect(strength, maskThreshold, mode);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strength, maskThreshold, mode]);

  async function recorrect(
    s: number,
    m: number,
    mode_: "masked" | "global",
  ) {
    if (inFlightRef.current) inFlightRef.current.abort();
    const ac = new AbortController();
    inFlightRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/jobs/items/${item.id}/recorrect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strength: s,
            maskThreshold: m,
            mode: mode_,
          }),
          signal: ac.signal,
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }
      const data = (await res.json()) as {
        result_image_url: string;
        correction_meta: CorrectionMeta;
      };
      // 加上 cache-bust，避免浏览器缓存旧图
      setPreviewUrl(`${data.result_image_url}?t=${Date.now()}`);
      setCurrentMeta(data.correction_meta);
      setHasUnsavedChanges(true);
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // 被新请求取消，正常
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (inFlightRef.current === ac) {
        inFlightRef.current = null;
        setLoading(false);
      }
    }
  }

  function handleSave() {
    onSaved({
      result_image_url: previewUrl.split("?")[0], // 去掉 cache-bust 参数
      correction_meta: currentMeta,
    });
  }

  async function handleCancel() {
    // 如果用户拖过滑块（已经覆盖了原文件），需要回滚成原始参数再调一次
    // 否则服务器端 result_image_path 已经被覆盖，原图状态丢了
    if (hasUnsavedChanges) {
      const confirm_ = confirm(
        "已修改但未保存。取消会回滚到打开时的状态吗？",
      );
      if (!confirm_) return;
      // 用原始参数再 recorrect 一次，恢复服务器端文件
      try {
        await fetch(`/api/jobs/items/${item.id}/recorrect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strength: originalMetaRef.current.strength ?? 1.0,
            maskThreshold: originalMetaRef.current.mask_threshold ?? 30,
            mode: "masked",
          }),
        });
      } catch {}
    }
    onClose();
  }

  // 算"原始 ΔE"（最初打开时的）和"当前 ΔE"（最近一次校正后）
  // 注意：自动校色已关闭，新生成的 item 默认 initialMeta.before_delta_e = undefined
  // 用户拖动滑块后才会有数据
  const originalDeltaE = initialMeta.before_delta_e;
  const currentDeltaE = currentMeta.before_delta_e;
  const hasMetrics =
    originalDeltaE !== undefined || currentDeltaE !== undefined;
  const targetHex = initialMeta.target_hex || currentMeta.target_hex;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        className="bg-bg-secondary border border-border-default rounded-lg shadow-lg max-w-3xl w-full max-h-[90vh] flex flex-col animate-slide-up"
      >
        {/* 顶部 */}
        <header className="px-6 py-4 border-b border-border-subtle flex items-center gap-3">
          <Sliders size={18} className="text-brand-400" strokeWidth={2.2} />
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold text-fg-primary">
              手动校色
            </h2>
            {targetHex ? (
              <div className="text-[11px] text-fg-tertiary mt-0.5 flex items-center gap-1.5">
                目标:
                <span
                  className="inline-block w-3 h-3 rounded border border-border-default"
                  style={{ background: targetHex }}
                />
                <span className="font-mono">{targetHex.toUpperCase()}</span>
              </div>
            ) : null}
          </div>
          <button
            onClick={handleCancel}
            className="w-8 h-8 rounded-md hover:bg-bg-hover flex items-center justify-center text-fg-tertiary hover:text-fg-primary"
          >
            <X size={14} strokeWidth={2.2} />
          </button>
        </header>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 预览图 */}
          <div className="space-y-2">
            <div className="aspect-[3/4] rounded-md bg-bg-tertiary border border-border-subtle overflow-hidden flex items-center justify-center relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="校色预览"
                className="max-w-full max-h-full object-contain"
              />
              {loading ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <Loader2
                    size={28}
                    strokeWidth={2.2}
                    className="text-white animate-spin"
                  />
                </div>
              ) : null}
            </div>
            <div className="text-[10px] text-fg-muted text-center">
              拖动滑块实时预览校色效果
            </div>
          </div>

          {/* 控制台 */}
          <div className="space-y-5">
            {/* ΔE 信息 */}
            <div className="rounded-md bg-bg-tertiary border border-border-subtle p-3.5">
              <div className="text-[10px] uppercase tracking-wider text-fg-tertiary mb-2 font-semibold">
                色差指标 (CIE76 ΔE)
              </div>
              {hasMetrics ? (
                <div className="grid grid-cols-2 gap-3 text-[12px]">
                  {originalDeltaE !== undefined ? (
                    <div>
                      <div className="text-fg-tertiary mb-0.5">原始</div>
                      <div className="font-mono text-fg-primary">
                        {originalDeltaE.toFixed(2)}
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <div className="text-fg-tertiary mb-0.5">当前</div>
                    <div className="font-mono text-fg-primary flex items-center gap-1.5">
                      {currentDeltaE !== undefined
                        ? currentDeltaE.toFixed(2)
                        : "—"}
                      {currentDeltaE !== undefined && currentDeltaE < 3 ? (
                        <span className="chip chip-success text-[9px]">优秀</span>
                      ) : currentDeltaE !== undefined && currentDeltaE < 6 ? (
                        <span className="chip chip-brand text-[9px]">良好</span>
                      ) : currentDeltaE !== undefined ? (
                        <span className="chip chip-warn text-[9px]">仍偏</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-[12px] text-fg-tertiary">
                  拖动下方滑块开始调整 · 系统会显示当前色差
                </div>
              )}
              <div className="mt-2 text-[10px] text-fg-muted leading-relaxed">
                ΔE &lt; 1 不可分辨 · &lt; 3 几乎一致 · &lt; 6 仔细看可分辨 · &gt; 6 明显
              </div>
            </div>

            {/* 强度滑块 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-medium text-fg-secondary">
                  校正强度
                </label>
                <span className="text-[11px] font-mono text-brand-400">
                  {Math.round(strength * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={strength}
                onChange={(e) => setStrength(Number(e.target.value))}
                className="w-full accent-brand-500"
              />
              <div className="flex justify-between text-[10px] text-fg-muted mt-1">
                <span>0% 关</span>
                <span>100% 默认</span>
                <span>200% 加倍</span>
              </div>
            </div>

            {/* Mask 阈值滑块 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-medium text-fg-secondary">
                  Mask 范围（对哪些像素生效）
                </label>
                <span className="text-[11px] font-mono text-brand-400">
                  ΔE &lt; {maskThreshold}
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={80}
                step={1}
                value={maskThreshold}
                onChange={(e) => setMaskThreshold(Number(e.target.value))}
                className="w-full accent-brand-500"
                disabled={mode === "global"}
              />
              <div className="flex justify-between text-[10px] text-fg-muted mt-1">
                <span>5 严格</span>
                <span>30 推荐</span>
                <span>80 宽松</span>
              </div>
            </div>

            {/* 模式 */}
            <div>
              <label className="text-[12px] font-medium text-fg-secondary block mb-1.5">
                校正模式
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("masked")}
                  className={`flex-1 px-3 py-2 rounded-md border text-[12px] transition-colors ${
                    mode === "masked"
                      ? "border-transparent text-brand-400 font-medium"
                      : "border-border-default text-fg-secondary hover:border-border-strong"
                  }`}
                  style={
                    mode === "masked"
                      ? {
                          background: "var(--brand-50-bg)",
                          borderColor: "rgba(59, 130, 246, 0.4)",
                        }
                      : undefined
                  }
                >
                  仅服装（推荐）
                </button>
                <button
                  type="button"
                  onClick={() => setMode("global")}
                  className={`flex-1 px-3 py-2 rounded-md border text-[12px] transition-colors ${
                    mode === "global"
                      ? "border-transparent text-warn font-medium"
                      : "border-border-default text-fg-secondary hover:border-border-strong"
                  }`}
                  style={
                    mode === "global"
                      ? {
                          background: "var(--warn-bg)",
                          borderColor: "rgba(245, 158, 11, 0.4)",
                        }
                      : undefined
                  }
                >
                  全图（会动背景）
                </button>
              </div>
            </div>

            {error ? (
              <div
                className="p-2.5 rounded text-[12px] border"
                style={{
                  background: "var(--danger-bg)",
                  borderColor: "rgba(239, 68, 68, 0.3)",
                  color: "var(--danger)",
                }}
              >
                {error}
              </div>
            ) : null}
          </div>
        </div>

        {/* 底部 */}
        <footer className="px-5 py-3.5 border-t border-border-subtle bg-bg-tertiary flex justify-end gap-2">
          <button onClick={handleCancel} className="btn btn-ghost btn-md">
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!hasUnsavedChanges || loading}
            className="btn btn-primary btn-md"
          >
            保存
          </button>
        </footer>
      </div>
    </div>
  );
}

function parseMeta(s: string | null | undefined): CorrectionMeta {
  if (!s) return {};
  try {
    return JSON.parse(s) as CorrectionMeta;
  } catch {
    return {};
  }
}
