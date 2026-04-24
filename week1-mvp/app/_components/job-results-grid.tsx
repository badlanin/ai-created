"use client";

import { useMemo, useState } from "react";
import {
  downloadImagesAsZip,
  downloadSingleImage,
} from "@/lib/download-zip";
import type { PolledJobItem } from "@/lib/hooks/use-job-polling";
import { Thumbnail, ThumbnailBadge } from "./thumbnail";

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

  const successful = useMemo(
    () => items.filter((it) => it.status === "completed" && it.result_image_url),
    [items],
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
      <div className="text-sm text-gray-500 p-6 text-center bg-gray-50 rounded-md border border-dashed border-gray-300">
        暂无成功的结果
      </div>
    );
  }

  return (
    <section className="space-y-4">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
        <span className="text-sm text-blue-800">
          已选 <b>{selected.size}</b> / {successful.length}
        </span>
        <button
          onClick={selectAll}
          className="px-2 py-1 text-xs bg-white border border-blue-300 text-blue-700 rounded hover:bg-blue-100"
        >
          全选
        </button>
        <button
          onClick={selectNone}
          className="px-2 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-100"
        >
          清除
        </button>
        <button
          onClick={downloadSelected}
          disabled={selected.size === 0 || zipping}
          className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {zipping && zipProgress
            ? `打包中 ${zipProgress.done}/${zipProgress.total}`
            : `下载选中 (ZIP)`}
        </button>
        <button
          onClick={downloadAll}
          disabled={zipping}
          className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {zipping ? "打包中…" : "下载全部 (ZIP)"}
        </button>
        {subtitle ? (
          <span className="ml-auto text-xs text-gray-500">{subtitle}</span>
        ) : null}
      </div>

      {/* 分组缩略图 */}
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.title || "all"}>
            {g.title ? (
              <div className="text-sm font-medium text-gray-700 mb-2">
                {g.title}{" "}
                <span className="text-xs text-gray-400">
                  · {g.items.length} 张
                </span>
              </div>
            ) : null}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {g.items.map((it) => {
                const isSelected = selected.has(it.id);
                return (
                  <Thumbnail
                    key={it.id}
                    src={it.result_image_url!}
                    alt={it.label || `#${it.idx + 1}`}
                    ratio="3/4"
                    fit="contain"
                    selected={isSelected}
                    onClick={() => toggle(it.id)}
                    checkbox={
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(it.id);
                        }}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs ${
                          isSelected
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "bg-white/90 border-gray-400"
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
                    hoverOverlay={
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadSingleImage(
                            it.result_image_url!,
                            resolveFilename(it),
                          );
                        }}
                        className="px-3 py-1.5 bg-white/90 text-gray-800 text-xs rounded-md shadow hover:bg-white"
                      >
                        下载单张
                      </button>
                    }
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
