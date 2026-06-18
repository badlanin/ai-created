"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Package } from "lucide-react";

type UserRow = {
  id: number;
  username: string;
  display_name: string | null;
  role: string;
};

type UploadStat = {
  source_type: string;
  upload_count: number;
  total_products: number;
};

type UploadByDay = {
  day: string;
  source_type: string;
  upload_count: number;
};

type ApiData = {
  start: string;
  end: string;
  users: UserRow[];
  uploadStats: UploadStat[];
  uploadByDay: UploadByDay[];
};

type SourceFilter = "all" | "url_capture" | "ai_generated" | "local_upload";

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

const SOURCE_LABELS: Record<string, string> = {
  url_capture: "URL抓取",
  ai_generated: "AI处理",
  local_upload: "本地上传",
};

const SOURCE_COLORS: Record<string, { bg: string; text: string; chart: string }> = {
  url_capture: { bg: "bg-blue-50", text: "text-blue-600", chart: "bg-blue-500" },
  ai_generated: { bg: "bg-violet-50", text: "text-violet-600", chart: "bg-violet-500" },
  local_upload: { bg: "bg-emerald-50", text: "text-emerald-600", chart: "bg-emerald-500" },
};

export default function ProductStatsPage() {
  const [date, setDate] = useState(defaultDateRange().end);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ApiData | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const { start, end } = useMemo(() => {
    const endDate = new Date(`${date}T00:00:00`);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    return { start: formatDay(startDate), end: formatDay(endDate) };
  }, [date]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/product-stats?start=${start}&end=${end}`)
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [start, end]);

  const computed = useMemo(() => {
    if (!data) return { totalBySource: [], chart: [], todayTotal: 0 };

    const stats = data.uploadStats || [];
    const byDay = data.uploadByDay || [];

    // 计算各来源总数
    const totalBySource = ["url_capture", "ai_generated", "local_upload"].map((sourceType) => {
      const stat = stats.find((s) => s.source_type === sourceType);
      return {
        sourceType,
        count: stat?.upload_count || 0,
      };
    });

    // 按天统计（用于图表）
    const days = enumerateDays(start, end);
    const chart = days.map((day) => {
      const urlCount = byDay.find((d) => d.day === day && d.source_type === "url_capture")?.upload_count || 0;
      const aiCount = byDay.find((d) => d.day === day && d.source_type === "ai_generated")?.upload_count || 0;
      const localCount = byDay.find((d) => d.day === day && d.source_type === "local_upload")?.upload_count || 0;
      return { day, urlCount, aiCount, localCount };
    });

    // 今日总数
    const today = formatDay(new Date());
    const todayRow = chart.find((row) => row.day === today);
    const todayTotal = (todayRow?.urlCount || 0) + (todayRow?.aiCount || 0) + (todayRow?.localCount || 0);

    return { totalBySource, chart, todayTotal };
  }, [data, start, end]);

  function exportCsv() {
    const lines = [
      ["日期", "URL抓取", "AI处理", "本地上传", "合计"],
      ...computed.chart.map((row) => [
        row.day,
        String(row.urlCount),
        String(row.aiCount),
        String(row.localCount),
        String(row.urlCount + row.aiCount + row.localCount),
      ]),
    ];
    const csv = lines
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `产品上架统计_${start}_${end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const maxChartValue = Math.max(
    1,
    ...computed.chart.map((row) => row.urlCount + row.aiCount + row.localCount)
  );

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-fg-primary">产品上架统计</h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          统计点击"上架"按钮的产品数量（按来源分类）
        </p>
      </header>

      <section className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-bg-secondary p-4 shadow-sm">
        <label className="text-xs text-fg-tertiary">
          日期
          <div className="mt-1">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-md border border-border-default bg-bg-primary px-3 text-sm text-fg-primary"
            />
          </div>
        </label>
        <div className="flex flex-col text-xs text-fg-tertiary">
          来源
          <div className="mt-1 inline-flex h-9 rounded-md border border-border-default bg-bg-primary p-0.5">
            {[
              ["all", "全部"],
              ["url_capture", "URL抓取"],
              ["ai_generated", "AI处理"],
              ["local_upload", "本地上传"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSourceFilter(value as SourceFilter)}
                className={`rounded px-3 text-sm ${
                  sourceFilter === value
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
          disabled={loading || !data}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-border-default bg-bg-primary px-3 text-sm text-fg-secondary hover:bg-bg-secondary disabled:opacity-50"
        >
          <Download size={14} />
          导出 CSV
        </button>
      </section>

      {loading ? (
        <div className="p-8 text-center text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-1 inline-block animate-spin" />
          加载中...
        </div>
      ) : (
        <>
          <section className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-4">
            <StatCard label="今日总数" value={computed.todayTotal} icon={<Package size={16} />} />
            <StatCard
              label="URL抓取"
              value={computed.totalBySource.find((s) => s.sourceType === "url_capture")?.count || 0}
              tone="blue"
            />
            <StatCard
              label="AI处理"
              value={computed.totalBySource.find((s) => s.sourceType === "ai_generated")?.count || 0}
              tone="purple"
            />
            <StatCard
              label="本地上传"
              value={computed.totalBySource.find((s) => s.sourceType === "local_upload")?.count || 0}
              tone="green"
            />
          </section>

          <section className="mb-5 rounded-lg border border-border-subtle bg-bg-secondary p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-fg-primary">
                每日上架数量趋势
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
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  本地上传
                </span>
              </div>
            </div>
            <div className="flex h-64 items-end gap-2 border-b border-border-subtle pb-4">
              {computed.chart.map((row) => {
                const urlHeight = (row.urlCount / maxChartValue) * 100;
                const aiHeight = (row.aiCount / maxChartValue) * 100;
                const localHeight = (row.localCount / maxChartValue) * 100;
                const shouldShow =
                  sourceFilter === "all" ||
                  (sourceFilter === "url_capture" && row.urlCount > 0) ||
                  (sourceFilter === "ai_generated" && row.aiCount > 0) ||
                  (sourceFilter === "local_upload" && row.localCount > 0);

                if (!shouldShow && sourceFilter !== "all") return null;

                return (
                  <div key={row.day} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <div className="flex h-48 w-full items-end justify-center gap-1">
                      {(sourceFilter === "all" || sourceFilter === "url_capture") && (
                        <div
                          className="w-3 rounded-t bg-blue-500"
                          style={{ height: `${Math.max(4, urlHeight)}%` }}
                          title={`URL抓取 ${row.urlCount}`}
                        />
                      )}
                      {(sourceFilter === "all" || sourceFilter === "ai_generated") && (
                        <div
                          className="w-3 rounded-t bg-violet-500"
                          style={{ height: `${Math.max(4, aiHeight)}%` }}
                          title={`AI处理 ${row.aiCount}`}
                        />
                      )}
                      {(sourceFilter === "all" || sourceFilter === "local_upload") && (
                        <div
                          className="w-3 rounded-t bg-emerald-500"
                          style={{ height: `${Math.max(4, localHeight)}%` }}
                          title={`本地上传 ${row.localCount}`}
                        />
                      )}
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
              每日明细
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-xs text-fg-tertiary">
                    <th className="py-2 text-left">日期</th>
                    <th className="py-2 text-right">URL抓取</th>
                    <th className="py-2 text-right">AI处理</th>
                    <th className="py-2 text-right">本地上传</th>
                    <th className="py-2 text-right">合计</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.chart.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-fg-tertiary">
                        暂无统计记录
                      </td>
                    </tr>
                  ) : (
                    computed.chart.map((row) => (
                      <tr key={row.day} className="border-b border-border-subtle hover:bg-bg-tertiary">
                        <td className="py-2 text-fg-secondary">{row.day}</td>
                        <td className="py-2 text-right text-fg-primary">{row.urlCount}</td>
                        <td className="py-2 text-right text-fg-primary">{row.aiCount}</td>
                        <td className="py-2 text-right text-fg-primary">{row.localCount}</td>
                        <td className="py-2 text-right font-medium text-fg-primary">
                          {row.urlCount + row.aiCount + row.localCount}
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
    </main>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone?: "blue" | "purple" | "green";
  icon?: React.ReactNode;
}) {
  const colorClass =
    tone === "blue"
      ? "text-blue-600"
      : tone === "purple"
      ? "text-violet-600"
      : tone === "green"
      ? "text-emerald-600"
      : "text-fg-primary";

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-primary p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-fg-tertiary">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
    </div>
  );
}
