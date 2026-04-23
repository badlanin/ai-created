"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    // 拿当前用户
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
              onToggle={() => setExpanded((prev) => (prev === g.id ? null : g.id))}
              showUsername={scope === "all"}
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

function GenerationRow({
  gen,
  isExpanded,
  onToggle,
  showUsername,
}: {
  gen: Generation;
  isExpanded: boolean;
  onToggle: () => void;
  showUsername: boolean;
}) {
  const kindInfo = KIND_LABEL[gen.kind] || {
    label: gen.kind,
    emoji: "📦",
    color: "bg-gray-100 text-gray-700",
  };

  let outputImages: string[] = [];
  try {
    outputImages = gen.output_images ? JSON.parse(gen.output_images) : [];
  } catch {}

  let params: Record<string, unknown> = {};
  try {
    params = gen.params ? JSON.parse(gen.params) : {};
  } catch {}

  return (
    <li className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
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
            onClick={onToggle}
            className="text-xs text-blue-600 hover:underline shrink-0"
          >
            {isExpanded ? "收起" : "详情"}
          </button>
        </div>

        {outputImages.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {outputImages.slice(0, isExpanded ? undefined : 8).map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener"
                className="block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`输出 ${i + 1}`}
                  className="w-20 h-20 object-cover rounded border border-gray-200 hover:border-blue-500"
                />
              </a>
            ))}
            {!isExpanded && outputImages.length > 8 && (
              <div className="w-20 h-20 rounded border border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-500">
                +{outputImages.length - 8}
              </div>
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
  if (params.quality_level) chips.push(`${String(params.quality_level).toUpperCase()}`);

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
