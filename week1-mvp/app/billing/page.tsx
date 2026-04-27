"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Wallet,
  TrendingUp,
  Cpu,
  CheckCircle2,
  AlertOctagon,
} from "lucide-react";
import { Card, Chip, ProgressBar } from "@/app/_components/ui";

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

const FEATURE_TONE: Record<string, "brand" | "success" | "warn"> = {
  analyze: "warn",
  recolor: "brand",
  batch_photo: "success",
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
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

  const stats = useMemo(() => {
    if (!data) return null;
    const totalCalls = data.this_month_by_model.reduce((s, r) => s + r.count, 0);
    const totalCny = data.this_month_by_model.reduce(
      (s, r) => s + r.cost_cny,
      0,
    );
    const totalUsd = data.this_month_by_model.reduce(
      (s, r) => s + r.cost_usd,
      0,
    );
    const byFeature: Record<
      string,
      { count: number; cost_cny: number }
    > = {};
    for (const r of data.this_month_by_model) {
      if (!byFeature[r.feature])
        byFeature[r.feature] = { count: 0, cost_cny: 0 };
      byFeature[r.feature].count += r.count;
      byFeature[r.feature].cost_cny += r.cost_cny;
    }
    return { totalCalls, totalCny, totalUsd, byFeature };
  }, [data]);

  if (loading) {
    return (
      <main className="max-w-5xl mx-auto p-4 md:p-8">
        <div className="text-sm text-fg-tertiary">加载中...</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-5xl mx-auto p-4 md:p-8">
        <div className="p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded-xl">
          {error}
        </div>
      </main>
    );
  }

  if (!data || !stats) return null;

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-bold text-fg-primary tracking-tight">
          我的账单
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          当前汇率 1 USD = ¥{data.usd_to_cny.toFixed(2)} · 本月计费周期
        </p>
      </header>

      {/* 顶部统计卡组 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <StatCard
          label="本月已用"
          value={fmtCny(data.budget.used_this_month_cny)}
          sub={fmtUsd(stats.totalUsd)}
          accent="blue"
          Icon={Wallet}
          footer={
            data.budget.is_unlimited ? (
              <div className="text-[11px] text-fg-tertiary mt-2">无额度上限</div>
            ) : (
              <div className="mt-2">
                <ProgressBar
                  value={data.budget.percent_used}
                  max={100}
                  tone={
                    data.budget.percent_used > 90
                      ? "danger"
                      : data.budget.percent_used > 70
                        ? "warn"
                        : "brand"
                  }
                />
                <div className="mt-1 text-[11px] text-fg-tertiary">
                  {data.budget.percent_used.toFixed(1)}% · 剩 {fmtCny(data.budget.remaining_cny)}
                </div>
              </div>
            )
          }
        />
        <StatCard
          label="本月调用"
          value={stats.totalCalls.toString()}
          sub="次"
          accent="green"
          Icon={TrendingUp}
          footer={
            <div className="flex flex-wrap gap-1.5 mt-2">
              {Object.entries(stats.byFeature).map(([k, v]) => (
                <Chip key={k} tone={FEATURE_TONE[k] || "gray"}>
                  {FEATURE_LABEL[k] || k} {v.count}
                </Chip>
              ))}
            </div>
          }
        />
        <StatCard
          label="本月额度"
          value={
            data.budget.is_unlimited
              ? "无限制"
              : fmtCny(data.budget.monthly_budget_cny)
          }
          sub={data.budget.is_unlimited ? "" : "人民币"}
          accent="amber"
          Icon={Cpu}
          footer={
            data.budget.is_unlimited ? (
              <div className="text-[11px] text-fg-tertiary mt-2">
                由管理员设置
              </div>
            ) : (
              <div className="text-[11px] text-fg-tertiary mt-2">
                若不够用请联系管理员调整
              </div>
            )
          }
        />
      </div>

      {/* 本月按模型 */}
      <Card padding="md" className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-fg-primary">
            本月消费明细
          </h2>
          <span className="text-[11px] text-fg-tertiary">
            按 模型 × 功能 汇总
          </span>
        </div>
        {data.this_month_by_model.length === 0 ? (
          <div className="p-6 text-center text-sm text-fg-tertiary">
            本月还没有调用
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] text-fg-tertiary border-b border-border-subtle">
                  <th className="text-left py-2.5 px-4 font-medium">模型</th>
                  <th className="text-left py-2.5 px-4 font-medium">功能</th>
                  <th className="text-right py-2.5 px-4 font-medium">次数</th>
                  <th className="text-right py-2.5 px-4 font-medium">输入 tk</th>
                  <th className="text-right py-2.5 px-4 font-medium">输出 tk</th>
                  <th className="text-right py-2.5 px-4 font-medium">美金</th>
                  <th className="text-right py-2.5 px-4 font-medium">人民币</th>
                </tr>
              </thead>
              <tbody>
                {data.this_month_by_model.map((r, i) => (
                  <tr
                    key={i}
                    className="border-b border-gray-50 hover:bg-bg-tertiary/50"
                  >
                    <td className="py-2 px-4 font-mono text-[11px] text-fg-secondary">
                      {r.model}
                    </td>
                    <td className="py-2 px-4">
                      <Chip tone={FEATURE_TONE[r.feature] || "gray"}>
                        {FEATURE_LABEL[r.feature] || r.feature}
                      </Chip>
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-fg-secondary">
                      {r.count}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-fg-tertiary">
                      {fmtTokens(r.prompt_tokens)}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-fg-tertiary">
                      {fmtTokens(r.completion_tokens)}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-fg-tertiary text-[12px]">
                      {fmtUsd(r.cost_usd)}
                    </td>
                    <td className="py-2 px-4 text-right font-medium text-fg-primary tabular-nums">
                      {fmtCny(r.cost_cny)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-bg-tertiary font-semibold text-[13px]">
                  <td className="py-2.5 px-4" colSpan={5}>
                    合计
                  </td>
                  <td className="py-2.5 px-4 text-right text-fg-secondary tabular-nums">
                    {fmtUsd(stats.totalUsd)}
                  </td>
                  <td className="py-2.5 px-4 text-right text-fg-primary tabular-nums">
                    {fmtCny(stats.totalCny)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 最近调用 */}
      <Card padding="md">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-fg-primary">
            最近调用
          </h2>
          <span className="text-[11px] text-fg-tertiary">近 100 条</span>
        </div>
        {data.recent.length === 0 ? (
          <div className="p-6 text-center text-sm text-fg-tertiary">
            暂无调用记录
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 -mx-4">
            {data.recent.map((r) => (
              <li
                key={r.id}
                className="py-2.5 px-4 text-[12px] flex items-center gap-2.5 hover:bg-bg-tertiary/50"
              >
                <Chip tone={FEATURE_TONE[r.feature] || "gray"}>
                  {FEATURE_LABEL[r.feature] || r.feature}
                </Chip>
                <span className="font-mono text-fg-tertiary truncate max-w-[200px] text-[11px]">
                  {r.model}
                </span>
                <span className="text-fg-tertiary text-[11px] tabular-nums">
                  in {fmtTokens(r.prompt_tokens)} / out{" "}
                  {fmtTokens(r.completion_tokens)}
                </span>
                <span className="flex-1" />
                {r.success === 1 ? (
                  <CheckCircle2
                    size={12}
                    strokeWidth={2}
                    className="text-green-500"
                  />
                ) : (
                  <span className="text-danger inline-flex items-center gap-1 text-[11px]">
                    <AlertOctagon size={11} strokeWidth={2} />
                    失败
                  </span>
                )}
                <span className="font-medium text-fg-primary tabular-nums">
                  {fmtCny(r.cost_cny)}
                </span>
                <span className="text-fg-tertiary tabular-nums text-[11px] w-20 text-right">
                  {fmtTime(r.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}

/* ════════════ StatCard ════════════ */

function StatCard({
  label,
  value,
  sub,
  accent,
  Icon,
  footer,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: "blue" | "green" | "amber" | "pink";
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  footer?: React.ReactNode;
}) {
  const accentMap = {
    blue: "bg-[var(--brand-50-bg)] text-brand-400",
    green: "bg-[var(--success-bg)] text-success",
    amber: "bg-[var(--warn-bg)] text-warn",
    pink: "bg-pink-50 text-pink-600",
  }[accent];
  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-fg-tertiary uppercase tracking-wider font-medium">
            {label}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold text-fg-primary tabular-nums">
              {value}
            </span>
            {sub ? (
              <span className="text-[12px] text-fg-tertiary">{sub}</span>
            ) : null}
          </div>
        </div>
        <div className={`shrink-0 w-9 h-9 rounded-xl ${accentMap} flex items-center justify-center`}>
          <Icon size={16} strokeWidth={2} />
        </div>
      </div>
      {footer}
    </Card>
  );
}
