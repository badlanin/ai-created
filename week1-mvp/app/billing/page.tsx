"use client";

import { useEffect, useState } from "react";

type Budget = {
  monthly_budget_cny: number;
  is_unlimited: boolean;
  used_this_month_cny: number;
  remaining_cny: number;
  percent_used: number;
};

type ByModelRow = {
  model: string;
  feature: string;
  count: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  cost_cny: number;
};

type RecentRow = {
  id: number;
  model: string;
  feature: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  cost_cny: number;
  success: number;
  error: string | null;
  notes: string | null;
  created_at: number;
};

const FEATURE_LABEL: Record<string, string> = {
  analyze: "款式解析",
  recolor: "换色",
  batch_photo: "批量摄影",
};

function fmtCny(v: number): string {
  return "¥" + v.toFixed(2);
}
function fmtUsd(v: number): string {
  return "$" + v.toFixed(4);
}
function fmtTokens(v: number): string {
  if (v >= 10000) return (v / 1000).toFixed(1) + "K";
  return String(v);
}
function fmtTime(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleString("zh-CN", { hour12: false });
}

export default function BillingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    usd_to_cny: number;
    budget: Budget;
    this_month_by_model: ByModelRow[];
    recent: RecentRow[];
  } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/me?limit=100");
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <main className="max-w-5xl mx-auto p-4 md:p-8">
        <div className="text-sm text-gray-500">加载中...</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-5xl mx-auto p-4 md:p-8">
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
          {error}
        </div>
      </main>
    );
  }

  if (!data) return null;

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">我的账单</h1>
        <p className="mt-1 text-sm text-gray-500">
          当前汇率 1 USD = ¥{data.usd_to_cny.toFixed(2)}
        </p>
      </header>

      {/* 预算卡片 */}
      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">本月预算</h2>
        {data.budget.is_unlimited ? (
          <div className="text-2xl font-bold text-gray-900">
            已用 {fmtCny(data.budget.used_this_month_cny)}
            <span className="ml-2 text-xs text-gray-500 font-normal">
              · 无额度上限
            </span>
          </div>
        ) : (
          <div>
            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-2xl font-bold text-gray-900">
                  {fmtCny(data.budget.used_this_month_cny)}
                </span>
                <span className="ml-2 text-sm text-gray-500">
                  / {fmtCny(data.budget.monthly_budget_cny)} 本月额度
                </span>
              </div>
              <div className="text-sm text-gray-500">
                剩 {fmtCny(data.budget.remaining_cny)}
              </div>
            </div>
            <div className="mt-3 h-2 bg-gray-100 rounded overflow-hidden">
              <div
                className={`h-full transition-all ${
                  data.budget.percent_used > 90
                    ? "bg-red-500"
                    : data.budget.percent_used > 70
                      ? "bg-amber-500"
                      : "bg-blue-500"
                }`}
                style={{ width: `${data.budget.percent_used}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {data.budget.percent_used.toFixed(1)}% 已用
            </div>
          </div>
        )}
      </section>

      {/* 本月按模型 */}
      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          本月消费明细（按模型 × 功能）
        </h2>
        {data.this_month_by_model.length === 0 ? (
          <div className="text-sm text-gray-500">本月还没有调用</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-200">
                  <th className="text-left py-2 font-medium">模型</th>
                  <th className="text-left py-2 font-medium">功能</th>
                  <th className="text-right py-2 font-medium">调用次数</th>
                  <th className="text-right py-2 font-medium">输入 tokens</th>
                  <th className="text-right py-2 font-medium">输出 tokens</th>
                  <th className="text-right py-2 font-medium">美金</th>
                  <th className="text-right py-2 font-medium">人民币</th>
                </tr>
              </thead>
              <tbody>
                {data.this_month_by_model.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 font-mono text-xs text-gray-700">
                      {r.model}
                    </td>
                    <td className="py-2 text-gray-700">
                      {FEATURE_LABEL[r.feature] || r.feature}
                    </td>
                    <td className="py-2 text-right text-gray-700">{r.count}</td>
                    <td className="py-2 text-right text-gray-500">
                      {fmtTokens(r.prompt_tokens)}
                    </td>
                    <td className="py-2 text-right text-gray-500">
                      {fmtTokens(r.completion_tokens)}
                    </td>
                    <td className="py-2 text-right text-gray-500">
                      {fmtUsd(r.cost_usd)}
                    </td>
                    <td className="py-2 text-right font-medium text-gray-900">
                      {fmtCny(r.cost_cny)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 font-semibold">
                  <td className="py-2" colSpan={5}>
                    合计
                  </td>
                  <td className="py-2 text-right">
                    {fmtUsd(
                      data.this_month_by_model.reduce(
                        (s, r) => s + r.cost_usd,
                        0,
                      ),
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {fmtCny(
                      data.this_month_by_model.reduce(
                        (s, r) => s + r.cost_cny,
                        0,
                      ),
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 最近调用 */}
      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          最近调用（近 100 条）
        </h2>
        {data.recent.length === 0 ? (
          <div className="text-sm text-gray-500">暂无调用记录</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.recent.map((r) => (
              <li key={r.id} className="py-2 text-xs flex items-center gap-2">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                    r.feature === "recolor"
                      ? "bg-blue-100 text-blue-700"
                      : r.feature === "batch_photo"
                        ? "bg-pink-100 text-pink-700"
                        : "bg-purple-100 text-purple-700"
                  }`}
                >
                  {FEATURE_LABEL[r.feature] || r.feature}
                </span>
                <span className="font-mono text-gray-500 truncate max-w-xs">
                  {r.model}
                </span>
                <span className="text-gray-400">
                  in {fmtTokens(r.prompt_tokens)} / out{" "}
                  {fmtTokens(r.completion_tokens)}
                </span>
                <span className="ml-auto font-medium text-gray-900">
                  {fmtCny(r.cost_cny)}
                </span>
                <span className="text-gray-400 w-32 text-right">
                  {fmtTime(r.created_at)}
                </span>
                {r.success === 0 && (
                  <span className="text-red-600" title={r.error || ""}>
                    失败
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
