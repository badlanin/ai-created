"use client";

import { useEffect, useMemo, useState } from "react";

interface SettingItem {
  key: string;
  value: string;
  hasValue: boolean;
  isSecret: boolean;
  notes: string | null;
}

interface ProviderInfo {
  provider: "vertex" | "gemini_api";
  hasGeminiApiKey: boolean;
  geminiApiKeyMask: string;
  vertexProject: string | null;
  vertexLocation: string | null;
}

// 限流相关 key 的推荐值
const RECOMMENDED = {
  vertex: { rate: 2, burst: 2, concurrency: 1 },
  gemini_api_tier1: { rate: 10, burst: 10, concurrency: 4 },
  gemini_api_tier2: { rate: 60, burst: 60, concurrency: 8 },
};

export default function SettingsAdminPage() {
  const [settings, setSettings] = useState<SettingItem[]>([]);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState<string | null>(null);

  // Provider 表单
  const [providerForm, setProviderForm] = useState<"vertex" | "gemini_api">(
    "vertex",
  );
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyTouched, setApiKeyTouched] = useState(false);

  // 限流/并发表单
  const [rateForm, setRateForm] = useState({
    image_rate_limit_per_min: "2",
    image_rate_burst: "2",
    image_concurrency: "1",
  });

  // 其他可编辑设置
  const [miscForm, setMiscForm] = useState({
    usd_to_cny: "6.83",
    default_budget_cny: "0",
  });

  const settingMap = useMemo(() => {
    const m = new Map<string, SettingItem>();
    settings.forEach((s) => m.set(s.key, s));
    return m;
  }, [settings]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const data = await res.json();
      const items: SettingItem[] = data.settings || [];
      setSettings(items);
      setProvider(data.provider || null);
      if (data.provider) setProviderForm(data.provider.provider);

      // 用 DB 值初始化表单
      const map = new Map(items.map((s) => [s.key, s.value]));
      setRateForm({
        image_rate_limit_per_min: map.get("image_rate_limit_per_min") ?? "2",
        image_rate_burst: map.get("image_rate_burst") ?? "2",
        image_concurrency: map.get("image_concurrency") ?? "1",
      });
      setMiscForm({
        usd_to_cny: map.get("usd_to_cny") ?? "6.83",
        default_budget_cny: map.get("default_budget_cny") ?? "0",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function showSaved(msg: string) {
    setSavedHint(msg);
    setTimeout(() => setSavedHint(null), 5000);
  }

  async function patchSettings(body: Record<string, unknown>, msg: string) {
    setSaving(true);
    setError(null);
    setSavedHint(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const data = await res.json();
      setSettings(data.settings || []);
      setProvider(data.provider || null);
      showSaved(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveProvider(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { ai_provider: providerForm };
    if (apiKeyTouched) body.gemini_api_key = apiKeyInput.trim();
    await patchSettings(body, "Provider 已保存。下次 AI 调用立即生效。");
    setApiKeyInput("");
    setApiKeyTouched(false);
  }

  async function handleClearKey() {
    if (!confirm("确定清空 Gemini API key？清空后会自动回退到 Vertex 模式。"))
      return;
    await patchSettings(
      { gemini_api_key: "", ai_provider: "vertex" },
      "已清空 API key 并切回 Vertex 模式",
    );
    await load();
  }

  async function handleSaveRate(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rateForm)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1) {
        setError(`${k} 必须是 ≥ 1 的整数`);
        return;
      }
      body[k] = String(Math.floor(n));
    }
    await patchSettings(body, "限流/并发已保存，立即生效（无需重启容器）。");
  }

  async function handleSaveMisc(e: React.FormEvent) {
    e.preventDefault();
    await patchSettings(
      { usd_to_cny: miscForm.usd_to_cny, default_budget_cny: miscForm.default_budget_cny },
      "汇率/预算已保存。",
    );
  }

  function applyRecommended(preset: keyof typeof RECOMMENDED) {
    const p = RECOMMENDED[preset];
    setRateForm({
      image_rate_limit_per_min: String(p.rate),
      image_rate_burst: String(p.burst),
      image_concurrency: String(p.concurrency),
    });
  }

  // 推荐 hint：当前 provider 选择 vs 当前限流值是否匹配
  const provHint = useMemo(() => {
    if (providerForm === "vertex") {
      const ok = rateForm.image_rate_limit_per_min === "2";
      return ok
        ? null
        : "💡 当前 Provider 是 Vertex 但 RPM 不是 2。Vertex preview 模型默认上限 2/min，超了会 429。";
    }
    // gemini_api
    const rpm = Number(rateForm.image_rate_limit_per_min);
    if (rpm <= 2) {
      return "⚠️ 你切到了 Gemini API 模式但 RPM 还是 Vertex 的 2，浪费 5x+ 吞吐。建议改成 10（Tier 1）或 60（Tier 2）。";
    }
    return null;
  }, [providerForm, rateForm.image_rate_limit_per_min]);

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-fg-primary">系统设置</h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          AI Provider、限流/并发、汇率等全局参数
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}
      {savedHint && (
        <div className="mb-4 p-3 bg-[var(--success-bg)] border border-green-200 text-success text-sm rounded">
          {savedHint}
        </div>
      )}

      {/* ===== AI Provider ===== */}
      <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6 mb-6">
        <h2 className="text-base font-semibold text-fg-primary mb-1">
          AI Provider 模式
        </h2>
        <p className="text-xs text-fg-tertiary mb-4">
          决定 Gemini 请求走哪条链路。Vertex = GCP 项目鉴权（默认 2 RPM/项目）；
          Gemini API = API key 直连（Tier 1 起 10 RPM/项目）。
        </p>

        {loading ? (
          <div className="text-sm text-fg-tertiary">加载中…</div>
        ) : (
          <form onSubmit={handleSaveProvider} className="space-y-4">
            {provider && (
              <div className="p-3 rounded bg-bg-tertiary border border-border-subtle text-xs text-fg-secondary space-y-1">
                <div>
                  当前生效：
                  <span className="ml-1 font-mono font-semibold text-fg-primary">
                    {provider.provider === "gemini_api"
                      ? "Gemini API 直连"
                      : "Vertex AI"}
                  </span>
                </div>
                {provider.provider === "vertex" && (
                  <div>
                    Vertex 项目：
                    <span className="font-mono">
                      {provider.vertexProject || "(未配置)"}
                    </span>
                    <span className="mx-1">·</span>
                    区域：
                    <span className="font-mono">
                      {provider.vertexLocation || "us-central1"}
                    </span>
                  </div>
                )}
                {provider.provider === "gemini_api" && (
                  <div>
                    API Key：
                    <span className="font-mono">
                      {provider.hasGeminiApiKey
                        ? provider.geminiApiKeyMask
                        : "(未配置 - 调用会失败)"}
                    </span>
                  </div>
                )}
              </div>
            )}

            <fieldset>
              <legend className="block text-sm font-medium text-fg-secondary mb-2">
                Provider 模式
              </legend>
              <div className="space-y-2">
                <label className="flex items-start gap-2 p-2 rounded border border-border-subtle hover:border-border-default cursor-pointer has-[:checked]:border-blue-400 has-[:checked]:bg-[var(--brand-50-bg)]">
                  <input
                    type="radio"
                    name="provider"
                    value="vertex"
                    checked={providerForm === "vertex"}
                    onChange={() => setProviderForm("vertex")}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-fg-primary">
                      Vertex AI（GCP）
                    </div>
                    <div className="text-xs text-fg-tertiary mt-0.5">
                      GCP 项目 ADC 鉴权。需 GCP_PROJECT_ID + GCP_LOCATION 环境变量
                      + ADC 文件 / 绑 SA。默认 2 RPM/项目。
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-2 p-2 rounded border border-border-subtle hover:border-border-default cursor-pointer has-[:checked]:border-blue-400 has-[:checked]:bg-[var(--brand-50-bg)]">
                  <input
                    type="radio"
                    name="provider"
                    value="gemini_api"
                    checked={providerForm === "gemini_api"}
                    onChange={() => setProviderForm("gemini_api")}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-fg-primary">
                      Gemini API 直连（推荐）
                    </div>
                    <div className="text-xs text-fg-tertiary mt-0.5">
                      API key 直连。免 GCP 项目白名单。Tier 1 起约 10 RPM/项目，
                      自动按消费升 Tier。
                    </div>
                  </div>
                </label>
              </div>
            </fieldset>

            <div>
              <label className="block text-sm font-medium text-fg-secondary mb-1">
                Gemini API Key
                {provider?.hasGeminiApiKey && (
                  <span className="ml-2 text-xs text-fg-tertiary font-normal">
                    (当前已配置：
                    <span className="font-mono">{provider.geminiApiKeyMask}</span>
                    )
                  </span>
                )}
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => {
                    setApiKeyInput(e.target.value);
                    setApiKeyTouched(true);
                  }}
                  placeholder={
                    provider?.hasGeminiApiKey
                      ? "留空 = 不修改；输入新值 = 替换"
                      : "AIza... (从 https://aistudio.google.com/app/apikey 创建)"
                  }
                  className="flex-1 px-3 py-2 border border-border-default rounded-md text-sm font-mono"
                  autoComplete="off"
                />
                {provider?.hasGeminiApiKey && (
                  <button
                    type="button"
                    onClick={handleClearKey}
                    disabled={saving}
                    className="px-3 py-2 text-xs text-danger border border-[rgba(239,68,68,0.3)] rounded hover:bg-[var(--danger-bg)] disabled:opacity-50"
                  >
                    清空
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-fg-tertiary">
                创建地址：
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-400 underline"
                >
                  AI Studio API Keys
                </a>
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={
                  saving ||
                  (providerForm === "gemini_api" &&
                    !provider?.hasGeminiApiKey &&
                    !apiKeyInput.trim())
                }
                className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? "保存中…" : "保存 Provider"}
              </button>
              {providerForm === "gemini_api" &&
                !provider?.hasGeminiApiKey &&
                !apiKeyInput.trim() && (
                  <span className="text-xs text-warn">
                    切到 Gemini API 模式需要先填入 API Key
                  </span>
                )}
            </div>
          </form>
        )}
      </section>

      {/* ===== 限流 / 并发 ===== */}
      <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6 mb-6">
        <h2 className="text-base font-semibold text-fg-primary mb-1">
          图像生成 · 限流 / 并发
        </h2>
        <p className="text-xs text-fg-tertiary mb-4">
          控制 image_gen 模型的吞吐。RPM = 每分钟最多请求数；burst =
          token bucket 容量；concurrency = 单 job 内并发执行的 item 数。
          <strong>修改后立即生效，无需重启。</strong>
        </p>

        {provHint && (
          <div
            className={`mb-3 p-2.5 rounded text-xs ${
              provHint.startsWith("⚠️")
                ? "bg-[var(--warn-bg)] border border-amber-200 text-warn"
                : "bg-[var(--brand-50-bg)] border border-[rgba(59,130,246,0.3)] text-brand-400"
            }`}
          >
            {provHint}
          </div>
        )}

        {/* 推荐快速填值 */}
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="text-xs text-fg-tertiary self-center mr-1">
            一键应用推荐：
          </span>
          <button
            type="button"
            onClick={() => applyRecommended("vertex")}
            className="px-2.5 py-1 text-xs border border-border-default rounded hover:bg-bg-tertiary"
          >
            Vertex (2 / 1)
          </button>
          <button
            type="button"
            onClick={() => applyRecommended("gemini_api_tier1")}
            className="px-2.5 py-1 text-xs border border-[rgba(59,130,246,0.4)] rounded text-brand-400 hover:bg-[var(--brand-50-bg)]"
          >
            Gemini API Tier 1 (10 / 4)
          </button>
          <button
            type="button"
            onClick={() => applyRecommended("gemini_api_tier2")}
            className="px-2.5 py-1 text-xs border border-purple-300 rounded text-purple-700 hover:bg-purple-50"
          >
            Gemini API Tier 2 (60 / 8)
          </button>
        </div>

        <form onSubmit={handleSaveRate} className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-fg-secondary mb-1">
                每分钟请求数 (RPM)
              </label>
              <input
                type="number"
                min={1}
                max={1000}
                value={rateForm.image_rate_limit_per_min}
                onChange={(e) =>
                  setRateForm({
                    ...rateForm,
                    image_rate_limit_per_min: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-border-default rounded text-sm"
              />
              <div className="text-[10px] text-fg-tertiary mt-0.5">
                {settingMap.get("image_rate_limit_per_min")?.notes}
              </div>
            </div>
            <div>
              <label className="block text-xs text-fg-secondary mb-1">
                突发上限 (burst)
              </label>
              <input
                type="number"
                min={1}
                max={1000}
                value={rateForm.image_rate_burst}
                onChange={(e) =>
                  setRateForm({ ...rateForm, image_rate_burst: e.target.value })
                }
                className="w-full px-3 py-2 border border-border-default rounded text-sm"
              />
              <div className="text-[10px] text-fg-tertiary mt-0.5">
                {settingMap.get("image_rate_burst")?.notes}
              </div>
            </div>
            <div>
              <label className="block text-xs text-fg-secondary mb-1">
                并发数 (concurrency)
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={rateForm.image_concurrency}
                onChange={(e) =>
                  setRateForm({
                    ...rateForm,
                    image_concurrency: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-border-default rounded text-sm"
              />
              <div className="text-[10px] text-fg-tertiary mt-0.5">
                {settingMap.get("image_concurrency")?.notes}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存限流"}
          </button>
        </form>
      </section>

      {/* ===== 汇率 / 预算 ===== */}
      <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6">
        <h2 className="text-base font-semibold text-fg-primary mb-1">
          汇率 / 预算
        </h2>
        <p className="text-xs text-fg-tertiary mb-4">
          账单换算与新用户默认预算。
        </p>

        <form onSubmit={handleSaveMisc} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-fg-secondary mb-1">
                美元兑人民币汇率
              </label>
              <input
                type="number"
                step="0.01"
                value={miscForm.usd_to_cny}
                onChange={(e) =>
                  setMiscForm({ ...miscForm, usd_to_cny: e.target.value })
                }
                className="w-full px-3 py-2 border border-border-default rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-fg-secondary mb-1">
                新用户默认月度预算 (CNY，0 = 无限)
              </label>
              <input
                type="number"
                step="1"
                min={0}
                value={miscForm.default_budget_cny}
                onChange={(e) =>
                  setMiscForm({
                    ...miscForm,
                    default_budget_cny: e.target.value,
                  })
                }
                className="w-full px-3 py-2 border border-border-default rounded text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </form>
      </section>
    </main>
  );
}
