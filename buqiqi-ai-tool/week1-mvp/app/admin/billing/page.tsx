"use client";

import { useEffect, useState } from "react";

type Row = Record<string, unknown>;

type BillingData = {
  month: string;
  usd_to_cny: number;
  total: {
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
    cost_cny: number;
  };
  by_user: Array<{
    user_id: number;
    username: string;
    display_name: string | null;
    role: string;
    monthly_budget_cny: number;
    is_unlimited: number;
    call_count: number;
    cost_cny: number;
    cost_usd: number;
    prompt_tokens: number;
    completion_tokens: number;
  }>;
  by_model: Array<{
    model: string;
    feature: string;
    count: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_cny: number;
    cost_usd: number;
  }>;
  by_day: Array<{
    day: string;
    count: number;
    cost_cny: number;
  }>;
};

const FEATURE_LABEL: Record<string, string> = {
  analyze: "款式解析",
  recolor: "换色",
  batch_photo: "批量摄影",
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtCny(v: number): string {
  return "¥" + (v || 0).toFixed(2);
}
function fmtUsd(v: number): string {
  return "$" + (v || 0).toFixed(4);
}
function fmtTokens(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (v >= 10_000) return (v / 1000).toFixed(1) + "K";
  return String(v || 0);
}

export default function AdminBillingPage() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/billing?month=${month}`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // 生成最近 12 个月可选
  const monthOptions: string[] = [];
  {
    const d = new Date();
    for (let i = 0; i < 12; i++) {
      const y = d.getFullYear();
      const m = d.getMonth() - i;
      const date = new Date(y, m, 1);
      monthOptions.push(
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      );
    }
  }

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-fg-primary">团队账单</h1>
          <p className="mt-1 text-sm text-fg-tertiary">
            按月查看团队消费明细{" "}
            {data && (
              <span className="ml-2">
                · 汇率 1 USD = ¥{data.usd_to_cny.toFixed(2)}{" "}
                <a
                  href="/admin/model-prices"
                  className="text-brand-400 underline ml-2"
                >
                  管理单价 / 汇率
                </a>
              </span>
            )}
          </p>
        </div>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="px-3 py-2 border border-border-default rounded text-sm"
        >
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-fg-tertiary">加载中...</div>
      ) : data ? (
        <>
          {/* 总览 */}
          <section className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
            <Stat label="本月总消费" value={fmtCny(data.total.cost_cny)} />
            <Stat label="美金等值" value={fmtUsd(data.total.cost_usd)} />
            <Stat label="调用次数" value={String(data.total.calls)} />
            <Stat
              label="总 tokens"
              value={fmtTokens(
                data.total.prompt_tokens + data.total.completion_tokens,
              )}
            />
          </section>

          {/* 按用户 */}
          <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6 mb-6">
            <h2 className="text-sm font-semibold text-fg-secondary mb-3">
              按成员消费（{data.by_user.length} 人）
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-fg-tertiary border-b border-border-subtle">
                    <th className="text-left py-2">成员</th>
                    <th className="text-left py-2">角色</th>
                    <th className="text-right py-2">调用次数</th>
                    <th className="text-right py-2">输入</th>
                    <th className="text-right py-2">输出</th>
                    <th className="text-right py-2">美金</th>
                    <th className="text-right py-2">人民币</th>
                    <th className="text-right py-2">本月额度</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_user.map((u) => {
                    const pct =
                      u.is_unlimited === 1 || u.monthly_budget_cny === 0
                        ? 0
                        : Math.min(100, (u.cost_cny / u.monthly_budget_cny) * 100);
                    return (
                      <tr
                        key={u.user_id}
                        className="border-b border-border-subtle"
                      >
                        <td className="py-2">
                          <div className="font-medium text-fg-primary">
                            {u.display_name || u.username}
                          </div>
                          <div className="text-xs text-fg-tertiary">
                            @{u.username}
                          </div>
                        </td>
                        <td className="py-2 text-xs text-fg-tertiary">
                          {u.role}
                        </td>
                        <td className="py-2 text-right text-fg-secondary">
                          {u.call_count}
                        </td>
                        <td className="py-2 text-right text-fg-tertiary">
                          {fmtTokens(u.prompt_tokens)}
                        </td>
                        <td className="py-2 text-right text-fg-tertiary">
                          {fmtTokens(u.completion_tokens)}
                        </td>
                        <td className="py-2 text-right text-fg-tertiary">
                          {fmtUsd(u.cost_usd)}
                        </td>
                        <td className="py-2 text-right font-medium text-fg-primary">
                          {fmtCny(u.cost_cny)}
                        </td>
                        <td className="py-2 text-right text-xs">
                          {u.is_unlimited === 1 ? (
                            <span className="text-fg-tertiary">无限</span>
                          ) : (
                            <div>
                              <div className="text-fg-secondary">
                                / {fmtCny(u.monthly_budget_cny)}
                              </div>
                              <div
                                className={`text-[10px] ${
                                  pct > 90
                                    ? "text-danger"
                                    : pct > 70
                                      ? "text-warn"
                                      : "text-fg-tertiary"
                                }`}
                              >
                                {pct.toFixed(0)}%
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-fg-tertiary">
              去{" "}
              <a href="/admin/users" className="text-brand-400 underline">
                用户管理
              </a>{" "}
              设置每人月度预算
            </p>
          </section>

          {/* 按模型 */}
          <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6 mb-6">
            <h2 className="text-sm font-semibold text-fg-secondary mb-3">
              按模型 × 功能
            </h2>
            {data.by_model.length === 0 ? (
              <div className="text-sm text-fg-tertiary">本月无调用</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-fg-tertiary border-b border-border-subtle">
                      <th className="text-left py-2">模型</th>
                      <th className="text-left py-2">功能</th>
                      <th className="text-right py-2">次数</th>
                      <th className="text-right py-2">输入</th>
                      <th className="text-right py-2">输出</th>
                      <th className="text-right py-2">美金</th>
                      <th className="text-right py-2">人民币</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_model.map((m, i) => (
                      <tr key={i} className="border-b border-border-subtle">
                        <td className="py-2 font-mono text-xs text-fg-secondary">
                          {m.model}
                        </td>
                        <td className="py-2 text-fg-secondary">
                          {FEATURE_LABEL[m.feature] || m.feature}
                        </td>
                        <td className="py-2 text-right">{m.count}</td>
                        <td className="py-2 text-right text-fg-tertiary">
                          {fmtTokens(m.prompt_tokens)}
                        </td>
                        <td className="py-2 text-right text-fg-tertiary">
                          {fmtTokens(m.completion_tokens)}
                        </td>
                        <td className="py-2 text-right text-fg-tertiary">
                          {fmtUsd(m.cost_usd)}
                        </td>
                        <td className="py-2 text-right font-medium">
                          {fmtCny(m.cost_cny)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 按天趋势 */}
          {data.by_day.length > 0 && (
            <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6">
              <h2 className="text-sm font-semibold text-fg-secondary mb-3">
                每日消费趋势
              </h2>
              <DayChart data={data.by_day} />
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-4">
      <div className="text-xs text-fg-tertiary">{label}</div>
      <div className="mt-1 text-2xl font-bold text-fg-primary">{value}</div>
    </div>
  );
}

function DayChart({
  data,
}: {
  data: Array<{ day: string; count: number; cost_cny: number }>;
}) {
  const max = Math.max(1, ...data.map((d) => d.cost_cny));
  return (
    <div className="flex items-end gap-1 h-40 overflow-x-auto">
      {data.map((d) => {
        const h = Math.max(2, (d.cost_cny / max) * 100);
        return (
          <div
            key={d.day}
            className="flex flex-col items-center gap-1 min-w-[30px]"
            title={`${d.day}: ${fmtCny(d.cost_cny)} / ${d.count} 次`}
          >
            <div
              className="w-6 bg-blue-400 rounded-t"
              style={{ height: `${h}%` }}
            />
            <div className="text-[9px] text-fg-tertiary rotate-45 origin-top-left whitespace-nowrap">
              {d.day.slice(5)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
