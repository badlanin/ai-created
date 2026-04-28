"use client";

import { useMemo, useState } from "react";
import { Sliders, Download } from "lucide-react";
import {
  downloadImagesAsZip,
  downloadSingleImage,
} from "@/lib/download-zip";
import type { PolledJobItem } from "@/lib/hooks/use-job-polling";
import { Thumbnail, ThumbnailBadge } from "./thumbnail";
import { RecolorAdjustModal } from "./recolor-adjust-modal";

export interface JobResultsGridProps {
  items: PolledJobItem[];
  /**
   * 分组字段：
   *   - 'color' for recolor (按 label 中 "颜色 - ..." 分组)
   *   - null for 批量摄影图（所有 pose 同组）
   */
  groupBy?: "label-prefix" | null;
  /** ZIP 文件名前缀，默认 "results" */
  zipFilenamePrefix?: string;
  /** 单张下载时的文件名生成函数（默认用 label） */
  makeFilename?: (item: PolledJobItem) => string;
  /** 顶部副标题（可选），比如 "总耗时 1:23 · 共 10 张 · 成功 8" */
  subtitle?: React.ReactNode;
}

/**
 * 完成任务的结果网格（支持多选 + ZIP 下载）
 *
 * 这是 <ResultsView> 的通用替代品。老的 results 数组变成 items，其中
 * 只展示 status='completed' 的 item。
 */
export function JobResultsGrid({
  items,
  groupBy = null,
  zipFilenamePrefix = "results",
  makeFilename,
  subtitle,
}: JobResultsGridProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [adjustingItem, setAdjustingItem] = useState<PolledJobItem | null>(
    null,
  );
  /** 本地覆盖：保存校色后立刻反映新图，不等下次轮询 */
  const [localOverrides, setLocalOverrides] = useState<
    Record<number, { result_image_url: string; correction_meta?: string }>
  >({});

  // 把覆盖应用到 items 上
  const itemsWithOverrides = useMemo(() => {
    if (Object.keys(localOverrides).length === 0) return items;
    return items.map((it) => {
      const ov = localOverrides[it.id];
      if (!ov) return it;
      return {
        ...it,
        result_image_url: ov.result_image_url,
        correction_meta: ov.correction_meta ?? it.correction_meta,
      };
    });
  }, [items, localOverrides]);

  const successful = useMemo(
    () =>
      itemsWithOverrides.filter(
        (it) => it.status === "completed" && it.result_image_url,
      ),
    [itemsWithOverrides],
  );

  /** 按 label 的 " - " 前缀分组（recolor：颜色名 - 原图名） */
  const groups = useMemo(() => {
    if (groupBy !== "label-prefix") {
      return [{ title: "", items: successful }];
    }
    const map = new Map<string, PolledJobItem[]>();
    for (const it of successful) {
      const label = it.label || "";
      const title = label.includes(" - ") ? label.split(" - ")[0] : label;
      if (!map.has(title)) map.set(title, []);
      map.get(title)!.push(it);
    }
    return Array.from(map.entries()).map(([title, items]) => ({
      title,
      items,
    }));
  }, [successful, groupBy]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelected(new Set(successful.map((it) => it.id)));
  }
  function selectNone() {
    setSelected(new Set());
  }

  function defaultFilename(it: PolledJobItem): string {
    const safe = (it.label || `item_${it.idx + 1}`).replace(/[/\\?%*:|"<>]/g, "_");
    return `${safe}.png`;
  }
  const resolveFilename = makeFilename ?? defaultFilename;

  async function downloadEntries(chosen: PolledJobItem[], zipname: string) {
    setZipping(true);
    setZipProgress({ done: 0, total: chosen.length });
    try {
      const entries = chosen.map((it) => ({
        url: it.result_image_url!,
        filename: resolveFilename(it),
      }));
      await downloadImagesAsZip(entries, zipname, (done, total) =>
        setZipProgress({ done, total }),
      );
    } finally {
      setZipping(false);
      setZipProgress(null);
    }
  }

  async function downloadSelected() {
    const chosen = successful.filter((it) => selected.has(it.id));
    if (chosen.length === 0) return;
    await downloadEntries(chosen, `${zipFilenamePrefix}_${Date.now()}.zip`);
  }
  async function downloadAll() {
    if (successful.length === 0) return;
    await downloadEntries(
      successful,
      `${zipFilenamePrefix}_all_${Date.now()}.zip`,
    );
  }

  if (successful.length === 0) {
    return (
      <div className="text-sm text-fg-tertiary p-6 text-center bg-bg-tertiary rounded-md border border-dashed border-border-default">
        暂无成功的结果
      </div>
    );
  }

  return (
    <section className="space-y-4">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-[var(--brand-50-bg)] border border-[rgba(59,130,246,0.3)] rounded-md">
        <span className="text-sm text-brand-400">
          已选 <b>{selected.size}</b> / {successful.length}
        </span>
        <button
          onClick={selectAll}
          className="px-2 py-1 text-xs bg-bg-secondary border border-[rgba(59,130,246,0.4)] text-brand-400 rounded hover:bg-[var(--brand-100-bg)]"
        >
          全选
        </button>
        <button
          onClick={selectNone}
          className="px-2 py-1 text-xs bg-bg-secondary border border-border-default text-fg-secondary rounded hover:bg-bg-tertiary"
        >
          清除
        </button>
        <button
          onClick={downloadSelected}
          disabled={selected.size === 0 || zipping}
          className="px-3 py-1 text-xs bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
        >
          {zipping && zipProgress
            ? `打包中 ${zipProgress.done}/${zipProgress.total}`
            : `下载选中 (ZIP)`}
        </button>
        <button
          onClick={downloadAll}
          disabled={zipping}
          className="px-3 py-1 text-xs bg-success text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {zipping ? "打包中…" : "下载全部 (ZIP)"}
        </button>
        {subtitle ? (
          <span className="ml-auto text-xs text-fg-tertiary">{subtitle}</span>
        ) : null}
      </div>

      {/* 分组缩略图 */}
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.title || "all"}>
            {g.title ? (
              <div className="text-sm font-medium text-fg-secondary mb-2">
                {g.title}{" "}
                <span className="text-xs text-fg-tertiary">
                  · {g.items.length} 张
                </span>
              </div>
            ) : null}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {g.items.map((it) => {
                const isSelected = selected.has(it.id);
                return (
                  <div
                    key={it.id}
                    className="group relative rounded-md overflow-hidden border border-border-subtle bg-bg-card hover:border-border-default transition-colors"
                  >
                    <Thumbnail
                      src={it.result_image_url!}
                      alt={it.label || `#${it.idx + 1}`}
                      ratio="3/4"
                      fit="contain"
                      selected={isSelected}
                      onClick={() => toggle(it.id)}
                      className="rounded-none border-0"
                      checkbox={
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(it.id);
                          }}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs ${
                            isSelected
                              ? "bg-brand-600 border-transparent text-white"
                              : "bg-bg-elevated/90 border-border-strong"
                          }`}
                        >
                          {isSelected ? "✓" : ""}
                        </button>
                      }
                      badge={
                        it.cost_cny !== null ? (
                          <ThumbnailBadge tone="gray">
                            ¥{it.cost_cny.toFixed(2)}
                          </ThumbnailBadge>
                        ) : undefined
                      }
                    />
                    {/* 持久可见的操作栏 */}
                    <div className="flex border-t border-border-subtle bg-bg-secondary">
                      {it.raw_image_path ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAdjustingItem(it);
                          }}
                          className="flex-1 px-2 py-2 text-[12px] text-brand-400 hover:bg-bg-hover flex items-center justify-center gap-1.5 border-r border-border-subtle"
                          title="打开手动校色滑块"
                        >
                          <Sliders size={12} strokeWidth={2.2} />
                          调整颜色
                        </button>
                      ) : null}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadSingleImage(
                            it.result_image_url!,
                            resolveFilename(it),
                          );
                        }}
                        className="flex-1 px-2 py-2 text-[12px] text-fg-secondary hover:bg-bg-hover hover:text-fg-primary flex items-center justify-center gap-1.5"
                        title="下载这张图"
                      >
                        <Download size={12} strokeWidth={2.2} />
                        下载
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 手动校色模态 */}
      {adjustingItem ? (
        <RecolorAdjustModal
          item={adjustingItem}
          onClose={() => setAdjustingItem(null)}
          onSaved={(updated) => {
            setLocalOverrides((prev) => ({
              ...prev,
              [adjustingItem.id]: {
                result_image_url: updated.result_image_url,
                correction_meta: JSON.stringify(updated.correction_meta),
              },
            }));
            setAdjustingItem(null);
          }}
        />
      ) : null}
    </section>
  );
}
