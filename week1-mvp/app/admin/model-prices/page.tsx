"use client";

import { useEffect, useState } from "react";

type Price = {
  model_id: string;
  input_per_1m_usd: number;
  output_per_1m_usd: number;
  tier: string;
  notes: string | null;
  updated_at: number;
};

type Setting = {
  key: string;
  value: string;
  notes: string | null;
  updated_at: number;
  /** 敏感配置（如 API key），后端已 mask，前端禁止内联编辑 */
  sensitive?: boolean;
};

export default function ModelPricesPage() {
  const [prices, setPrices] = useState<Price[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 新增价格表单
  const [form, setForm] = useState({
    model_id: "",
    input_per_1m_usd: 0,
    output_per_1m_usd: 0,
    tier: "standard",
    notes: "",
  });
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([
        fetch("/api/admin/model-prices").then((r) => r.json()),
        fetch("/api/admin/settings").then((r) => r.json()),
      ]);
      setPrices(p);
      setSettings(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveSetting(key: string, value: string) {
    await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    await load();
  }

  async function savePrice(p: Omit<Price, "updated_at">) {
    const res = await fetch("/api/admin/model-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    if (!res.ok) {
      setError((await res.json()).error || res.statusText);
    } else {
      await load();
    }
  }

  async function deletePrice(modelId: string) {
    if (!confirm(`确定删除 ${modelId} 的单价？`)) return;
    await fetch(`/api/admin/model-prices?model_id=${encodeURIComponent(modelId)}`, {
      method: "DELETE",
    });
    await load();
  }

  const usdRate = settings.find((s) => s.key === "usd_to_cny")?.value || "7.2";

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-fg-primary">单价 & 汇率管理</h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          管理 Gemini 模型的计费单价和 USD→CNY 汇率。修改后立即生效（历史账单不追溯）
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      {/* 汇率设置 */}
      <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6 mb-6">
        <h2 className="text-sm font-semibold text-fg-secondary mb-3">全局配置</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {settings.map((s) => (
            <SettingRow key={s.key} s={s} onSave={saveSetting} />
          ))}
        </div>
      </section>

      {/* 价格表 */}
      <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-fg-secondary">
            模型单价（{prices.length} 个）
          </h2>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-3 py-1 text-xs bg-brand-600 text-white rounded hover:bg-brand-700"
          >
            {showForm ? "取消" : "+ 添加"}
          </button>
        </div>

        {showForm && (
          <div className="mb-4 p-3 bg-[var(--brand-50-bg)] rounded border border-[rgba(59,130,246,0.3)]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                type="text"
                value={form.model_id}
                onChange={(e) => setForm({ ...form, model_id: e.target.value })}
                placeholder="model_id (如 gemini-2.5-flash)"
                className="px-2 py-1 border border-border-default rounded text-sm font-mono"
              />
              <select
                value={form.tier}
                onChange={(e) => setForm({ ...form, tier: e.target.value })}
                className="px-2 py-1 border border-border-default rounded text-sm"
              >
                <option value="standard">标准 Standard</option>
                <option value="priority">优先 Priority</option>
                <option value="batch">批量 Batch</option>
              </select>
              <label className="text-xs">
                输入 USD / 1M tokens
                <input
                  type="number"
                  step="0.01"
                  value={form.input_per_1m_usd}
                  onChange={(e) =>
                    setForm({ ...form, input_per_1m_usd: Number(e.target.value) })
                  }
                  className="mt-1 w-full px-2 py-1 border border-border-default rounded text-sm"
                />
              </label>
              <label className="text-xs">
                输出 USD / 1M tokens
                <input
                  type="number"
                  step="0.01"
                  value={form.output_per_1m_usd}
                  onChange={(e) =>
                    setForm({ ...form, output_per_1m_usd: Number(e.target.value) })
                  }
                  className="mt-1 w-full px-2 py-1 border border-border-default rounded text-sm"
                />
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="备注"
                className="md:col-span-2 px-2 py-1 border border-border-default rounded text-sm"
              />
            </div>
            <button
              onClick={async () => {
                if (!form.model_id.trim()) return;
                await savePrice(form);
                setForm({
                  model_id: "",
                  input_per_1m_usd: 0,
                  output_per_1m_usd: 0,
                  tier: "standard",
                  notes: "",
                });
                setShowForm(false);
              }}
              className="mt-3 px-3 py-1 bg-brand-600 text-white text-xs rounded"
            >
              保存
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-fg-tertiary">加载中...</div>
        ) : prices.length === 0 ? (
          <div className="text-sm text-fg-tertiary">暂无单价</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-fg-tertiary border-b border-border-subtle">
                  <th className="text-left py-2">Model ID</th>
                  <th className="text-left py-2">档位</th>
                  <th className="text-right py-2">输入/1M</th>
                  <th className="text-right py-2">输出/1M</th>
                  <th className="text-right py-2">输入/1M (¥)</th>
                  <th className="text-right py-2">输出/1M (¥)</th>
                  <th className="text-left py-2">备注</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {prices.map((p) => (
                  <PriceRow
                    key={p.model_id}
                    p={p}
                    usdRate={parseFloat(usdRate)}
                    onSave={savePrice}
                    onDelete={deletePrice}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function SettingRow({
  s,
  onSave,
}: {
  s: Setting;
  onSave: (key: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(s.value);

  // 敏感 key（API key 等）：值已被后端 mask，禁止在此页面编辑——
  // 防止用户点"修改"再"保存"把 mask 字符串原样回写覆盖真 key。
  // 编辑入口走专门的 /admin/settings 页面（有完整的 password 输入 + 留空=不改流程）。
  if (s.sensitive) {
    return (
      <div className="p-3 bg-bg-tertiary border border-border-subtle rounded">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-fg-tertiary font-mono">{s.key}</span>
          <span
            title="敏感配置，已加密展示"
            className="text-xs text-warn"
            aria-label="sensitive"
          >
            🔒
          </span>
        </div>
        {s.notes && (
          <div className="text-xs text-fg-tertiary mt-0.5">{s.notes}</div>
        )}
        <div className="flex items-center justify-between mt-1">
          <div className="text-base font-mono text-fg-secondary select-none">
            {s.value || <span className="text-fg-tertiary">未配置</span>}
          </div>
          <a
            href="/admin/settings"
            className="text-xs text-brand-400 hover:underline"
          >
            在「系统设置」中修改 →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 bg-bg-tertiary border border-border-subtle rounded">
      <div className="text-xs text-fg-tertiary font-mono">{s.key}</div>
      {s.notes && (
        <div className="text-xs text-fg-tertiary mt-0.5">{s.notes}</div>
      )}
      {editing ? (
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1 px-2 py-1 border border-border-default rounded text-sm"
          />
          <button
            onClick={() => {
              onSave(s.key, value);
              setEditing(false);
            }}
            className="px-3 py-1 bg-brand-600 text-white text-xs rounded"
          >
            保存
          </button>
          <button
            onClick={() => {
              setValue(s.value);
              setEditing(false);
            }}
            className="px-3 py-1 text-fg-secondary text-xs hover:bg-bg-tertiary rounded"
          >
            取消
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between mt-1">
          <div className="text-lg font-medium text-fg-primary">{s.value}</div>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-brand-400 hover:underline"
          >
            修改
          </button>
        </div>
      )}
    </div>
  );
}

function PriceRow({
  p,
  usdRate,
  onSave,
  onDelete,
}: {
  p: Price;
  usdRate: number;
  onSave: (p: Omit<Price, "updated_at">) => void;
  onDelete: (modelId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    model_id: p.model_id,
    input_per_1m_usd: p.input_per_1m_usd,
    output_per_1m_usd: p.output_per_1m_usd,
    tier: p.tier,
    notes: p.notes || "",
  });

  if (editing) {
    return (
      <tr className="bg-[var(--brand-50-bg)]">
        <td className="py-2 font-mono text-xs">{p.model_id}</td>
        <td className="py-2">
          <select
            value={draft.tier}
            onChange={(e) => setDraft({ ...draft, tier: e.target.value })}
            className="px-1 border border-border-default rounded text-xs"
          >
            <option value="standard">standard</option>
            <option value="priority">priority</option>
            <option value="batch">batch</option>
          </select>
        </td>
        <td className="py-2">
          <input
            type="number"
            step="0.01"
            value={draft.input_per_1m_usd}
            onChange={(e) =>
              setDraft({
                ...draft,
                input_per_1m_usd: Number(e.target.value),
              })
            }
            className="w-20 text-right px-1 border border-border-default rounded text-xs"
          />
        </td>
        <td className="py-2">
          <input
            type="number"
            step="0.01"
            value={draft.output_per_1m_usd}
            onChange={(e) =>
              setDraft({
                ...draft,
                output_per_1m_usd: Number(e.target.value),
              })
            }
            className="w-20 text-right px-1 border border-border-default rounded text-xs"
          />
        </td>
        <td className="py-2 text-right text-fg-tertiary">—</td>
        <td className="py-2 text-right text-fg-tertiary">—</td>
        <td className="py-2" colSpan={2}>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              className="flex-1 px-1 border border-border-default rounded text-xs"
            />
            <button
              onClick={() => {
                onSave(draft);
                setEditing(false);
              }}
              className="px-2 py-0.5 bg-brand-600 text-white text-xs rounded"
            >
              保存
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-fg-tertiary"
            >
              取消
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border-subtle">
      <td className="py-2 font-mono text-xs">{p.model_id}</td>
      <td className="py-2 text-xs">
        <span className="px-1.5 py-0.5 bg-bg-tertiary rounded text-fg-secondary">
          {p.tier}
        </span>
      </td>
      <td className="py-2 text-right font-mono text-fg-secondary">
        ${p.input_per_1m_usd.toFixed(2)}
      </td>
      <td className="py-2 text-right font-mono text-fg-secondary">
        ${p.output_per_1m_usd.toFixed(2)}
      </td>
      <td className="py-2 text-right font-mono text-xs text-fg-tertiary">
        ¥{(p.input_per_1m_usd * usdRate).toFixed(2)}
      </td>
      <td className="py-2 text-right font-mono text-xs text-fg-tertiary">
        ¥{(p.output_per_1m_usd * usdRate).toFixed(2)}
      </td>
      <td className="py-2 text-xs text-fg-tertiary max-w-xs truncate">
        {p.notes}
      </td>
      <td className="py-2 text-right">
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-fg-secondary hover:text-fg-primary mr-2"
        >
          编辑
        </button>
        <button
          onClick={() => onDelete(p.model_id)}
          className="text-xs text-danger hover:text-red-800"
        >
          删除
        </button>
      </td>
    </tr>
  );
}
