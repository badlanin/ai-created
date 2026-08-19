"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";

type Job = {
  id: string;
  name: string;
  status: "imported" | "running" | "completed" | "failed";
  phase: string;
  total_count: number;
  collected_count: number;
  failed_count: number;
  created_at: number;
  updated_at: number;
};

type ItemStatus =
  | "queued"
  | "collecting"
  | "cleaning"
  | "ai_ready"
  | "completed"
  | "failed";

type Item = {
  id: number;
  jobId: string;
  url: string;
  status: ItemStatus;
  sourceTitle: string;
  price: string;
  color: string;
  sizes: string[];
  imageUrls: string[];
  productId: string;
  aiTitle: string;
  aiBullets: string[];
  searchTerms: string;
  excelRange: string;
  errorMessage: string;
};

type Mapping = {
  id: number;
  source_field: string;
  sample_value: string;
  excel_column: string;
  target_label: string;
  data_type: string;
  required: number;
  clean_rule: string;
};

type LogRow = {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  created_at: number;
};

type DashboardData = {
  job: Job | null;
  summary: {
    total: number;
    collected: number;
    pending: number;
    failed: number;
  };
  items: Item[];
  logs: LogRow[];
  mappings: Mapping[];
};

const EMPTY_DASHBOARD: DashboardData = {
  job: null,
  summary: { total: 0, collected: 0, pending: 0, failed: 0 },
  items: [],
  logs: [],
  mappings: [],
};

const TABS = ["供应商采集", "上架资料生成", "Excel模板", "AI模板", "任务记录"];
const STEPS = ["链接导入", "页面采集", "字段清洗", "AI整理", "写入Excel"];

export default function AmazonInfoCollectionPage() {
  const [data, setData] = useState<DashboardData>(EMPTY_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ItemStatus>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const autoStartedJobIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const res = await fetch("/api/amazon-info-collection/dashboard", {
        cache: "no-store",
      });
      const json = (await res.json()) as DashboardData | { error?: string };
      if (!res.ok) throw new Error("error" in json ? json.error : res.statusText);
      setData(json as DashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (data.job?.status !== "running") return;
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [data.job?.status, load]);

  useEffect(() => {
    if (!data.job || data.job.status !== "imported" || data.summary.pending === 0) return;
    if (autoStartedJobIdRef.current === data.job.id) return;
    autoStartedJobIdRef.current = data.job.id;
    void startCollection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.job?.id, data.job?.status, data.summary.pending]);

  useEffect(() => {
    if (selectedId && data.items.some((item) => item.id === selectedId)) return;
    setSelectedId(data.items[0]?.id ?? null);
  }, [data.items, selectedId]);

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return data.items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!keyword) return true;
      return [item.url, item.sourceTitle, item.aiTitle, item.productId]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [data.items, query, statusFilter]);

  const selectedItem =
    data.items.find((item) => item.id === selectedId) || data.items[0] || null;

  async function importLinks() {
    if (!importText.trim()) {
      setError("请先粘贴供应商商品链接。");
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch("/api/amazon-info-collection/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: importText }),
      });
      const json = (await res.json()) as DashboardData | { error?: string };
      if (!res.ok) throw new Error("error" in json ? json.error : res.statusText);
      setData(json as DashboardData);
      setImportOpen(false);
      setImportText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(false);
    }
  }

  async function startCollection() {
    setActionLoading(true);
    try {
      const res = await fetch("/api/amazon-info-collection/jobs/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: data.job?.id }),
      });
      const json = (await res.json()) as DashboardData | { error?: string };
      if (!res.ok) throw new Error("error" in json ? json.error : res.statusText);
      setData(json as DashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(false);
    }
  }

  function exportExcel() {
    if (!data.job) {
      setError("没有可导出的任务。");
      return;
    }
    window.location.href = `/api/amazon-info-collection/export?jobId=${encodeURIComponent(data.job.id)}`;
  }

  const currentStep = getCurrentStep(data.job);
  const running = data.job?.status === "running";

  return (
    <main className="min-h-screen bg-bg-primary text-fg-primary">
      <header className="border-b border-border-subtle bg-bg-secondary px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">亚马逊信息采集</h1>
            <p className="mt-1 text-[12px] text-fg-tertiary">
              供应商商品链接采集 · AI整理 · Excel填充
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setImportOpen((v) => !v)}>
              <Upload size={14} />
              导入链接
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={startCollection}
              disabled={actionLoading || !data.job || running}
            >
              {actionLoading || running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              开始采集
            </button>
            <button className="btn btn-secondary btn-sm" onClick={exportExcel} disabled={!data.job}>
              <Download size={14} />
              导出Excel
            </button>
          </div>
        </div>

        <div className="mt-5 flex gap-6 border-b border-border-subtle">
          {TABS.map((tab) => (
            <button
              key={tab}
              className={
                tab === "供应商采集"
                  ? "border-b-2 border-brand-500 px-0 pb-3 text-[13px] font-semibold text-brand-500"
                  : "px-0 pb-3 text-[13px] text-fg-secondary hover:text-fg-primary"
              }
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      <section className="p-6">
        {error ? (
          <div className="mb-4 rounded-md border border-[rgba(239,68,68,0.25)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {importOpen ? (
          <div className="mb-4 rounded-md border border-border-default bg-bg-secondary p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">导入供应商商品链接</h2>
                <p className="mt-0.5 text-[12px] text-fg-tertiary">
                  每行一个商品详情页链接，系统会自动去重并创建新任务。
                </p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setImportOpen(false)}>
                收起
              </button>
            </div>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={5}
              className="w-full rounded-md border border-border-default bg-bg-primary px-3 py-2 text-sm outline-none focus:border-brand-500"
              placeholder="https://www.lightinthebox.com/..."
            />
            <div className="mt-3 flex justify-end">
              <button className="btn btn-primary btn-sm" onClick={importLinks} disabled={actionLoading}>
                {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                确认导入
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-4 gap-3">
          <MetricCard icon={<LinkIcon size={18} />} label="链接总数" value={data.summary.total} tone="brand" />
          <MetricCard icon={<CheckCircle2 size={18} />} label="已采集" value={data.summary.collected} tone="success" />
          <MetricCard icon={<Clock3 size={18} />} label="待处理" value={data.summary.pending} tone="warn" />
          <MetricCard icon={<AlertTriangle size={18} />} label="异常" value={data.summary.failed} tone="danger" />
        </div>

        <div className="mt-4 rounded-md border border-border-default bg-bg-secondary p-4 shadow-sm">
          <div className="grid grid-cols-5 items-center gap-2">
            {STEPS.map((step, index) => (
              <div key={step} className="flex items-center gap-2">
                <div
                  className={
                    index <= currentStep
                      ? "flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-sm font-semibold text-white"
                      : "flex h-8 w-8 items-center justify-center rounded-full border border-border-default text-sm font-semibold text-fg-tertiary"
                  }
                >
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">{step}</div>
                  <div className="truncate text-[11px] text-fg-tertiary">
                    {index < currentStep ? "已完成" : index === currentStep ? data.job?.phase || "等待处理" : "等待处理"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_360px] gap-4">
          <section className="rounded-md border border-border-default bg-bg-secondary shadow-sm">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <h2 className="text-sm font-semibold">商品详情采集结果</h2>
              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as "all" | ItemStatus)}
                  className="h-8 rounded-md border border-border-default bg-bg-primary px-2 text-xs outline-none"
                >
                  <option value="all">全部状态</option>
                  <option value="completed">完成</option>
                  <option value="queued">待处理</option>
                  <option value="collecting">采集中</option>
                  <option value="failed">失败</option>
                </select>
                <div className="flex h-8 items-center gap-2 rounded-md border border-border-default bg-bg-primary px-2">
                  <Search size={13} className="text-fg-tertiary" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="w-44 bg-transparent text-xs outline-none"
                    placeholder="搜索链接或标题"
                  />
                </div>
                <button className="btn btn-secondary btn-sm" onClick={load}>
                  <RefreshCw size={13} />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-[12px]">
                <thead className="bg-bg-tertiary text-fg-secondary">
                  <tr>
                    <Th>状态</Th>
                    <Th>商品链接</Th>
                    <Th>原始标题</Th>
                    <Th>价格</Th>
                    <Th>颜色</Th>
                    <Th>尺码</Th>
                    <Th>图片数</Th>
                    <Th>AI状态</Th>
                    <Th>Excel列</Th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-fg-tertiary">
                        <Loader2 size={18} className="mr-2 inline animate-spin" />
                        加载中
                      </td>
                    </tr>
                  ) : filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-fg-tertiary">
                        暂无数据，请先导入供应商链接。
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedId(item.id)}
                        className={
                          selectedId === item.id
                            ? "cursor-pointer border-b border-border-subtle bg-[var(--brand-50-bg)]"
                            : "cursor-pointer border-b border-border-subtle hover:bg-bg-hover"
                        }
                      >
                        <Td><StatusBadge status={item.status} /></Td>
                        <Td><span className="block max-w-[180px] truncate text-brand-500">{item.url}</span></Td>
                        <Td><span className="block max-w-[220px] truncate">{item.sourceTitle || "-"}</span></Td>
                        <Td>{item.price || "-"}</Td>
                        <Td>{item.color || "-"}</Td>
                        <Td>{item.sizes.join(",") || "-"}</Td>
                        <Td>{item.imageUrls.length}</Td>
                        <Td>{item.aiTitle ? <span className="text-success">已完成</span> : "-"}</Td>
                        <Td>{item.excelRange || "-"}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-[12px] text-fg-tertiary">
              <span>共 {filteredItems.length} 条</span>
              <span>{data.job ? `任务ID：${data.job.id.slice(0, 8)}` : "未创建任务"}</span>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-md border border-border-default bg-bg-secondary p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">当前商品预览</h2>
                {selectedItem?.url ? (
                  <a
                    href={selectedItem.url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary btn-sm"
                  >
                    <ExternalLink size={13} />
                    打开
                  </a>
                ) : null}
              </div>
              {selectedItem ? (
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-bg-tertiary">
                    {selectedItem.imageUrls[0] ? (
                      <img src={selectedItem.imageUrls[0]} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <FileText size={28} className="text-fg-muted" />
                    )}
                  </div>
                  <div className="overflow-hidden rounded-md border border-border-subtle text-[12px]">
                    <PreviewRow label="标题" value={selectedItem.sourceTitle || "-"} />
                    <PreviewRow label="颜色" value={selectedItem.color || "-"} />
                    <PreviewRow label="尺码" value={selectedItem.sizes.join(",") || "-"} />
                    <PreviewRow label="商品ID" value={selectedItem.productId || "-"} />
                    <PreviewRow label="价格" value={selectedItem.price || "-"} />
                    <PreviewRow label="图片数" value={String(selectedItem.imageUrls.length)} />
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border-default py-10 text-center text-sm text-fg-tertiary">
                  请选择商品
                </div>
              )}
            </section>

            <section className="rounded-md border border-border-default bg-bg-secondary p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">AI整理结果（亚马逊优化）</h2>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => selectedItem?.aiTitle && navigator.clipboard?.writeText(selectedItem.aiTitle)}
                  disabled={!selectedItem?.aiTitle}
                >
                  <Copy size={13} />
                  复制
                </button>
              </div>
              {selectedItem?.aiTitle ? (
                <div className="rounded-md border border-border-subtle bg-bg-primary p-3 text-[12px] leading-6">
                  <div className="font-semibold">优化标题</div>
                  <p>{selectedItem.aiTitle}</p>
                  <div className="mt-3 font-semibold">五点卖点</div>
                  <ul className="list-disc pl-5">
                    {selectedItem.aiBullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                  <div className="mt-3 font-semibold">Search Terms</div>
                  <p className="text-fg-secondary">{selectedItem.searchTerms || "-"}</p>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border-default py-10 text-center text-sm text-fg-tertiary">
                  采集完成后自动生成
                </div>
              )}
            </section>
          </aside>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <section className="rounded-md border border-border-default bg-bg-secondary shadow-sm">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <h2 className="text-sm font-semibold">Excel字段映射</h2>
              <button className="btn btn-secondary btn-sm" disabled>
                编辑映射
              </button>
            </div>
            <table className="w-full border-collapse text-left text-[12px]">
              <thead className="bg-bg-tertiary text-fg-secondary">
                <tr>
                  <Th>原始字段</Th>
                  <Th>示例数据</Th>
                  <Th>Excel列</Th>
                  <Th>目标列名</Th>
                  <Th>必填</Th>
                  <Th>清洗规则</Th>
                </tr>
              </thead>
              <tbody>
                {data.mappings.map((mapping) => (
                  <tr key={mapping.id} className="border-b border-border-subtle">
                    <Td>{mapping.source_field}</Td>
                    <Td><span className="block max-w-[150px] truncate">{mapping.sample_value}</span></Td>
                    <Td>{mapping.excel_column}</Td>
                    <Td>{mapping.target_label}</Td>
                    <Td>{mapping.required ? <CheckCircle2 size={14} className="text-success" /> : <Clock3 size={14} className="text-warn" />}</Td>
                    <Td>{mapping.clean_rule}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-md border border-border-default bg-bg-secondary shadow-sm">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <h2 className="text-sm font-semibold">运行日志</h2>
              <button className="btn btn-secondary btn-sm" onClick={load}>
                <RefreshCw size={13} />
                刷新
              </button>
            </div>
            <div className="max-h-[260px] overflow-y-auto">
              {data.logs.length === 0 ? (
                <div className="py-12 text-center text-sm text-fg-tertiary">暂无日志</div>
              ) : (
                data.logs.map((log) => (
                  <div key={log.id} className="grid grid-cols-[76px_52px_minmax(0,1fr)] gap-2 border-b border-border-subtle px-4 py-2 text-[12px]">
                    <span className="text-fg-tertiary">{formatTime(log.created_at)}</span>
                    <span className={log.level === "error" ? "text-danger" : log.level === "warn" ? "text-warn" : "text-brand-500"}>
                      [{log.level === "error" ? "错误" : log.level === "warn" ? "警告" : "信息"}]
                    </span>
                    <span className="truncate">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "brand" | "success" | "warn" | "danger";
}) {
  const toneClass =
    tone === "brand"
      ? "bg-[var(--brand-50-bg)] text-brand-500"
      : tone === "success"
        ? "bg-[rgba(16,185,129,0.08)] text-success"
        : tone === "warn"
          ? "bg-[rgba(245,158,11,0.08)] text-warn"
          : "bg-[var(--danger-bg)] text-danger";
  return (
    <div className="rounded-md border border-border-default bg-bg-secondary p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${toneClass}`}>{icon}</div>
        <div>
          <div className="text-[12px] text-fg-tertiary">{label}</div>
          <div className="text-2xl font-bold leading-tight">{value}</div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ItemStatus }) {
  const label: Record<ItemStatus, string> = {
    queued: "待处理",
    collecting: "采集中",
    cleaning: "清洗中",
    ai_ready: "AI完成",
    completed: "完成",
    failed: "失败",
  };
  const className =
    status === "completed" || status === "ai_ready"
      ? "bg-[rgba(16,185,129,0.1)] text-success"
      : status === "failed"
        ? "bg-[var(--danger-bg)] text-danger"
        : status === "collecting" || status === "cleaning"
          ? "bg-[var(--brand-50-bg)] text-brand-500"
          : "bg-[rgba(245,158,11,0.1)] text-warn";
  return <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-medium ${className}`}>{label[status]}</span>;
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[58px_minmax(0,1fr)] border-b border-border-subtle last:border-b-0">
      <div className="bg-bg-tertiary px-2 py-2 text-fg-secondary">{label}</div>
      <div className="truncate px-2 py-2">{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="border-b border-border-subtle px-3 py-2 font-semibold">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 align-middle">{children}</td>;
}

function getCurrentStep(job: Job | null) {
  if (!job) return 0;
  if (job.phase.includes("页面")) return 1;
  if (job.phase.includes("字段")) return 2;
  if (job.phase.includes("AI")) return 3;
  if (job.phase.includes("Excel") || job.phase.includes("完成")) return 4;
  return 0;
}

function formatTime(seconds: number) {
  const date = new Date(seconds * 1000);
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
