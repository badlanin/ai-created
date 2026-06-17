"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Download, ExternalLink, Eye, Loader2 } from "lucide-react";
import {
  readUrlCaptureHistory,
  type UrlCaptureHistoryRecord,
} from "@/lib/url-capture-history";
import { Thumbnail } from "@/app/_components/thumbnail";

type UserRow = {
  id: number;
  username: string;
  display_name: string | null;
  role: string;
};

type ApiData = {
  start: string;
  end: string;
  users: UserRow[];
  urlByDay: Array<{ day: string; url_count: number }>;
  urlByUserDay: Array<{
    day: string;
    user_id: number;
    username: string | null;
    display_name: string | null;
    url_count: number;
    latest_at: number | null;
  }>;
  urlRecords: UrlCaptureRecord[];
  aiByDay: Array<{ day: string; ai_count: number }>;
  aiByUserDay: Array<{
    day: string;
    user_id: number;
    username: string | null;
    display_name: string | null;
    ai_count: number;
    latest_at: number | null;
  }>;
  aiRecords: AiRecord[];
};

type TypeFilter = "all" | "url" | "ai";
type DetailKind = "url" | "ai";

type UrlCaptureRecord = {
  id: string;
  user_id: number;
  username: string | null;
  display_name: string | null;
  source: string;
  source_label: string | null;
  source_url: string;
  source_host: string | null;
  status: string;
  selected_count: number;
  saved_count: number;
  created_at: number;
  day: string;
  thumbnail_url: string | null;
  items: Array<{
    image_url: string;
    media_url: string;
  }>;
};

type AiRecord = {
  id: string;
  user_id: number;
  username: string | null;
  display_name: string | null;
  feature: string;
  model: string;
  status: string;
  total_count: number;
  completed_count: number;
  failed_count: number;
  total_cost_cny: number;
  params: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  day: string;
  cover_image_url: string | null;
};

type AiJobDetail = {
  job: AiRecord;
  items: Array<{
    id: number;
    idx: number;
    status: string;
    label: string | null;
    result_image_url: string | null;
    cost_cny: number | null;
    error_message: string | null;
  }>;
};

const FEATURE_LABELS: Record<string, string> = {
  recolor: "HEX换色",
  batch_photo: "批量摄影",
  identity_gen: "形象生成",
  scene_tools: "服饰场景图",
};

function formatDay(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return { start: formatDay(start), end: formatDay(end) };
}

function enumerateDays(start: string, end: string) {
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  while (cursor <= endDate) {
    days.push(formatDay(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDateTime(unix: number | null) {
  if (!unix) return "-";
  return new Date(unix * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(unix: number) {
  return new Date(unix * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(record: AiRecord) {
  if (!record.started_at || !record.finished_at) return null;
  const seconds = record.finished_at - record.started_at;
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function safeParseParams(params: string | null): Record<string, unknown> {
  if (!params) return {};
  try {
    return JSON.parse(params) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function formatAiConfig(record: AiRecord) {
  const params = safeParseParams(record.params);
  const chips: string[] = [];
  if (record.feature === "batch_photo") {
    if (typeof params.solid_pose_count === "number" && params.solid_pose_count > 0) {
      chips.push(`${params.solid_pose_count} 纯色`);
    }
    if (Array.isArray(params.extra_pairs) && params.extra_pairs.length > 0) {
      chips.push(`${params.extra_pairs.length} 场景`);
    }
  } else if (record.feature === "recolor") {
    const colors = Array.isArray(params.colors)
      ? (params.colors as Array<{ name?: string }>)
      : [];
    if (colors.length) chips.push(`${colors.length} 色`);
  } else if (record.feature === "scene_tools") {
    if (typeof params.product_count === "number") {
      chips.push(`${params.product_count} 产品`);
    }
    if (typeof params.scene_count === "number") chips.push(`${params.scene_count} 场景`);
  }
  if (params.quality_level) chips.push(String(params.quality_level).toUpperCase());
  if (params.realism_name) chips.push(String(params.realism_name));
  return chips.join(" · ") || "-";
}

function dbUrlRecordToHistory(record: UrlCaptureRecord): UrlCaptureHistoryRecord {
  const imageUrls = record.items.map((item) => item.media_url).filter(Boolean);
  return {
    id: record.id,
    userId: record.user_id,
    username: record.username || undefined,
    displayName: record.display_name,
    source: "recolor",
    sourceLabel: record.source_label || "URL抓取",
    sourceUrl: record.source_url,
    selectedCount: toNumber(record.selected_count),
    addedCount: toNumber(record.saved_count),
    imageUrls,
    thumbnailUrl: record.thumbnail_url || imageUrls[0],
    createdAt: record.created_at * 1000,
  };
}

export default function ProductStatsPage() {
  const range = useMemo(defaultDateRange, []);
  const [start, setStart] = useState(range.start);
  const [end, setEnd] = useState(range.end);
  const [userFilter, setUserFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailTarget, setDetailTarget] = useState<{
    day: string;
    userId: string;
    displayName: string;
    kind: DetailKind;
  } | null>(null);
  const [aiDetailJobId, setAiDetailJobId] = useState<string | null>(null);
  const [urlDetailItem, setUrlDetailItem] =
    useState<UrlCaptureHistoryRecord | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ start, end });
      const res = await fetch(`/api/admin/product-stats?${params.toString()}`);
      const body = (await res.json()) as ApiData & { error?: string };
      if (!res.ok) throw new Error(body.error || res.statusText);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  const urlCaptureHistory = useMemo(() => readUrlCaptureHistory(), [data]);
  const localUrlCaptureHistory = useMemo(
    () => urlCaptureHistory.filter((item) => !item.userId),
    [urlCaptureHistory],
  );
  const databaseUrlCaptureHistory = useMemo(
    () => (data?.urlRecords || []).map(dbUrlRecordToHistory),
    [data],
  );
  const allUrlCaptureHistory = useMemo(
    () => [...databaseUrlCaptureHistory, ...localUrlCaptureHistory],
    [databaseUrlCaptureHistory, localUrlCaptureHistory],
  );

  const computed = useMemo(() => {
    const days = enumerateDays(start, end);
    const aiByDay = new Map<string, number>();
    const rowMap = new Map<
      string,
      {
        day: string;
        userId: string;
        username: string;
        displayName: string;
        urlCount: number;
        aiCount: number;
        latestAt: number | null;
      }
    >();

    for (const row of data?.aiByDay || []) {
      aiByDay.set(row.day, toNumber(row.ai_count));
    }

    const urlByDay = new Map<string, number>();
    for (const row of data?.urlByDay || []) {
      urlByDay.set(row.day, toNumber(row.url_count));
    }

    for (const row of data?.urlByUserDay || []) {
      const userId = String(row.user_id);
      const key = `${row.day}:${userId}`;
      const current = rowMap.get(key) || {
        day: row.day,
        userId,
        username: row.username || `user-${row.user_id}`,
        displayName: row.display_name || row.username || `用户 ${row.user_id}`,
        urlCount: 0,
        aiCount: 0,
        latestAt: null,
      };
      current.urlCount += toNumber(row.url_count);
      current.latestAt = Math.max(current.latestAt || 0, row.latest_at || 0);
      rowMap.set(key, current);
    }

    for (const row of data?.aiByUserDay || []) {
      const userId = String(row.user_id);
      const key = `${row.day}:${userId}`;
      rowMap.set(key, {
        day: row.day,
        userId,
        username: row.username || `user-${row.user_id}`,
        displayName: row.display_name || row.username || `用户 ${row.user_id}`,
        urlCount: 0,
        aiCount: toNumber(row.ai_count),
        latestAt: row.latest_at,
      });
    }

    for (const item of localUrlCaptureHistory) {
      const day = formatDay(new Date(item.createdAt));
      if (day < start || day > end) continue;
      const count = toNumber(item.addedCount);
      urlByDay.set(day, (urlByDay.get(day) || 0) + count);
      const userId = item.userId ? String(item.userId) : "local-url";
      const key = `${day}:${userId}`;
      const current = rowMap.get(key) || {
        day,
        userId,
        username: item.username || "local-url",
        displayName: item.displayName || item.username || "本机URL记录",
        urlCount: 0,
        aiCount: 0,
        latestAt: null,
      };
      current.urlCount += count;
      current.latestAt = Math.max(
        current.latestAt || 0,
        Math.floor(item.createdAt / 1000),
      );
      rowMap.set(key, current);
    }

    const chart = days.map((day) => {
      if (userFilter === "all") {
        return {
          day,
          urlCount: urlByDay.get(day) || 0,
          aiCount: aiByDay.get(day) || 0,
        };
      }
      // 选了具体子账户：从 rowMap 中找该用户当天的数据
      const key = `${day}:${userFilter}`;
      const row = rowMap.get(key);
      return {
        day,
        urlCount: row?.urlCount || 0,
        aiCount: row?.aiCount || 0,
      };
    });

    const rows = Array.from(rowMap.values())
      .filter((row) => {
        if (userFilter !== "all" && row.userId !== userFilter) return false;
        if (typeFilter === "url" && row.urlCount === 0) return false;
        if (typeFilter === "ai" && row.aiCount === 0) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.day !== b.day) return b.day.localeCompare(a.day);
        return b.urlCount + b.aiCount - (a.urlCount + a.aiCount);
      });

    const today = formatDay(new Date());
    const todayRow = chart.find((row) => row.day === today);
    const totalUrl = chart.reduce((sum, row) => sum + row.urlCount, 0);
    const totalAi = chart.reduce((sum, row) => sum + row.aiCount, 0);
    const activeUsers = new Set(
      rows.filter((row) => row.urlCount + row.aiCount > 0).map((row) => row.userId),
    ).size;

    return {
      chart,
      rows,
      totalUrl,
      totalAi,
      todayTotal: (todayRow?.urlCount || 0) + (todayRow?.aiCount || 0),
      activeUsers,
    };
  }, [data, end, localUrlCaptureHistory, start, typeFilter, userFilter]);

  function exportCsv() {
    const lines = [
      ["日期", "子账户", "URL抓取", "AI处理", "合计", "最近记录"],
      ...computed.rows.map((row) => [
        row.day,
        row.displayName,
        String(row.urlCount),
        String(row.aiCount),
        String(row.urlCount + row.aiCount),
        formatDateTime(row.latestAt),
      ]),
    ];
    const csv = lines
      .map((line) =>
        line
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `product_stats_${start}_${end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const maxChartValue = Math.max(
    1,
    ...computed.chart.map((row) => row.urlCount + row.aiCount),
  );
  const selectedRealUser =
    userFilter !== "all" &&
    userFilter !== "local-url" &&
    (data?.users || []).some((user) => String(user.id) === userFilter);
  const canOpenDetailForSelection = selectedRealUser || userFilter === "local-url";

  const detailUrlRecords = detailTarget
    ? allUrlCaptureHistory.filter((item) => {
        const userId = item.userId ? String(item.userId) : "local-url";
        return (
          detailTarget.kind === "url" &&
          detailTarget.day === formatDay(new Date(item.createdAt)) &&
          detailTarget.userId === userId
        );
      })
    : [];
  const detailAiRecords = detailTarget
    ? (data?.aiRecords || []).filter(
        (item) =>
          detailTarget.kind === "ai" &&
          detailTarget.day === item.day &&
          detailTarget.userId === String(item.user_id),
      )
    : [];

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-fg-primary">产品数量统计</h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          按子账户历史记录统计 URL抓取 与 AI处理 数量（按天）
        </p>
      </header>

      <section className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-bg-secondary p-4 shadow-sm">
        <label className="text-xs text-fg-tertiary">
          日期范围
          <div className="mt-1 flex items-center gap-2">
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="h-9 rounded-md border border-border-default bg-bg-primary px-3 text-sm"
            />
            <span className="text-fg-tertiary">-</span>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="h-9 rounded-md border border-border-default bg-bg-primary px-3 text-sm"
            />
          </div>
        </label>
        <label className="flex flex-col text-xs text-fg-tertiary">
          子账户
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="mt-1 h-9 rounded-md border border-border-default bg-bg-primary px-3 text-sm text-fg-primary"
          >
            <option value="all">全部子账户</option>
            {(data?.users || []).map((user) => (
              <option key={user.id} value={String(user.id)}>
                {user.display_name || user.username}
              </option>
            ))}
            <option value="local-url">本机URL记录</option>
          </select>
        </label>
        <div className="flex flex-col text-xs text-fg-tertiary">
          类型
          <div className="mt-1 inline-flex h-9 rounded-md border border-border-default bg-bg-primary p-0.5">
            {[
              ["all", "全部"],
              ["url", "URL抓取"],
              ["ai", "AI处理"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTypeFilter(value as TypeFilter)}
                className={`rounded px-3 text-sm ${
                  typeFilter === value
                    ? "bg-[var(--brand-50-bg)] text-brand-400 font-medium"
                    : "text-fg-secondary hover:text-fg-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-md border border-border-default bg-bg-primary px-3 text-sm text-fg-secondary hover:bg-bg-hover"
        >
          <Download size={14} />
          导出 CSV
        </button>
      </section>

      {error ? (
        <div className="mb-4 rounded-md border border-[rgba(239,68,68,0.3)] bg-[var(--danger-bg)] p-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="p-8 text-center text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-1 inline-block animate-spin" />
          加载中...
        </div>
      ) : (
        <>
          <section className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-4">
            <StatCard label="今日总数" value={computed.todayTotal} />
            <StatCard label="URL抓取" value={computed.totalUrl} tone="blue" />
            <StatCard label="AI处理" value={computed.totalAi} tone="purple" />
            <StatCard label="活跃子账户" value={computed.activeUsers} />
          </section>

          <section className="mb-5 rounded-lg border border-border-subtle bg-bg-secondary p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-fg-primary">
                每日产品数量趋势
              </h2>
              <div className="flex items-center gap-4 text-xs text-fg-tertiary">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  URL抓取
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-violet-500" />
                  AI处理
                </span>
              </div>
            </div>
            <div className="flex h-64 items-end gap-3 border-b border-border-subtle pb-4">
              {computed.chart.map((row) => {
                const urlHeight = (row.urlCount / maxChartValue) * 100;
                const aiHeight = (row.aiCount / maxChartValue) * 100;
                return (
                  <div key={row.day} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <div className="flex h-48 w-full items-end justify-center gap-1">
                      <div
                        className="w-4 rounded-t bg-blue-500"
                        style={{ height: `${Math.max(4, urlHeight)}%` }}
                        title={`URL抓取 ${row.urlCount}`}
                      />
                      <div
                        className="w-4 rounded-t bg-violet-500"
                        style={{ height: `${Math.max(4, aiHeight)}%` }}
                        title={`AI处理 ${row.aiCount}`}
                      />
                    </div>
                    <div className="truncate text-[10px] text-fg-tertiary">
                      {row.day.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-border-subtle bg-bg-secondary p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-fg-primary">
              子账户明细（按天）
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-xs text-fg-tertiary">
                    <th className="py-2 text-left">日期</th>
                    <th className="py-2 text-left">子账户</th>
                    <th className="py-2 text-right">URL抓取</th>
                    <th className="py-2 text-right">AI处理</th>
                    <th className="py-2 text-right">合计</th>
                    <th className="py-2 text-right">最近记录</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-fg-tertiary">
                        暂无统计记录
                      </td>
                    </tr>
                  ) : (
                    computed.rows.map((row) => (
                      <tr
                        key={`${row.day}-${row.userId}`}
                        className="border-b border-border-subtle"
                      >
                        <td className="py-2 text-fg-secondary">{row.day}</td>
                        <td className="py-2">
                          <div className="font-medium text-fg-primary">
                            {row.displayName}
                          </div>
                          <div className="text-xs text-fg-tertiary">
                            @{row.username}
                          </div>
                        </td>
                        <td className="py-2 text-right text-blue-600">
                          <span className="inline-flex items-center justify-end gap-2">
                            <span>{row.urlCount}</span>
                            {canOpenDetailForSelection ? (
                              <button
                                type="button"
                                className="text-xs text-blue-600 underline underline-offset-2"
                                onClick={() =>
                                  setDetailTarget({
                                    day: row.day,
                                    userId: row.userId,
                                    displayName: row.displayName,
                                    kind: "url",
                                  })
                                }
                              >
                                详细
                              </button>
                            ) : null}
                          </span>
                        </td>
                        <td className="py-2 text-right text-violet-600">
                          <span className="inline-flex items-center justify-end gap-2">
                            <span>{row.aiCount}</span>
                            {canOpenDetailForSelection ? (
                              <button
                                type="button"
                                className="text-xs text-violet-600 underline underline-offset-2"
                                onClick={() =>
                                  setDetailTarget({
                                    day: row.day,
                                    userId: row.userId,
                                    displayName: row.displayName,
                                    kind: "ai",
                                  })
                                }
                              >
                                详细
                              </button>
                            ) : null}
                          </span>
                        </td>
                        <td className="py-2 text-right font-medium text-fg-primary">
                          {row.urlCount + row.aiCount}
                        </td>
                        <td className="py-2 text-right text-xs text-fg-tertiary">
                          {formatDateTime(row.latestAt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {detailTarget ? (
        <DetailListModal
          target={detailTarget}
          urlRecords={detailUrlRecords}
          aiRecords={detailAiRecords}
          onClose={() => setDetailTarget(null)}
          onOpenUrlDetail={setUrlDetailItem}
          onOpenAiDetail={setAiDetailJobId}
        />
      ) : null}
      {urlDetailItem ? (
        <UrlRecordDetailModal
          item={urlDetailItem}
          onClose={() => setUrlDetailItem(null)}
        />
      ) : null}
      {aiDetailJobId ? (
        <AiRecordDetailModal
          jobId={aiDetailJobId}
          onClose={() => setAiDetailJobId(null)}
        />
      ) : null}
    </main>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "blue" | "purple";
}) {
  const color =
    tone === "blue"
      ? "text-blue-600"
      : tone === "purple"
        ? "text-violet-600"
        : "text-fg-primary";
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-secondary p-4 shadow-sm">
      <div className="text-xs text-fg-tertiary">{label}</div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${color}`}>
        {value}
      </div>
    </div>
  );
}

function DetailListModal({
  target,
  urlRecords,
  aiRecords,
  onClose,
  onOpenUrlDetail,
  onOpenAiDetail,
}: {
  target: { day: string; userId: string; displayName: string; kind: DetailKind };
  urlRecords: UrlCaptureHistoryRecord[];
  aiRecords: AiRecord[];
  onClose: () => void;
  onOpenUrlDetail: (item: UrlCaptureHistoryRecord) => void;
  onOpenAiDetail: (jobId: string) => void;
}) {
  const recordsCount =
    target.kind === "url"
      ? urlRecords.reduce((sum, item) => sum + toNumber(item.addedCount), 0)
      : aiRecords.reduce((sum, item) => sum + toNumber(item.completed_count), 0);
  const title =
    target.kind === "url"
      ? `URL抓取明细 · ${target.displayName} · ${target.day}`
      : `AI处理明细 · ${target.displayName} · ${target.day}`;

  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span
          className={`rounded-md px-2 py-1 ${
            target.kind === "url"
              ? "bg-[var(--brand-50-bg)] text-blue-600"
              : "bg-bg-tertiary text-fg-tertiary"
          }`}
        >
          URL抓取 {target.kind === "url" ? recordsCount : "-"}
        </span>
        <span
          className={`rounded-md px-2 py-1 ${
            target.kind === "ai"
              ? "bg-[var(--brand-50-bg)] text-violet-600"
              : "bg-bg-tertiary text-fg-tertiary"
          }`}
        >
          AI处理 {target.kind === "ai" ? recordsCount : "-"}
        </span>
      </div>
      <div className="max-h-[62vh] space-y-2 overflow-y-auto pr-1">
        {target.kind === "url" ? (
          urlRecords.length === 0 ? (
            <EmptyDetail />
          ) : (
            urlRecords.map((item) => (
              <UrlDetailCard
                key={item.id}
                item={item}
                onOpenDetail={() => onOpenUrlDetail(item)}
              />
            ))
          )
        ) : aiRecords.length === 0 ? (
          <EmptyDetail />
        ) : (
          aiRecords.map((item) => (
            <AiDetailCard
              key={item.id}
              item={item}
              onOpenDetail={() => onOpenAiDetail(item.id)}
            />
          ))
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-md border border-border-default px-4 text-sm text-fg-secondary hover:bg-bg-hover"
        >
          关闭
        </button>
      </div>
    </ModalShell>
  );
}

function EmptyDetail() {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-secondary p-8 text-center text-sm text-fg-tertiary">
      暂无明细记录
    </div>
  );
}

function UrlDetailCard({
  item,
  onOpenDetail,
}: {
  item: UrlCaptureHistoryRecord;
  onOpenDetail: () => void;
}) {
  const host = (() => {
    try {
      return new URL(item.sourceUrl).host;
    } catch {
      return item.sourceUrl || "-";
    }
  })();

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-secondary p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary">
          {item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 font-medium text-fg-secondary">
              <ExternalLink size={13} className="text-blue-500" />
              URL抓取
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600">
              <CheckCircle2 size={10} />
              已保存
            </span>
            <span className="text-fg-tertiary">保存 {item.addedCount} 张</span>
            <span className="text-fg-tertiary">· {formatDateTime(Math.floor(item.createdAt / 1000))}</span>
          </div>
          <div className="truncate text-xs text-fg-secondary">
            来源 {host} · 已同步到媒体文件
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <div className="text-[11px] text-fg-tertiary">花费</div>
            <div className="text-sm font-medium text-fg-primary">¥0.00</div>
          </div>
          <button
            type="button"
            onClick={onOpenDetail}
            className="rounded-md p-2 text-fg-tertiary hover:bg-bg-hover hover:text-fg-primary"
            aria-label="查看详情"
          >
            <Eye size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function AiDetailCard({
  item,
  onOpenDetail,
}: {
  item: AiRecord;
  onOpenDetail: () => void;
}) {
  const duration = formatDuration(item);
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-secondary p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary">
          {item.cover_image_url ? (
            <img
              src={item.cover_image_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-medium text-fg-secondary">
              {FEATURE_LABELS[item.feature] || item.feature}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600">
              <CheckCircle2 size={10} />
              {item.status === "completed" ? "成功" : item.status}
            </span>
            <span className="text-fg-tertiary">
              {item.completed_count}/{item.total_count}
              {item.failed_count ? (
                <span className="ml-1 text-danger">· {item.failed_count} 失败</span>
              ) : null}
            </span>
            {duration ? (
              <span className="inline-flex items-center gap-1 text-fg-tertiary">
                <Clock size={10} />
                {duration}
              </span>
            ) : null}
            <span className="text-fg-tertiary">· {formatTime(item.created_at)}</span>
          </div>
          <div className="truncate text-xs text-fg-secondary">
            {formatAiConfig(item)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <div className="text-[11px] text-fg-tertiary">花费</div>
            <div className="text-sm font-medium text-fg-primary">
              ¥{toNumber(item.total_cost_cny).toFixed(2)}
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenDetail}
            className="rounded-md p-2 text-fg-tertiary hover:bg-bg-hover hover:text-fg-primary"
            aria-label="查看详情"
          >
            <Eye size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function UrlRecordDetailModal({
  item,
  onClose,
}: {
  item: UrlCaptureHistoryRecord;
  onClose: () => void;
}) {
  return (
    <ModalShell title={`URL抓取详情 · ${item.id.slice(0, 8)}`} onClose={onClose}>
      <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Info label="状态" value="已保存" />
          <Info
            label="URL地址"
            value={
              item.sourceUrl ? (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener"
                  className="break-all text-blue-600 underline underline-offset-2"
                >
                  {item.sourceUrl}
                </a>
              ) : (
                "-"
              )
            }
          />
          <Info label="数量" value={`${item.addedCount}/${item.selectedCount}`} />
          <Info label="时间" value={formatDateTime(Math.floor(item.createdAt / 1000))} />
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-fg-tertiary">已保存图片</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {item.imageUrls.map((url, index) => (
              <Thumbnail key={`${url}-${index}`} src={url} alt="" ratio="3/4" />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-md border border-border-default px-4 text-sm text-fg-secondary hover:bg-bg-hover"
        >
          关闭
        </button>
      </div>
    </ModalShell>
  );
}

function AiRecordDetailModal({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AiJobDetail | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/jobs/${jobId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (alive) setDetail(body as AiJobDetail | null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [jobId]);

  const successful = detail?.items.filter(
    (item) => item.status === "completed" && item.result_image_url,
  );

  return (
    <ModalShell title={`任务详情 · ${jobId.slice(0, 8)}`} onClose={onClose}>
      {!detail ? (
        <div className="p-8 text-center text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-1 inline-block animate-spin" />
          加载中...
        </div>
      ) : (
        <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Info label="状态" value={detail.job.status} />
            <Info label="模型" value={detail.job.model} mono />
            <Info
              label="数量"
              value={`${detail.job.completed_count}/${detail.job.total_count} · 失败 ${detail.job.failed_count}`}
            />
            <Info
              label="花费"
              value={`¥${toNumber(detail.job.total_cost_cny).toFixed(2)}`}
            />
          </div>
          {successful && successful.length > 0 ? (
            <div>
              <div className="mb-2 text-xs font-medium text-fg-tertiary">
                已完成图片
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {successful.map((item) => (
                  <Thumbnail
                    key={item.id}
                    src={item.result_image_url!}
                    alt={item.label || ""}
                    ratio="3/4"
                  />
                ))}
              </div>
            </div>
          ) : null}
          <details className="text-xs text-fg-secondary">
            <summary className="cursor-pointer text-fg-tertiary">完整参数</summary>
            <pre className="mt-2 overflow-x-auto rounded border border-border-subtle bg-bg-tertiary p-2 text-[11px]">
              {JSON.stringify(safeParseParams(detail.job.params), null, 2)}
            </pre>
          </details>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-md border border-border-default px-4 text-sm text-fg-secondary hover:bg-bg-hover"
        >
          关闭
        </button>
      </div>
    </ModalShell>
  );
}

function Info({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
        {label}
      </div>
      <div className={`text-[13px] text-fg-primary ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-border-subtle bg-bg-primary shadow-xl">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h3 className="text-base font-semibold text-fg-primary">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xl leading-none text-fg-tertiary hover:bg-bg-hover hover:text-fg-primary"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
