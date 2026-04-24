"use client";

import { useEffect, useMemo, useState } from "react";
import { Thumbnail, ThumbnailBadge } from "@/app/_components/thumbnail";
import {
  downloadImagesAsZip,
  downloadSingleImage,
} from "@/lib/download-zip";

type Generation = {
  id: number;
  user_id: number;
  username: string | null;
  kind: string;
  input_images: string | null;
  output_images: string | null;
  params: string | null;
  duration_ms: number | null;
  success: number;
  error: string | null;
  created_at: number;
};

type Me = {
  id: number;
  username: string;
  role: "admin" | "user";
  display_name: string | null;
};

const KIND_LABEL: Record<string, { label: string; emoji: string; color: string }> = {
  recolor: { label: "换色", emoji: "🎨", color: "bg-blue-100 text-blue-700" },
  on_model: { label: "批量摄影图", emoji: "👗", color: "bg-pink-100 text-pink-700" },
};

function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 安全从 JSON 字符串拿 URL 列表 */
function parseOutputImages(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default function HistoryPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<Generation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [kindFilter, setKindFilter] = useState<string>("");
  const [scope, setScope] = useState<"me" | "all">("me");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  // 多选状态：以 URL 作为稳定 key，跨分页保持
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, kindFilter, scope]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        scope,
      });
      if (kindFilter) qs.set("kind", kindFilter);
      const res = await fetch(`/api/generations?${qs.toString()}`);
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const body = await res.json();
      setItems(body.items);
      setTotal(body.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  /** 当前页所有可选 URL */
  const currentPageUrls = useMemo(() => {
    const urls: string[] = [];
    for (const g of items) {
      for (const u of parseOutputImages(g.output_images)) urls.push(u);
    }
    return urls;
  }, [items]);

  /** 当前页有多少个被选中（UI 用） */
  const currentPageSelectedCount = useMemo(
    () => currentPageUrls.filter((u) => selectedUrls.has(u)).length,
    [currentPageUrls, selectedUrls],
  );

  function toggleUrl(url: string) {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleRow(g: Generation) {
    const urls = parseOutputImages(g.output_images);
    if (urls.length === 0) return;
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      const allSelected = urls.every((u) => next.has(u));
      if (allSelected) {
        for (const u of urls) next.delete(u);
      } else {
        for (const u of urls) next.add(u);
      }
      return next;
    });
  }

  function selectAllOnPage() {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      for (const u of currentPageUrls) next.add(u);
      return next;
    });
  }

  function clearAllSelected() {
    setSelectedUrls(new Set());
  }

  async function downloadSelected() {
    const chosen = [...selectedUrls];
    if (chosen.length === 0) return;
    setZipping(true);
    setZipProgress({ done: 0, total: chosen.length });
    try {
      const entries = chosen.map((url, i) => {
        // URL 末尾的 filename 作为文件名，加索引防重
        const fname = url.split("/").pop() || `image_${i + 1}.png`;
        return { url, filename: `${String(i + 1).padStart(3, "0")}_${fname}` };
      });
      await downloadImagesAsZip(
        entries,
        `history_${Date.now()}.zip`,
        (done, total) => setZipProgress({ done, total }),
      );
    } finally {
      setZipping(false);
      setZipProgress(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">生成历史</h1>
        <p className="mt-1 text-sm text-gray-500">
          {scope === "all" ? "全团队" : "我的"}生成记录，共 {total} 条
        </p>
      </header>

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="text-xs text-gray-500 mr-2">类型</label>
            <select
              value={kindFilter}
              onChange={(e) => {
                setKindFilter(e.target.value);
                setPage(1);
              }}
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            >
              <option value="">全部</option>
              <option value="recolor">换色</option>
              <option value="on_model">批量摄影图</option>
            </select>
          </div>
          {me?.role === "admin" && (
            <div>
              <label className="text-xs text-gray-500 mr-2">范围</label>
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as "me" | "all");
                  setPage(1);
                }}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              >
                <option value="me">只看我的</option>
                <option value="all">全团队（管理员）</option>
              </select>
            </div>
          )}
        </div>
      </section>

      {/* 多选工具栏（选中任何图就显示） */}
      {(selectedUrls.size > 0 || currentPageSelectedCount > 0) && (
        <section className="sticky top-2 z-20 bg-blue-50 border border-blue-200 rounded-lg shadow-sm p-3 mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-blue-900">
            已选 <b>{selectedUrls.size}</b> 张
            {currentPageSelectedCount !== selectedUrls.size ? (
              <span className="ml-1 text-[11px] text-blue-600">
                （本页 {currentPageSelectedCount}/{currentPageUrls.length}）
              </span>
            ) : null}
          </span>
          <button
            onClick={selectAllOnPage}
            className="px-2 py-1 text-xs bg-white border border-blue-300 text-blue-700 rounded hover:bg-blue-100"
          >
            全选本页
          </button>
          <button
            onClick={clearAllSelected}
            className="px-2 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-100"
          >
            清空选择
          </button>
          <button
            onClick={downloadSelected}
            disabled={selectedUrls.size === 0 || zipping}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {zipping && zipProgress
              ? `打包中 ${zipProgress.done}/${zipProgress.total}`
              : `下载选中 ZIP`}
          </button>
          <span className="ml-auto text-[11px] text-blue-600">
            翻页也会保留选中项
          </span>
        </section>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-6 text-sm text-gray-500">加载中...</div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center text-sm text-gray-500 bg-white rounded-lg border border-gray-200">
          还没有历史记录
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((g) => (
            <GenerationRow
              key={g.id}
              gen={g}
              isExpanded={expanded === g.id}
              onToggleExpand={() =>
                setExpanded((prev) => (prev === g.id ? null : g.id))
              }
              showUsername={scope === "all"}
              selectedUrls={selectedUrls}
              onToggleUrl={toggleUrl}
              onToggleRow={() => toggleRow(g)}
            />
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-sm text-gray-600">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      )}
    </main>
  );
}

/* ─────────── 行 ─────────── */

function GenerationRow({
  gen,
  isExpanded,
  onToggleExpand,
  showUsername,
  selectedUrls,
  onToggleUrl,
  onToggleRow,
}: {
  gen: Generation;
  isExpanded: boolean;
  onToggleExpand: () => void;
  showUsername: boolean;
  selectedUrls: Set<string>;
  onToggleUrl: (url: string) => void;
  onToggleRow: () => void;
}) {
  const kindInfo = KIND_LABEL[gen.kind] || {
    label: gen.kind,
    emoji: "📦",
    color: "bg-gray-100 text-gray-700",
  };

  const outputImages = parseOutputImages(gen.output_images);
  const rowAllSelected =
    outputImages.length > 0 && outputImages.every((u) => selectedUrls.has(u));
  const rowPartialSelected =
    !rowAllSelected && outputImages.some((u) => selectedUrls.has(u));

  let params: Record<string, unknown> = {};
  try {
    params = gen.params ? JSON.parse(gen.params) : {};
  } catch {}

  const visibleCount = isExpanded ? outputImages.length : 8;

  return (
    <li className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              {outputImages.length > 0 ? (
                <button
                  type="button"
                  onClick={onToggleRow}
                  title={rowAllSelected ? "取消本条全部选择" : "全选本条输出图"}
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs shrink-0 ${
                    rowAllSelected
                      ? "bg-blue-600 border-blue-600 text-white"
                      : rowPartialSelected
                        ? "bg-blue-200 border-blue-500 text-blue-800"
                        : "bg-white border-gray-400"
                  }`}
                >
                  {rowAllSelected ? "✓" : rowPartialSelected ? "—" : ""}
                </button>
              ) : null}
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${kindInfo.color}`}
              >
                <span>{kindInfo.emoji}</span>
                {kindInfo.label}
              </span>
              {gen.success === 0 ? (
                <span className="text-xs text-red-600">失败</span>
              ) : (
                <span className="text-xs text-green-600">
                  {outputImages.length} 张
                </span>
              )}
              {gen.duration_ms != null && (
                <span className="text-xs text-gray-400">
                  {(gen.duration_ms / 1000).toFixed(1)}s
                </span>
              )}
              <span className="text-xs text-gray-400">
                · {formatTime(gen.created_at)}
              </span>
              {showUsername && gen.username && (
                <span className="text-xs text-gray-500">@{gen.username}</span>
              )}
            </div>

            <ParamsSummary kind={gen.kind} params={params} />
          </div>
          <button
            onClick={onToggleExpand}
            className="text-xs text-blue-600 hover:underline shrink-0"
          >
            {isExpanded ? "收起" : "详情"}
          </button>
        </div>

        {outputImages.length > 0 && (
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
            {outputImages.slice(0, visibleCount).map((url, i) => {
              const isSel = selectedUrls.has(url);
              return (
                <Thumbnail
                  key={url}
                  src={url}
                  alt={`输出 ${i + 1}`}
                  ratio="3/4"
                  fit="contain"
                  selected={isSel}
                  onClick={() => onToggleUrl(url)}
                  checkbox={
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleUrl(url);
                      }}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs ${
                        isSel
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "bg-white/90 border-gray-400"
                      }`}
                    >
                      {isSel ? "✓" : ""}
                    </button>
                  }
                  hoverOverlay={
                    <div className="flex flex-col gap-1">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener"
                        onClick={(e) => e.stopPropagation()}
                        className="px-3 py-1 bg-white/90 text-gray-800 text-xs rounded hover:bg-white"
                      >
                        查看原图
                      </a>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const fname =
                            url.split("/").pop() || `image_${i + 1}.png`;
                          downloadSingleImage(url, fname);
                        }}
                        className="px-3 py-1 bg-white/90 text-gray-800 text-xs rounded hover:bg-white"
                      >
                        下载单张
                      </button>
                    </div>
                  }
                  badge={
                    isSel ? (
                      <ThumbnailBadge tone="blue">已选</ThumbnailBadge>
                    ) : undefined
                  }
                />
              );
            })}
            {!isExpanded && outputImages.length > 8 && (
              <button
                onClick={onToggleExpand}
                className="aspect-[3/4] rounded-md border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600"
              >
                +{outputImages.length - 8}
              </button>
            )}
          </div>
        )}

        {gen.error && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 whitespace-pre-wrap break-all">
            {gen.error}
          </div>
        )}

        {isExpanded && (
          <details open className="mt-3 text-xs text-gray-600">
            <summary className="cursor-pointer text-gray-500 mb-1">
              完整参数
            </summary>
            <pre className="p-2 bg-gray-50 border border-gray-200 rounded overflow-x-auto">
              {JSON.stringify(params, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </li>
  );
}

function ParamsSummary({
  kind,
  params,
}: {
  kind: string;
  params: Record<string, unknown>;
}) {
  const chips: string[] = [];
  if (params.model) chips.push(`模型 ${params.model}`);
  if (params.aspect_ratio) chips.push(`比例 ${params.aspect_ratio}`);
  if (params.quality_level)
    chips.push(`${String(params.quality_level).toUpperCase()}`);

  if (kind === "recolor") {
    const colors = Array.isArray(params.colors)
      ? (params.colors as Array<{ name: string; hex: string }>)
      : [];
    if (colors.length > 0) {
      chips.push(`${colors.length} 色: ${colors.map((c) => c.name).join("/")}`);
    }
    if (params.image_count) chips.push(`${params.image_count} 图`);
    if (params.material_names) {
      const ms = params.material_names as string[];
      if (ms.length) chips.push(`材质: ${ms.join("/")}`);
    }
  }

  if (kind === "on_model") {
    if (params.identity_name) chips.push(`模特: ${params.identity_name}`);
    if (params.scene_name) chips.push(`场景: ${params.scene_name}`);
    if (Array.isArray(params.pose_names)) {
      const pns = params.pose_names as string[];
      chips.push(`${pns.length} 姿势: ${pns.join("/")}`);
    }
    if (params.photography_name) chips.push(`摄影: ${params.photography_name}`);
    if (params.realism_name) chips.push(`真实感: ${params.realism_name}`);
  }

  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c, i) => (
        <span
          key={i}
          className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600"
        >
          {c}
        </span>
      ))}
    </div>
  );
}
