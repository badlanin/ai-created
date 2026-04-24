"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Palette,
  Camera,
  Clock,
  CheckCircle2,
  AlertOctagon,
  CircleOff,
  Download,
  Trash2,
  ExternalLink,
  Eye,
  Search,
  Users,
  Loader2,
} from "lucide-react";
import {
  Button,
  Card,
  Chip,
  Dialog,
  IconButton,
  Input,
  Select,
  Tabs,
  type TabItem,
} from "@/app/_components/ui";
import { Thumbnail } from "@/app/_components/thumbnail";
import {
  downloadImagesAsZip,
  downloadSingleImage,
} from "@/lib/download-zip";

type Me = {
  id: number;
  username: string;
  role: "admin" | "user";
  display_name: string | null;
};

type JobRow = {
  id: string;
  user_id: number;
  username: string | null;
  display_name: string | null;
  feature: "recolor" | "batch_photo";
  model: string;
  status: "running" | "canceling" | "canceled" | "completed" | "failed";
  total_count: number;
  completed_count: number;
  failed_count: number;
  canceled_count: number;
  total_cost_cny: number;
  params: string | null;
  error_message: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  cover_image_url: string | null;
};

type Stats = {
  active: number;
  completed: number;
  failed: number;
  canceled: number;
  total: number;
};

type StatusTab = "all" | "active" | "completed" | "failed";
type FeatureTab = "all" | "recolor" | "batch_photo";

function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(job: JobRow): string | null {
  if (!job.started_at || !job.finished_at) return null;
  const s = job.finished_at - job.started_at;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function safeParseParams(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function formatConfig(job: JobRow): string {
  const p = safeParseParams(job.params);
  const chips: string[] = [];
  if (job.feature === "recolor") {
    const colors = Array.isArray(p.colors)
      ? (p.colors as Array<{ name: string }>)
      : [];
    if (colors.length) {
      chips.push(`${colors.length} 色: ${colors.map((c) => c.name).join(" / ")}`);
    }
    if (typeof p.image_count === "number") chips.push(`${p.image_count} 图`);
  } else {
    if (p.identity_name) chips.push(`模特: ${p.identity_name as string}`);
    if (p.scene_name) chips.push(`场景: ${p.scene_name as string}`);
    if (Array.isArray(p.pose_names)) {
      const pns = p.pose_names as string[];
      if (pns.length) chips.push(`${pns.length} 姿势`);
    }
  }
  if (p.quality_level) chips.push(String(p.quality_level).toUpperCase());
  if (p.realism_name) chips.push(`${p.realism_name}`);
  return chips.join(" · ");
}

export default function HistoryPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<JobRow[]>([]);
  const [stats, setStats] = useState<Stats>({
    active: 0,
    completed: 0,
    failed: 0,
    canceled: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  /** 支持 ?status=active|completed|failed|all URL 参数初始化 tab */
  const initialStatus = (() => {
    const s = searchParams?.get("status");
    if (s === "active" || s === "completed" || s === "failed") return s;
    return "all";
  })();
  const [statusTab, setStatusTab] = useState<StatusTab>(initialStatus);
  const [featureTab, setFeatureTab] = useState<FeatureTab>("all");
  const [scope, setScope] = useState<"me" | "all">("me");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const limit = 20;
  const [total, setTotal] = useState(0);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);

  // 多选
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        status: statusTab,
        feature: featureTab,
        scope,
        page: String(page),
        limit: String(limit),
      });
      const r = await fetch(`/api/jobs/list?${qs.toString()}`);
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      const body = (await r.json()) as {
        items: JobRow[];
        total: number;
        stats: Stats;
      };
      setItems(body.items);
      setTotal(body.total);
      setStats(body.stats);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [statusTab, featureTab, scope, page]);

  useEffect(() => {
    load();
  }, [load]);

  // 搜索过滤（本地，对当前页生效）
  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      const cfg = formatConfig(it).toLowerCase();
      const label = (it.display_name || it.username || "").toLowerCase();
      return (
        cfg.includes(q) ||
        label.includes(q) ||
        it.id.toLowerCase().includes(q) ||
        it.feature.includes(q)
      );
    });
  }, [items, search]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const statusTabs: TabItem[] = [
    { key: "all", label: "全部", badge: stats.total },
    {
      key: "active",
      label: "进行中",
      badge: stats.active > 0 ? stats.active : undefined,
    },
    { key: "completed", label: "已完成", badge: stats.completed },
    {
      key: "failed",
      label: "失败",
      badge: stats.failed > 0 ? stats.failed : undefined,
    },
  ];

  const featureTabs: TabItem[] = [
    { key: "all", label: "全部功能" },
    { key: "recolor", label: "换色" },
    { key: "batch_photo", label: "批量摄影图" },
  ];

  // ─── 批量操作 ───
  function toggleJob(id: string) {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllOnPage() {
    setSelectedJobIds(new Set(filteredItems.map((it) => it.id)));
  }
  function clearSelection() {
    setSelectedJobIds(new Set());
  }

  async function downloadSelected() {
    const ids = [...selectedJobIds];
    if (ids.length === 0) return;
    setZipping(true);
    try {
      // 逐个 job 取 items，合并成一个大 ZIP
      const allEntries: Array<{ url: string; filename: string }> = [];
      for (const id of ids) {
        const r = await fetch(`/api/jobs/${id}`);
        if (!r.ok) continue;
        const body = (await r.json()) as {
          items: Array<{
            idx: number;
            status: string;
            label: string | null;
            result_image_url: string | null;
          }>;
          job: { id: string };
        };
        for (const it of body.items) {
          if (it.status !== "completed" || !it.result_image_url) continue;
          const safeLabel = (it.label || `item_${it.idx + 1}`).replace(
            /[/\\?%*:|"<>]/g,
            "_",
          );
          allEntries.push({
            url: it.result_image_url,
            filename: `${id.slice(0, 8)}_${safeLabel}.png`,
          });
        }
      }
      if (allEntries.length === 0) {
        alert("选中的任务里没有成功的图片");
        return;
      }
      await downloadImagesAsZip(allEntries, `history_${Date.now()}.zip`);
    } finally {
      setZipping(false);
    }
  }

  async function deleteSelectedJobs() {
    const ids = [...selectedJobIds];
    if (ids.length === 0) return;
    if (
      !confirm(
        `确定删除选中的 ${ids.length} 个任务吗？\n\n对应的图片文件也会从服务器删除。此操作不可撤销。`,
      )
    )
      return;
    setDeleting(true);
    try {
      // 按 job_id 找对应 generations 并删，同时也删 render_jobs 记录
      // 当前只用 generations 表 DELETE API —— render_jobs 可通过 user_id 级别的清理
      // 这里简化：用 /api/jobs/list 之前会触发生成的 generations 记录来删
      // 更彻底的是新加 DELETE /api/jobs/:id —— 这里直接加
      for (const id of ids) {
        await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      }
      clearSelection();
      load();
    } catch (e) {
      alert("删除失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-8">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">历史记录</h1>
        <p className="mt-1 text-sm text-gray-500">
          {scope === "all" ? "全团队" : "我的"}所有任务 · 共 {total} 条
        </p>
      </header>

      {/* Tabs 行 */}
      <div className="mb-4 flex flex-wrap items-center gap-3 justify-between">
        <Tabs
          items={statusTabs}
          value={statusTab}
          onChange={(k) => {
            setStatusTab(k as StatusTab);
            setPage(1);
          }}
        />
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            placeholder="搜索模特名 / 颜色 / id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftAddon={<Search size={12} strokeWidth={2} />}
            className="w-56"
          />
          <Select
            size="sm"
            value={featureTab}
            onChange={(e) => {
              setFeatureTab(e.target.value as FeatureTab);
              setPage(1);
            }}
          >
            <option value="all">全部功能</option>
            <option value="recolor">换色</option>
            <option value="batch_photo">批量摄影</option>
          </Select>
          {me?.role === "admin" ? (
            <Select
              size="sm"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as "me" | "all");
                setPage(1);
              }}
            >
              <option value="me">我的</option>
              <option value="all">全团队</option>
            </Select>
          ) : null}
        </div>
      </div>

      {/* 批量工具栏（选中任何后出现） */}
      {selectedJobIds.size > 0 ? (
        <div className="sticky top-2 z-20 mb-4 p-3 rounded-xl bg-blue-50 border border-blue-200 shadow-sm flex flex-wrap items-center gap-2 text-sm">
          <span className="text-blue-900 font-medium">
            已选 {selectedJobIds.size} 个任务
          </span>
          <Button size="sm" variant="outline" onClick={selectAllOnPage}>
            全选本页
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            清空选择
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={zipping}
            leftIcon={<Download size={13} strokeWidth={2} />}
            onClick={downloadSelected}
          >
            下载选中图片 ZIP
          </Button>
          <Button
            size="sm"
            variant="danger-outline"
            loading={deleting}
            leftIcon={<Trash2 size={13} strokeWidth={2} />}
            onClick={deleteSelectedJobs}
          >
            删除选中
          </Button>
        </div>
      ) : null}

      {/* 管理员清空某用户 */}
      {me?.role === "admin" && scope === "all" ? (
        <AdminBulkClear onDone={load} />
      ) : null}

      {/* 任务列表 */}
      {loading ? (
        <div className="p-8 text-center text-sm text-gray-400">
          <Loader2 size={16} className="inline-block animate-spin mr-1" />
          加载中…
        </div>
      ) : filteredItems.length === 0 ? (
        <Card padding="lg" className="text-center text-sm text-gray-500">
          {search.trim()
            ? "没有匹配的任务"
            : statusTab === "active"
              ? "暂无进行中的任务"
              : "还没有历史记录"}
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              showUser={scope === "all"}
              selected={selectedJobIds.has(job.id)}
              onToggleSelect={() => toggleJob(job.id)}
              onOpenDetail={() => setDetailJobId(job.id)}
            />
          ))}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 ? (
        <div className="mt-5 flex items-center justify-center gap-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className="text-gray-500 tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </Button>
        </div>
      ) : null}

      {/* 详情弹窗 */}
      {detailJobId ? (
        <JobDetailDialog
          jobId={detailJobId}
          onClose={() => setDetailJobId(null)}
        />
      ) : null}
    </main>
  );
}

/* ═════════════ JobCard ═════════════ */

function JobCard({
  job,
  showUser,
  selected,
  onToggleSelect,
  onOpenDetail,
}: {
  job: JobRow;
  showUser: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpenDetail: () => void;
}) {
  const featureIcon =
    job.feature === "recolor" ? (
      <Palette size={14} strokeWidth={2} className="text-blue-600" />
    ) : (
      <Camera size={14} strokeWidth={2} className="text-pink-600" />
    );
  const featureLabel = job.feature === "recolor" ? "换色" : "批量摄影";

  const statusConfig: Record<
    JobRow["status"],
    {
      tone: "brand" | "success" | "warn" | "danger" | "gray";
      label: string;
      icon: React.ReactNode;
    }
  > = {
    running: {
      tone: "brand",
      label: "进行中",
      icon: <Loader2 size={10} className="animate-spin" />,
    },
    canceling: {
      tone: "warn",
      label: "取消中",
      icon: <Loader2 size={10} className="animate-spin" />,
    },
    completed: {
      tone: "success",
      label: "成功",
      icon: <CheckCircle2 size={10} />,
    },
    failed: {
      tone: "danger",
      label: "失败",
      icon: <AlertOctagon size={10} />,
    },
    canceled: {
      tone: "gray",
      label: "已停止",
      icon: <CircleOff size={10} />,
    },
  };
  const statusInfo = statusConfig[job.status] || statusConfig.completed;

  const duration = formatDuration(job);

  return (
    <Card
      padding="none"
      className={`overflow-hidden transition ${
        selected ? "ring-2 ring-blue-500" : "hover:border-gray-300"
      }`}
    >
      <div className="flex items-center gap-3 p-3">
        {/* 复选框 */}
        <button
          type="button"
          onClick={onToggleSelect}
          className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center text-[10px] transition-colors ${
            selected
              ? "bg-blue-600 border-blue-600 text-white"
              : "bg-white border-gray-300 hover:border-gray-400"
          }`}
          aria-label={selected ? "取消选择" : "选择"}
        >
          {selected ? "✓" : ""}
        </button>

        {/* 封面缩略图 */}
        <div className="shrink-0">
          {job.cover_image_url ? (
            <Thumbnail
              src={job.cover_image_url}
              alt=""
              ratio="3/4"
              fit="contain"
              className="!w-12 !rounded-lg"
            />
          ) : (
            <div className="w-12 aspect-[3/4] rounded-lg bg-gray-100 flex items-center justify-center">
              {featureIcon}
            </div>
          )}
        </div>

        {/* 主体 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-700 font-medium">
              {featureIcon}
              {featureLabel}
            </span>
            <Chip tone={statusInfo.tone} icon={statusInfo.icon}>
              {statusInfo.label}
            </Chip>
            <span className="text-[11px] text-gray-400 tabular-nums">
              {job.completed_count}/{job.total_count}
              {job.failed_count > 0 ? (
                <span className="ml-1 text-red-500">
                  · {job.failed_count} 失败
                </span>
              ) : null}
            </span>
            {duration ? (
              <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
                <Clock size={10} />
                {duration}
              </span>
            ) : null}
            <span className="text-[11px] text-gray-400">
              · {formatTime(job.created_at)}
            </span>
            {showUser && job.username ? (
              <span className="text-[11px] text-gray-500">
                @{job.display_name || job.username}
              </span>
            ) : null}
          </div>
          <div className="text-[12px] text-gray-600 truncate">
            {formatConfig(job) || "-"}
          </div>
          {job.error_message ? (
            <div className="mt-1 text-[11px] text-red-600 truncate">
              ⚠ {job.error_message}
            </div>
          ) : null}
        </div>

        {/* 右侧价 + 操作 */}
        <div className="shrink-0 flex items-center gap-3">
          <div className="text-right">
            <div className="text-[11px] text-gray-400 leading-tight">
              花费
            </div>
            <div className="text-sm font-medium text-gray-900 tabular-nums">
              ¥{job.total_cost_cny.toFixed(2)}
            </div>
          </div>
          <IconButton
            icon={<Eye size={14} strokeWidth={2} />}
            aria-label="查看详情"
            size="sm"
            onClick={onOpenDetail}
          />
        </div>
      </div>
    </Card>
  );
}

/* ═════════════ Detail Dialog ═════════════ */

function JobDetailDialog({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{
    job: JobRow;
    items: Array<{
      id: number;
      idx: number;
      status: string;
      label: string | null;
      result_image_url: string | null;
      cost_cny: number | null;
      error_message: string | null;
    }>;
  } | null>(null);
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    fetch(`/api/jobs/${jobId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, [jobId]);

  const successful = data?.items.filter(
    (it) => it.status === "completed" && it.result_image_url,
  );

  async function downloadAll() {
    if (!successful || successful.length === 0) return;
    setZipping(true);
    try {
      await downloadImagesAsZip(
        successful.map((it) => ({
          url: it.result_image_url!,
          filename: `${(it.label || `item_${it.idx + 1}`).replace(/[/\\?%*:|"<>]/g, "_")}.png`,
        })),
        `job_${jobId.slice(0, 8)}.zip`,
      );
    } finally {
      setZipping(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      width="xl"
      title={`任务详情 · ${jobId.slice(0, 8)}`}
      footer={
        successful && successful.length > 0 ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
            <Button
              variant="primary"
              leftIcon={<Download size={13} strokeWidth={2} />}
              loading={zipping}
              onClick={downloadAll}
            >
              下载全部 ({successful.length}) ZIP
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        )
      }
    >
      {!data ? (
        <div className="p-4 text-center text-gray-400 text-sm">加载中…</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Info label="状态" value={data.job.status} />
            <Info label="模型" value={data.job.model} mono />
            <Info
              label="数量"
              value={`${data.job.completed_count}/${data.job.total_count} · 失败 ${data.job.failed_count}`}
            />
            <Info
              label="花费"
              value={`¥${data.job.total_cost_cny.toFixed(2)}`}
            />
          </div>
          {successful && successful.length > 0 ? (
            <div>
              <div className="section-label mb-2">已完成图片</div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {successful.map((it) => (
                  <Thumbnail
                    key={it.id}
                    src={it.result_image_url!}
                    alt={it.label || `#${it.idx + 1}`}
                    ratio="3/4"
                    hoverOverlay={
                      <a
                        href={it.result_image_url!}
                        target="_blank"
                        rel="noopener"
                        className="btn btn-secondary btn-sm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={12} /> 原图
                      </a>
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer text-gray-500">完整参数</summary>
            <pre className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded overflow-x-auto text-[11px]">
              {JSON.stringify(safeParseParams(data.job.params), null, 2)}
            </pre>
          </details>
        </div>
      )}
    </Dialog>
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
      <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
        {label}
      </div>
      <div className={`text-[13px] text-gray-900 ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}

/* ═════════════ 管理员清空某用户 ═════════════ */

function AdminBulkClear({ onDone }: { onDone: () => void }) {
  const [users, setUsers] = useState<
    Array<{ id: number; username: string; display_name: string | null }>
  >([]);
  const [selectedUserId, setSelectedUserId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (Array.isArray(list)) setUsers(list);
      })
      .catch(() => {});
  }, []);

  async function clearForUser() {
    if (!selectedUserId) return;
    const u = users.find((x) => x.id === selectedUserId);
    if (
      !confirm(
        `确定清空用户【${u?.display_name || u?.username || "?"}】的全部历史记录吗？\n\n所有对应的输出图片也会从服务器删除。此操作不可撤销。`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/generations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUserId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const body = (await res.json()) as {
        deleted: number;
        removed_files: number;
      };
      alert(
        `已清空 ${body.deleted} 条记录 · ${body.removed_files} 张图片（后台异步删盘）`,
      );
      onDone();
    } catch (e) {
      alert("操作失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex flex-wrap items-center gap-2 text-sm">
      <Users size={14} className="text-amber-700" strokeWidth={2} />
      <span className="text-amber-900 font-medium">管理员操作：</span>
      <span className="text-xs text-amber-700">清空某用户的全部历史</span>
      <Select
        size="sm"
        value={selectedUserId === "" ? "" : String(selectedUserId)}
        onChange={(e) =>
          setSelectedUserId(e.target.value === "" ? "" : Number(e.target.value))
        }
        className="min-w-[180px]"
      >
        <option value="">选择用户…</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.display_name || u.username} (id={u.id})
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="danger-outline"
        disabled={!selectedUserId}
        loading={busy}
        leftIcon={<Trash2 size={12} strokeWidth={2} />}
        onClick={clearForUser}
        className="ml-auto"
      >
        批量清空
      </Button>
    </div>
  );
}
