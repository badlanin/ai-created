"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Store,
  Tags,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";

import { fetchWithShopifyDevice } from "@/lib/shopify-device-client";

type StoreSafe = {
  key: string;
  name: string;
  shopDomain: string;
  tokenPresent: boolean;
  tokenIssuedAt: string | null;
  tokenExpiresAt: string | null;
  tokenExpired: boolean;
  tokenRemainingMs: number;
  defaultProductQuery: string;
};

type RunStoreRef = { key: string; name: string | null; shopDomain: string };

type RunSummary = {
  id: string;
  createdAt: number;
  updatedAt: number;
  shopDomain: string;
  shopName: string | null;
  storeKeys: string[];
  stores: RunStoreRef[];
  proposalStores?: RunStoreRef[];
  start: number;
  query: string;
  sortOrder?: ProductBatchSortOrder;
  prompt: string;
  limit: number;
  model: string;
  targetFields?: TargetField[];
  proposalCount: number;
  failureCount: number;
  stopped?: boolean;
  stopReason?: string | null;
  lastApplyAt?: number | null;
};

type FaqItem = {
  question: string;
  answer: string;
};

type ImageTextItem = {
  mediaId: string;
  altText: string;
  filename?: string;
};

type TargetField =
  | "title"
  | "descriptionHtml"
  | "seoTitle"
  | "metaDescription"
  | "tags"
  | "templateStyle"
  | "categorySize"
  | "categoryMetafields"
  | "imageAltTexts"
  | "faq";

type ProductBatchSortOrder = "newest" | "oldest";

const ALL_TARGET_FIELDS: TargetField[] = [
  "title",
  "descriptionHtml",
  "seoTitle",
  "metaDescription",
  "tags",
  "templateStyle",
  "categorySize",
  "categoryMetafields",
  "imageAltTexts",
  "faq",
];

type CategoryMetafields = Partial<
  Record<
    | "size"
    | "fabric"
    | "ageGroup"
    | "occasion"
    | "dressStyle"
    | "neckline"
    | "dressLengthType"
    | "sleeveLengthType"
    | "targetGender",
    string
  >
>;

type Snapshot = {
  title: string;
  handle: string;
  descriptionHtml: string;
  seoTitle: string;
  metaDescription: string;
  categorySize: string;
  categoryMetafields?: CategoryMetafields;
  templateStyle: string;
  tags: string[];
  faq: FaqItem[];
  imageAltTexts?: ImageTextItem[];
};

type Proposal = {
  store: {
    key: string;
    name: string | null;
    shopDomain: string;
  };
  product: {
    id: string;
    title: string;
    handle: string;
    status: string;
  };
  current: Snapshot;
  proposed: Snapshot & {
    imageAltTexts: ImageTextItem[];
  };
  targetFields?: TargetField[];
  targetCategoryMetafieldKeys?: Array<keyof CategoryMetafields>;
  rationale: string;
  warnings: string[];
};

type ApplyResult = {
  storeKey?: string;
  productId: string;
  title: string;
  ok: boolean;
  categorySizeUpdate?: unknown;
  categoryMetafieldsUpdate?: unknown;
  error?: string;
};

type RunDocument = RunSummary & {
  rulesVersion: string;
  includeImages: boolean;
  includeApplied: boolean;
  proposals: Proposal[];
  failures: Array<{ productId?: string; title?: string; error: string }>;
  applyResults?: ApplyResult[];
};

type StatusData = {
  stores: StoreSafe[];
  runs: RunSummary[];
  appliedTag: string;
  rulesVersion: string;
  defaultPrompt: string;
};

type PreviewProgress = {
  jobId: string;
  phase:
    | "idle"
    | "starting"
    | "fetching"
    | "waiting"
    | "generating"
    | "stopping"
    | "stopped"
    | "completed"
    | "failed"
    | "finished"
    | "lost";
  percent: number;
  completed: number;
  total: number;
  message: string;
  currentStore?: string | null;
  currentProduct?: string | null;
  done: boolean;
  cancelled: boolean;
  createdAt: number;
  updatedAt: number;
  runId?: string | null;
  error?: string | null;
  shopifyThrottle?: {
    retryAt: number;
    retryAfterMs: number;
    attempt: number;
    maxAttempts: number;
    currentlyAvailable?: number;
    restoreRate?: number;
    maximumAvailable?: number;
    requestedQueryCost?: number;
    source: "shopify" | "fallback";
  } | null;
};

type ProductBatchPromptPreset = {
  id: string;
  name: string;
  createdAt: number;
  form: {
    query: string;
    productTitleKeyword?: string;
    productTypeKeyword?: string;
    sortOrder?: ProductBatchSortOrder;
    limit: number;
    start: number;
    prompt: string;
    includeImages: boolean;
    includeApplied: boolean;
  };
};

const FALLBACK_PROMPT =
  "请根据现有商品资料优化 Shopify 商品标题、描述、SEO 标题、Meta 描述、标签、图片 Alt 和 FAQ。保持事实准确，不要编造材质、认证、折扣、物流或售后承诺。文案优先使用英文，适合礼服/婚纱独立站自然搜索和 AI 问答引用。";
const PRODUCT_BATCH_PROMPT_PRESETS_STORAGE_KEY =
  "buqiqi_product_batch_optimization_prompt_presets_v1";

export default function ProductBatchOptimizationPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<RunDocument | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [selectedStoreKeys, setSelectedStoreKeys] = useState<Set<string>>(new Set());
  const [selectedProposalKeys, setSelectedProposalKeys] = useState<Set<string>>(
    new Set(),
  );
  const [expandedProposalKey, setExpandedProposalKey] = useState<string | null>(
    null,
  );
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const [addStoreOpen, setAddStoreOpen] = useState(false);
  const [credentialFile, setCredentialFile] = useState<File | null>(null);
  const [storeMessage, setStoreMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [previewProgress, setPreviewProgress] = useState<PreviewProgress | null>(
    null,
  );
  const [previewFilterDate, setPreviewFilterDate] = useState(() =>
    formatDateInput(Date.now()),
  );
  const [previewFilterStoreKey, setPreviewFilterStoreKey] = useState("__all__");
  const [stopRequested, setStopRequested] = useState(false);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [promptPresets, setPromptPresets] = useState<ProductBatchPromptPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const storeMenuRef = useRef<HTMLDivElement | null>(null);
  const presetMenuRef = useRef<HTMLDivElement | null>(null);
  const [form, setForm] = useState({
    query: "status:active",
    productTitleKeyword: "",
    sortOrder: "newest" as ProductBatchSortOrder,
    limit: 10,
    start: 0,
    prompt: FALLBACK_PROMPT,
    includeImages: true,
    includeApplied: false,
  });
  const [limitInput, setLimitInput] = useState("10");
  const [applyOptions, setApplyOptions] = useState({
    setDraft: false,
  });

  const stores = status?.stores || [];
  const selectedStores = stores.filter((store) => selectedStoreKeys.has(store.key));
  const selectedProductCount = selectedProposalKeys.size;
  const allStoresSelected =
    stores.length > 0 && selectedStoreKeys.size === stores.length;

  const applyResultByProposal = useMemo(() => {
    const map = new Map<string, ApplyResult>();
    for (const result of activeRun?.applyResults || []) {
      if (result.storeKey) {
        map.set(`${result.storeKey}::${result.productId}`, result);
      } else {
        map.set(result.productId, result);
      }
    }
    return map;
  }, [activeRun]);

  const previewStoreOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const run of runs) {
      for (const store of runFilterStores(run)) {
        const key = store.key;
        if (!key) continue;
        const current = map.get(key);
        if (current) {
          current.count += isRunOnDate(run.createdAt, previewFilterDate) ? 1 : 0;
          continue;
        }
        map.set(key, {
          key,
          label: store.name || store.shopDomain || key,
          count: isRunOnDate(run.createdAt, previewFilterDate) ? 1 : 0,
        });
      }
    }
    return Array.from(map.values());
  }, [runs, previewFilterDate]);

  const filteredRuns = useMemo(
    () =>
      runs.filter(
        (run) =>
          isRunOnDate(run.createdAt, previewFilterDate) &&
          runMatchesStoreFilter(run, previewFilterStoreKey),
      ),
    [runs, previewFilterDate, previewFilterStoreKey],
  );
  const filteredPreviewRuns = useMemo(
    () => filteredRuns.filter((run) => !isRunSubmitted(run)),
    [filteredRuns],
  );
  const filteredSubmittedRuns = useMemo(
    () => filteredRuns.filter((run) => isRunSubmitted(run)),
    [filteredRuns],
  );
  const previewRunTotal = useMemo(
    () => runs.filter((run) => !isRunSubmitted(run)).length,
    [runs],
  );
  const submittedRunTotal = useMemo(
    () => runs.filter((run) => isRunSubmitted(run)).length,
    [runs],
  );
  const previewRunLabels = useMemo(
    () => buildRunDisplayLabels(filteredPreviewRuns, previewFilterStoreKey),
    [filteredPreviewRuns, previewFilterStoreKey],
  );
  const submittedRunLabels = useMemo(
    () => buildRunDisplayLabels(filteredSubmittedRuns, previewFilterStoreKey),
    [filteredSubmittedRuns, previewFilterStoreKey],
  );
  const dateFilteredRunCount = useMemo(
    () => runs.filter((run) => isRunOnDate(run.createdAt, previewFilterDate)).length,
    [runs, previewFilterDate],
  );

  const filteredProposals = useMemo(() => {
    if (!activeRun || !isRunOnDate(activeRun.createdAt, previewFilterDate)) return [];
    return activeRun.proposals.filter(
      (proposal) =>
        previewFilterStoreKey === "__all__" ||
        proposal.store.key === previewFilterStoreKey,
    );
  }, [activeRun, previewFilterDate, previewFilterStoreKey]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!storeMenuRef.current?.contains(event.target as Node)) {
        setStoreMenuOpen(false);
      }
      if (!presetMenuRef.current?.contains(event.target as Node)) {
        setPresetMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    setPromptPresets(readProductBatchPromptPresets());
    void loadStatus(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeRun || loading || generating) return;
    const firstPreviewRun = filteredPreviewRuns[0];
    if (!firstPreviewRun) return;
    void loadRun(firstPreviewRun.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun?.id, filteredPreviewRuns, loading, generating]);

  useEffect(() => {
    if (!activeRun) return;
    const runStores = activeRun.stores || [];
    setPreviewFilterStoreKey((current) => {
      if (current !== "__all__" && runStores.some((store) => store.key === current)) {
        return current;
      }
      return runStores.length === 1 ? runStores[0].key : "__all__";
    });
  }, [activeRun?.id]);

  useEffect(() => {
    if (!previewJobId) return;
    const jobId = previewJobId;
    let disposed = false;
    async function refreshProgress() {
      try {
        const data = await readJson<{ progress: PreviewProgress }>(
          await fetchWithShopifyDevice(
            `/api/admin/product-batch-optimization/preview/progress?jobId=${encodeURIComponent(jobId)}`,
          ),
        );
        if (disposed) return;
        let nextProgress = data.progress;
        setPreviewProgress((prev) => {
          nextProgress = mergePreviewProgress(prev, data.progress);
          return nextProgress;
        });
        if (nextProgress.done) {
          if (nextProgress.runId) {
            const runData = await readJson<{ run: RunDocument }>(
              await fetchWithShopifyDevice(
                `/api/admin/product-batch-optimization/runs/${encodeURIComponent(nextProgress.runId)}`,
              ),
            );
            if (disposed) return;
            setActiveRun(runData.run);
            setOpenRunId(runData.run.id);
            setSelectedProposalKeys(
              new Set(runData.run.proposals.map((item) => proposalKey(item))),
            );
            setExpandedProposalKey(null);
            setRuns((prev) => [
              toSummary(runData.run),
              ...prev.filter((item) => item.id !== runData.run.id),
            ]);
            if (runData.run.stopped) {
              setNotice(
                `已强制停止。本次已生成 ${runData.run.proposalCount} 条预览，未继续处理后续商品。`,
              );
            } else if (runData.run.failures.length) {
              setError(
                `生成预览完成，但有 ${runData.run.failures.length} 个错误。请在预览记录上方查看错误明细。`,
              );
            } else {
              setNotice(`已生成 ${runData.run.proposalCount} 条优化预览。`);
            }
          } else if (
            nextProgress.error ||
            nextProgress.phase === "failed"
          ) {
            setError(nextProgress.error || nextProgress.message);
          }
          setGenerating(false);
          setPreviewJobId(null);
          setStopRequested(false);
        }
      } catch {
        // Progress is helpful, but the preview request owns the final error.
      }
    }
    void refreshProgress();
    const timer = window.setInterval(() => void refreshProgress(), 900);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [previewJobId]);

  async function loadStatus(selectFirst = true) {
    setLoading(true);
    setError(null);
    try {
      const data = await readJson<StatusData>(
        await fetchWithShopifyDevice("/api/admin/product-batch-optimization/status"),
      );
      setStatus(data);
      setRuns(data.runs || []);
      if (data.defaultPrompt && form.prompt === FALLBACK_PROMPT) {
        setForm((prev) => ({ ...prev, prompt: data.defaultPrompt }));
      }
      setSelectedStoreKeys((prev) => {
        const valid = new Set((data.stores || []).map((store) => store.key));
        const next = new Set([...prev].filter((key) => valid.has(key)));
        if (next.size === 0) {
          for (const store of data.stores || []) next.add(store.key);
        }
        return next;
      });
      const firstPreviewRun = data.runs?.find((run) => !isRunSubmitted(run));
      if (selectFirst && !activeRun && firstPreviewRun) {
        await loadRun(firstPreviewRun.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadRun(id: string) {
    setError(null);
    const data = await readJson<{ run: RunDocument }>(
      await fetchWithShopifyDevice(
        `/api/admin/product-batch-optimization/runs/${encodeURIComponent(id)}`,
      ),
    );
    setActiveRun(data.run);
    setOpenRunId(data.run.id);
    setSelectedProposalKeys(
      new Set(data.run.proposals.map((item) => proposalKey(item))),
    );
    setExpandedProposalKey(null);
  }

  async function toggleRun(id: string) {
    if (activeRun?.id === id) {
      setOpenRunId((current) => (current === id ? null : id));
      return;
    }
    await loadRun(id);
  }

  async function handlePreview(e: FormEvent) {
    e.preventDefault();
    if (!selectedStoreKeys.size) {
      setError("请先选择生成店铺。");
      return;
    }
    const normalizedLimit = normalizeLimitInput(limitInput, form.limit);
    const jobId = createPreviewJobId();
    const estimatedTotal = Math.max(
      1,
      selectedStoreKeys.size * normalizedLimit,
    );
    const effectiveQuery = buildProductBatchShopifyQuery(
      form.query,
      form.productTitleKeyword,
    );
    setForm((prev) => ({ ...prev, limit: normalizedLimit }));
    setLimitInput(String(normalizedLimit));
    setGenerating(true);
    setPreviewProgress({
      jobId,
      phase: "starting",
      percent: 0,
      completed: 0,
      total: estimatedTotal,
      message: `准备处理 ${selectedStoreKeys.size} 个店铺，预计最多 ${estimatedTotal} 个商品。`,
      currentStore: null,
      currentProduct: null,
      done: false,
      cancelled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setStopRequested(false);
    setError(null);
    setNotice(null);
    try {
      await readJson<{ jobId: string; queued: boolean }>(
        await fetchWithShopifyDevice("/api/admin/product-batch-optimization/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            query: effectiveQuery,
            limit: normalizedLimit,
            jobId,
            storeKeys: Array.from(selectedStoreKeys),
            background: true,
          }),
        }),
      );
      setPreviewJobId(jobId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPreviewProgress((prev) => ({
        ...(prev || createLocalProgress(jobId, estimatedTotal)),
        phase: "failed",
        done: true,
        message,
        updatedAt: Date.now(),
      }));
      setError(message);
      setGenerating(false);
      setPreviewJobId(null);
      setStopRequested(false);
    }
  }

  async function handleForceStopPreview() {
    if (!previewJobId) return;
    setStopRequested(true);
    try {
      const result = await readJson<{ cancelled?: boolean; reason?: string }>(
        await fetchWithShopifyDevice("/api/admin/product-batch-optimization/preview/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: previewJobId }),
        }),
      );
      if (!result.cancelled) {
        setError(result.reason || "当前预览任务已经结束。");
        setStopRequested(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStopRequested(false);
    }
  }

  function openSavePresetDialog() {
    setError(null);
    setPresetName("");
    setSavePresetOpen(true);
  }

  function handleSavePreset(e: FormEvent) {
    e.preventDefault();
    const name = presetName.trim();
    if (!name) {
      setError("请输入预设自定义名。");
      return;
    }
    if (!form.prompt.trim()) {
      setError("优化提示词为空，无法保存预设。");
      return;
    }
    const preset: ProductBatchPromptPreset = {
      id: `batch_prompt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt: Date.now(),
      form: {
        query: form.query,
        productTitleKeyword: form.productTitleKeyword,
        sortOrder: form.sortOrder,
        limit: normalizeLimitInput(limitInput, form.limit),
        start: Math.max(0, Number(form.start) || 0),
        prompt: form.prompt,
        includeImages: form.includeImages,
        includeApplied: form.includeApplied,
      },
    };
    const presets = readProductBatchPromptPresets();
    window.localStorage.setItem(
      PRODUCT_BATCH_PROMPT_PRESETS_STORAGE_KEY,
      JSON.stringify({ version: 1, presets: [preset, ...presets] }),
    );
    setPromptPresets([preset, ...presets]);
    setSavePresetOpen(false);
    setPresetName("");
    setNotice(`已保存预设：${name}`);
  }

  function applyPromptPreset(presetId: string) {
    const preset = promptPresets.find((item) => item.id === presetId);
    if (!preset) return;
    const nextLimit = Number(preset.form.limit) || 1;
    setForm((prev) => ({
      ...prev,
      query: preset.form.query,
      productTitleKeyword: preset.form.productTitleKeyword || preset.form.productTypeKeyword || "",
      sortOrder: preset.form.sortOrder || "newest",
      limit: nextLimit,
      start: preset.form.start,
      prompt: preset.form.prompt,
      includeImages: preset.form.includeImages,
      includeApplied: preset.form.includeApplied,
    }));
    setLimitInput(String(nextLimit));
    setPresetMenuOpen(false);
    setNotice(`已应用预设：${preset.name}`);
  }

  function deletePromptPreset(presetId: string) {
    const preset = promptPresets.find((item) => item.id === presetId);
    if (!preset) return;
    if (!window.confirm(`确定删除预设「${preset.name}」？`)) return;

    const nextPresets = promptPresets.filter((item) => item.id !== presetId);
    window.localStorage.setItem(
      PRODUCT_BATCH_PROMPT_PRESETS_STORAGE_KEY,
      JSON.stringify({ version: 1, presets: nextPresets }),
    );
    setPromptPresets(nextPresets);
    if (!nextPresets.length) setPresetMenuOpen(false);
    setNotice(`已删除预设：${preset.name}`);
  }

  async function handleApply(proposalKeys?: string[], label = "选中商品") {
    if (!activeRun) return;
    const keys = proposalKeys || Array.from(selectedProposalKeys);
    if (!keys.length) {
      setError("请先选择要应用的商品。");
      return;
    }
    const confirmed = window.confirm(
      `确定把${label}写回 Shopify？本次会应用 ${keys.length} 个商品。`,
    );
    if (!confirmed) return;

    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      const data = await readJson<{ run: RunDocument; results: ApplyResult[] }>(
        await fetchWithShopifyDevice("/api/admin/product-batch-optimization/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: activeRun.id,
            selectedProposalKeys: keys,
            selectedStoreKeys: Array.from(selectedStoreKeys),
            applyFaq: true,
            skipImageAlt: !activeRun.targetFields?.includes("imageAltTexts"),
            setDraft: applyOptions.setDraft,
          }),
        }),
      );
      setActiveRun(data.run);
      setRuns((prev) => [
        toSummary(data.run),
        ...prev.filter((item) => item.id !== data.run.id),
      ]);
      const okCount = data.results.filter((item) => item.ok).length;
      setNotice(`写回完成：成功 ${okCount} 个，失败 ${data.results.length - okCount} 个。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  async function handleReapplyRun(id: string) {
    setError(null);
    setNotice(null);
    try {
      const source =
        activeRun?.id === id
          ? activeRun
          : (
              await readJson<{ run: RunDocument }>(
                await fetchWithShopifyDevice(
                  `/api/admin/product-batch-optimization/runs/${encodeURIComponent(id)}`,
                ),
              )
            ).run;
      const keys = source.proposals.map((proposal) => proposalKey(proposal));
      if (!keys.length) {
        setError("这条提交记录里没有可重新提交的商品。");
        return;
      }
      const confirmed = window.confirm(
        `确定重新提交这条提交记录？本次会应用 ${keys.length} 个商品。`,
      );
      if (!confirmed) return;

      setApplying(true);
      const data = await readJson<{ run: RunDocument; results: ApplyResult[] }>(
        await fetchWithShopifyDevice("/api/admin/product-batch-optimization/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: source.id,
            selectedProposalKeys: keys,
            selectedStoreKeys: Array.from(selectedStoreKeys),
            applyFaq: true,
            skipImageAlt: !source.targetFields?.includes("imageAltTexts"),
            setDraft: false,
          }),
        }),
      );
      setActiveRun(data.run);
      setRuns((prev) => [
        toSummary(data.run),
        ...prev.filter((item) => item.id !== data.run.id),
      ]);
      const okCount = data.results.filter((item) => item.ok).length;
      setNotice(
        `重新提交完成：成功 ${okCount} 个，失败 ${data.results.length - okCount} 个。`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  async function handleExchangeStore(e: FormEvent) {
    e.preventDefault();
    if (!credentialFile) {
      setStoreMessage("请先选择一个 TXT 凭据文件。");
      return;
    }
    if (credentialFile.size > 64 * 1024) {
      setStoreMessage("TXT 文件过大，请使用小于 64KB 的纯文本凭据文件。");
      return;
    }

    setExchanging(true);
    setStoreMessage("凭据读取成功，正在向 Shopify 兑换 Token...");
    try {
      const credentials = parseShopifyCredentials(await credentialFile.text());
      if (!credentials.shopDomain || !credentials.clientId || !credentials.clientSecret) {
        throw new Error(
          "TXT 文件必须包含 SHOPIFY_SHOP_DOMAIN、SHOPIFY_CLIENT_ID、SHOPIFY_CLIENT_SECRET。",
        );
      }
      const result = await readJson<{ store: StoreSafe }>(
        await fetchWithShopifyDevice(
          "/api/admin/product-batch-optimization/stores/exchange-token",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials),
          },
        ),
      );
      setCredentialFile(null);
      setStoreMessage(null);
      setAddStoreOpen(false);
      setSelectedStoreKeys(new Set([result.store.key]));
      setForm((prev) => ({
        ...prev,
        query: result.store.defaultProductQuery || prev.query,
      }));
      await loadStatus(false);
      setNotice(`店铺 ${result.store.shopDomain} 已添加，Token 已保存。`);
    } catch (e) {
      setStoreMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setExchanging(false);
    }
  }

  async function handleDeleteStore(store: StoreSafe) {
    if (!window.confirm(`确定删除产品批量优化里的店铺 ${store.name || store.shopDomain}？`)) {
      return;
    }
    setError(null);
    try {
      await readJson(
        await fetchWithShopifyDevice(
          `/api/admin/product-batch-optimization/stores/${encodeURIComponent(store.key)}`,
          { method: "DELETE" },
        ),
      );
      setSelectedStoreKeys((prev) => {
        const next = new Set(prev);
        next.delete(store.key);
        return next;
      });
      await loadStatus(false);
      setNotice(`已删除店铺 ${store.shopDomain}。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeleteRun(id: string, skipConfirm = false) {
    if (!skipConfirm && !window.confirm("确定删除这条预览记录？")) return;
    setError(null);
    try {
      await readJson(
        await fetchWithShopifyDevice(
          `/api/admin/product-batch-optimization/runs/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        ),
      );
      setRuns((prev) => prev.filter((item) => item.id !== id));
      if (activeRun?.id === id) {
        setActiveRun(null);
        setOpenRunId(null);
        setSelectedProposalKeys(new Set());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function toggleStore(key: string) {
    const next = new Set(selectedStoreKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setSelectedStoreKeys(next);
    if (next.size === 1) {
      const [onlyKey] = Array.from(next);
      setPreviewFilterStoreKey(onlyKey);
    } else if (previewFilterStoreKey !== "__all__" && !next.has(previewFilterStoreKey)) {
      setPreviewFilterStoreKey("__all__");
    }
  }

  function selectSingleStore(key: string) {
    setSelectedStoreKeys(new Set([key]));
    setPreviewFilterStoreKey(key);
    setStoreMenuOpen(false);
  }

  function selectAllStores() {
    setSelectedStoreKeys(new Set(stores.map((store) => store.key)));
    setPreviewFilterStoreKey("__all__");
  }

  function toggleProduct(key: string) {
    setSelectedProposalKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllProducts() {
    if (!activeRun) return;
    setSelectedProposalKeys(
      new Set(filteredProposals.map((item) => proposalKey(item))),
    );
  }

  function clearProducts() {
    setSelectedProposalKeys(new Set());
  }

  function currentStoreProposalKeys() {
    if (!activeRun) return [];
    const currentStoreKey =
      previewFilterStoreKey !== "__all__"
        ? previewFilterStoreKey
        : selectedStores[0]?.key || activeRun.storeKeys?.[0] || activeRun.stores?.[0]?.key || "";
    return activeRun.proposals
      .filter((proposal) => !currentStoreKey || proposal.store.key === currentStoreKey)
      .map((proposal) => proposalKey(proposal));
  }

  function currentStoreSelectedProposalKeys() {
    const currentKeys = new Set(currentStoreProposalKeys());
    return Array.from(selectedProposalKeys).filter((key) => currentKeys.has(key));
  }

  function allPreviewProposalKeys() {
    return activeRun?.proposals.map((proposal) => proposalKey(proposal)) || [];
  }

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white"
            style={{
              background: "var(--brand-gradient)",
              boxShadow: "0 0 16px var(--brand-glow)",
            }}
          >
            <WandSparkles size={18} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-tight text-fg-primary">
              产品批量优化
            </h1>
            <p className="mt-0.5 text-[13px] text-fg-tertiary">
              使用本功能独立添加的 Shopify 店铺生成 SEO/GEO 优化预览，再选择写回。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadStatus(false)}
          className="btn btn-secondary btn-md"
          disabled={loading}
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          刷新
        </button>
      </header>

      {error ? (
        <div className="mb-4 rounded-lg border border-[rgba(239,68,68,0.28)] bg-[var(--danger-bg)] p-3 text-sm text-danger">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-4 rounded-lg border border-[rgba(16,185,129,0.28)] bg-[var(--success-bg)] p-3 text-sm text-success">
          {notice}
        </div>
      ) : null}

      <section className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-fg-primary">批量条件</h2>
              <p className="mt-1 text-xs text-fg-tertiary">
                店铺独立绑定在产品批量优化中，不读取产品上架的 Shopify 绑定。
              </p>
            </div>
            <div className="chip chip-brand">规则 {status?.rulesVersion || "-"}</div>
          </div>

          <form onSubmit={handlePreview} className="space-y-4">
            <div ref={storeMenuRef}>
              <label className="mb-1 block text-xs font-medium text-fg-secondary">
                生成店铺（可多选）
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setStoreMenuOpen((v) => !v)}
                  className="input flex h-10 items-center justify-between text-left"
                >
                  <span className="truncate">
                    {storePickerLabel(selectedStores, stores)}
                  </span>
                  <ChevronDown size={15} className="text-fg-tertiary" />
                </button>

                {storeMenuOpen ? (
                  <div className="absolute z-50 mt-2 w-full rounded-lg border border-border-default bg-bg-secondary p-2 shadow-lg">
                    <button
                      type="button"
                      onClick={selectAllStores}
                      className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
                        allStoresSelected
                          ? "bg-[var(--brand-50-bg)] text-brand-400"
                          : "hover:bg-bg-hover text-fg-secondary"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={allStoresSelected}
                        readOnly
                        className="h-4 w-4"
                      />
                      全部店铺（{stores.length}）
                    </button>

                    <div className="max-h-60 overflow-y-auto">
                      {stores.map((store) => (
                        <div
                          key={store.key}
                          className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
                            selectedStoreKeys.has(store.key)
                              ? "bg-[var(--brand-50-bg)] text-fg-primary"
                              : "hover:bg-bg-hover text-fg-secondary"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedStoreKeys.has(store.key)}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => toggleStore(store.key)}
                            className="h-4 w-4"
                          />
                          <button
                            type="button"
                            onClick={() => selectSingleStore(store.key)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {store.name || store.shopDomain}
                            </span>
                            <span className="block text-[11px] text-fg-tertiary">
                              {store.key}
                            </span>
                            </span>
                            <span className="text-[11px]">
                              {tokenCountdown(store)}
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setStoreMenuOpen(false);
                        setAddStoreOpen(true);
                        setStoreMessage(null);
                      }}
                      className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-brand-400 hover:bg-[var(--brand-50-bg)]"
                    >
                      <Plus size={14} />
                      添加店铺
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[92px_110px_180px_150px_1fr]">
              <label className="text-xs font-medium text-fg-secondary">
                数量
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="input mt-1"
                  value={limitInput}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^\d]/g, "");
                    setLimitInput(value);
                    const next = Number(value);
                    if (Number.isFinite(next) && next > 0) {
                      setForm((prev) => ({ ...prev, limit: next }));
                    }
                  }}
                />
              </label>
              <label className="text-xs font-medium text-fg-secondary">
                起始位置
                <input
                  type="number"
                  min={0}
                  max={100000}
                  className="input mt-1"
                  value={form.start}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      start: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                />
              </label>
              <label className="text-xs font-medium text-fg-secondary">
                标题关键词
                <input
                  className="input mt-1"
                  value={form.productTitleKeyword}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      productTitleKeyword: e.target.value,
                    }))
                  }
                  placeholder="Homecoming"
                />
              </label>
              <label className="text-xs font-medium text-fg-secondary">
                读取顺序
                <select
                  className="input mt-1"
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      sortOrder:
                        e.target.value === "oldest" ? "oldest" : "newest",
                    }))
                  }
                >
                  <option value="newest">最新商品优先</option>
                  <option value="oldest">最旧商品优先</option>
                </select>
              </label>
              <label className="text-xs font-medium text-fg-secondary">
                Shopify 查询
                <input
                  className="input mt-1"
                  value={form.query}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, query: e.target.value }))
                  }
                  placeholder="status:active"
                />
              </label>
            </div>

            <label className="block text-xs font-medium text-fg-secondary">
              优化提示词
              <textarea
                className="input mt-1 min-h-[132px] resize-y"
                value={form.prompt}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, prompt: e.target.value }))
                }
              />
            </label>

            <div className="flex flex-wrap items-center gap-4 text-sm text-fg-secondary">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.includeImages}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      includeImages: e.target.checked,
                    }))
                  }
                  className="h-4 w-4"
                />
                参考商品图片 URL/Alt
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.includeApplied}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      includeApplied: e.target.checked,
                    }))
                  }
                  className="h-4 w-4"
                />
                包含已优化标签商品
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div ref={presetMenuRef} className="relative min-w-[180px]">
                <button
                  type="button"
                  onClick={() => setPresetMenuOpen((open) => !open)}
                  className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-primary px-3 text-sm text-fg-primary outline-none transition-colors hover:bg-bg-secondary focus:border-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!promptPresets.length || generating}
                >
                  <span>{promptPresets.length ? "选择预设" : "暂无预设"}</span>
                  <ChevronDown size={14} />
                </button>
                {presetMenuOpen && promptPresets.length ? (
                  <div className="absolute left-0 top-[calc(100%+4px)] z-30 max-h-56 w-full overflow-y-auto rounded-md border border-border-subtle bg-bg-primary py-1 shadow-lg">
                    {promptPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPromptPreset(preset.id)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          deletePromptPreset(preset.id);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm text-fg-primary hover:bg-bg-secondary"
                        title="右键删除预设"
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-md"
                disabled={generating || selectedStoreKeys.size === 0}
              >
                {generating ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Send size={15} />
                )}
                生成预览
              </button>
              <button
                type="button"
                onClick={() => void handleForceStopPreview()}
                className="btn btn-danger-outline btn-md"
                disabled={!generating || !previewJobId || stopRequested}
              >
                <X size={15} />
                {stopRequested ? "停止中" : "强制停止"}
              </button>
              <button
                type="button"
                onClick={openSavePresetDialog}
                className="btn btn-outline btn-md"
              >
                <FileText size={15} />
                保存预设
              </button>
            </div>
          </form>
        </div>

        <aside className="space-y-4">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
                <Store size={16} className="text-brand-400" />
                独立店铺
              </div>
              <button
                type="button"
                onClick={() => setAddStoreOpen(true)}
                className="icon-btn icon-btn-brand"
                title="添加店铺"
              >
                <Plus size={15} />
              </button>
            </div>
            {stores.length ? (
              <div className="space-y-2">
                {stores.map((store) => (
                  <div
                    key={store.key}
                    className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-secondary p-2"
                  >
                    <input
                      type="checkbox"
                      checked={selectedStoreKeys.has(store.key)}
                      onChange={() => toggleStore(store.key)}
                      className="h-4 w-4"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg-primary">
                        {store.name || store.shopDomain}
                      </div>
                      <div className="truncate text-[11px] text-fg-tertiary">
                        {store.key} · {tokenCountdown(store)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteStore(store)}
                      className="icon-btn icon-btn-danger"
                      title="删除店铺"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md bg-[var(--warn-bg)] p-3 text-sm text-warn">
                还没有添加独立店铺。
              </div>
            )}
          </div>

          <PreviewProgressCard
            progress={previewProgress}
            generating={generating}
          />
        </aside>
      </section>

      {activeRun && !isRunSubmitted(activeRun) ? (
        <ActiveRunPreviewControls
          activeRun={activeRun}
          applying={applying}
          selectedProductCount={selectedProductCount}
          applyOptions={applyOptions}
          currentStoreProposalCount={currentStoreProposalKeys().length}
          currentStoreSelectedProposalCount={currentStoreSelectedProposalKeys().length}
          allPreviewProposalCount={allPreviewProposalKeys().length}
          onSelectAll={selectAllProducts}
          onClear={clearProducts}
          onDelete={() => void handleDeleteRun(activeRun.id)}
          onApplySelected={() => void handleApply()}
          onApplyCurrentStoreSelected={() =>
            void handleApply(currentStoreSelectedProposalKeys(), "当前店铺选中项")
          }
          onApplyCurrentStore={() =>
            void handleApply(currentStoreProposalKeys(), "当前店铺全部预览")
          }
          onApplyAll={() =>
            void handleApply(allPreviewProposalKeys(), "预览中的全部店铺")
          }
          onSetDraft={(checked) =>
            setApplyOptions((prev) => ({ ...prev, setDraft: checked }))
          }
        />
      ) : null}

      <section className="mb-4 card p-4">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-fg-primary">
              预览记录与优化结果
            </h2>
            <p className="mt-1 text-xs text-fg-tertiary">
              点击同一条记录可展开或收起优化预览结果。
            </p>
          </div>
          <span className="text-xs text-fg-tertiary">
            {filteredPreviewRuns.length}/{previewRunTotal} 条
          </span>
        </div>

        <div className="mb-3 rounded-lg border border-border-subtle bg-bg-secondary p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr] md:items-end">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-secondary">
                记录日期
              </span>
              <input
                type="date"
                value={previewFilterDate}
                onChange={(e) => setPreviewFilterDate(e.target.value)}
                className="w-full rounded-md border border-border-subtle bg-bg-primary px-3 py-2 text-sm text-fg-primary outline-none focus:border-brand-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-secondary">
                查看店铺
              </span>
              <select
                value={previewFilterStoreKey}
                onChange={(e) => setPreviewFilterStoreKey(e.target.value)}
                className="w-full rounded-md border border-border-subtle bg-bg-primary px-3 py-2 text-sm text-fg-primary outline-none focus:border-brand-400"
              >
                <option value="__all__">
                  全部店铺（{dateFilteredRunCount} 条记录）
                </option>
                {previewStoreOptions.map((store) => (
                  <option key={store.key} value={store.key}>
                    {store.label}（{store.count} 条记录）
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="space-y-2">
          {filteredPreviewRuns.length ? (
            filteredPreviewRuns.map((run) => {
              const isActive = activeRun?.id === run.id;
              const isOpen = openRunId === run.id;
              return (
                <div key={run.id} className="space-y-3">
                  <button
                    type="button"
                    onClick={() => void toggleRun(run.id)}
                    className={`relative w-full rounded-lg border p-3 pb-9 text-left transition-colors ${
                      isActive
                        ? "border-brand-400 bg-[var(--brand-50-bg)]"
                        : "border-border-subtle bg-bg-secondary hover:bg-bg-tertiary"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-fg-primary">
                          {previewRunLabels.get(run.id) || runStoreLabel(run)}
                        </div>
                        <div className="mt-1 text-xs text-fg-tertiary">
                          {formatTime(run.createdAt)}
                        </div>
                        <div className="mt-1 truncate text-xs text-fg-tertiary">
                          {run.query || "无查询条件"}
                        </div>
                      </div>
                      <span className="chip chip-brand shrink-0">{run.proposalCount}</span>
                    </div>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteRun(run.id, true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.stopPropagation();
                        void handleDeleteRun(run.id, true);
                      }}
                      className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md border border-[rgba(239,68,68,0.28)] bg-bg-primary px-2 py-1 text-xs text-danger transition-colors hover:bg-[var(--danger-bg)]"
                    >
                      <Trash2 size={12} />
                      删除
                    </span>
                  </button>
                  {isOpen && isActive && activeRun ? (
                    <div className="rounded-lg border border-brand-200 bg-bg-primary p-3">
                      <ActiveRunPreviewResults
                        filteredProposals={filteredProposals}
                        selectedProposalKeys={selectedProposalKeys}
                        expandedProposalKey={expandedProposalKey}
                        applyResultByProposal={applyResultByProposal}
                        onToggleProduct={toggleProduct}
                        onExpandProduct={(key) =>
                          setExpandedProposalKey((current) =>
                            current === key ? null : key,
                          )
                        }
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className="rounded-md bg-bg-tertiary p-3 text-sm text-fg-tertiary">
              当前日期和店铺下暂无预览记录。
            </div>
          )}
        </div>

        <div className="mt-5 border-t border-border-subtle pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-fg-primary">提交记录</h3>
              <p className="mt-1 text-xs text-fg-tertiary">
                已提交的预览记录会显示在这里，可展开查看并重新提交。
              </p>
            </div>
            <span className="text-xs text-fg-tertiary">
              {filteredSubmittedRuns.length}/{submittedRunTotal} 条
            </span>
          </div>

          <div className="space-y-2">
            {filteredSubmittedRuns.length ? (
              filteredSubmittedRuns.map((run) => {
                const isActive = activeRun?.id === run.id;
                const isOpen = openRunId === run.id;
                return (
                  <div key={run.id} className="space-y-3">
                    <button
                      type="button"
                      onClick={() => void toggleRun(run.id)}
                      className={`relative w-full rounded-lg border p-3 pb-9 text-left transition-colors ${
                        isActive
                          ? "border-brand-400 bg-[var(--brand-50-bg)]"
                          : "border-border-subtle bg-bg-secondary hover:bg-bg-tertiary"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-fg-primary">
                            {submittedRunLabels.get(run.id) || runStoreLabel(run)}
                          </div>
                          <div className="mt-1 text-xs text-fg-tertiary">
                            {formatTime(run.createdAt)}
                            {run.lastApplyAt ? ` · 已提交 ${formatTime(run.lastApplyAt)}` : ""}
                          </div>
                          <div className="mt-1 truncate text-xs text-fg-tertiary">
                            {run.query || "无查询条件"}
                          </div>
                        </div>
                        <span className="chip chip-brand shrink-0">{run.proposalCount}</span>
                      </div>
                      <span className="absolute bottom-2 right-2 inline-flex items-center gap-2">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!applying) void handleReapplyRun(run.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (!applying) void handleReapplyRun(run.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-[rgba(99,102,241,0.28)] bg-bg-primary px-2 py-1 text-xs text-brand-400 transition-colors hover:bg-[var(--brand-50-bg)]"
                        >
                          <RefreshCw size={12} />
                          重新提交
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteRun(run.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            event.stopPropagation();
                            void handleDeleteRun(run.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-[rgba(239,68,68,0.28)] bg-bg-primary px-2 py-1 text-xs text-danger transition-colors hover:bg-[var(--danger-bg)]"
                        >
                          <Trash2 size={12} />
                          删除
                        </span>
                      </span>
                    </button>
                    {isOpen && isActive && activeRun ? (
                      <div className="rounded-lg border border-brand-200 bg-bg-primary p-3">
                        <ActiveRunPreviewResults
                          filteredProposals={filteredProposals}
                          selectedProposalKeys={selectedProposalKeys}
                          expandedProposalKey={expandedProposalKey}
                          applyResultByProposal={applyResultByProposal}
                          onToggleProduct={toggleProduct}
                          onExpandProduct={(key) =>
                            setExpandedProposalKey((current) =>
                              current === key ? null : key,
                            )
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="rounded-md bg-bg-tertiary p-3 text-sm text-fg-tertiary">
                当前日期和店铺下暂无提交记录。
              </div>
            )}
          </div>
        </div>
      </section>

      {savePresetOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.42)] p-4">
          <form
            onSubmit={handleSavePreset}
            className="w-full max-w-md rounded-xl border border-border-subtle bg-bg-secondary p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-fg-primary">
                  保存优化预设
                </h2>
                <p className="mt-1 text-xs text-fg-tertiary">
                  保存当前查询条件、优化提示词和勾选项。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSavePresetOpen(false)}
                className="icon-btn"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <label className="block text-xs font-medium text-fg-secondary">
              自定义名
              <input
                className="input mt-1"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="例如：礼服 SEO 尺寸预设"
                autoFocus
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSavePresetOpen(false)}
                className="btn btn-secondary btn-md"
              >
                取消
              </button>
              <button type="submit" className="btn btn-primary btn-md">
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {addStoreOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.42)] p-4">
          <form
            onSubmit={handleExchangeStore}
            className="w-full max-w-lg rounded-xl border border-border-subtle bg-bg-secondary p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-fg-primary">
                  添加 Shopify 店铺
                </h2>
                <p className="mt-1 text-xs text-fg-tertiary">
                  凭据只发送到本机服务，页面不会显示文件中的密钥。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!exchanging) setAddStoreOpen(false);
                }}
                className="icon-btn"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <label className="block rounded-lg border border-dashed border-brand-400 bg-[var(--brand-50-bg)] p-4 text-sm">
              <span className="mb-2 flex items-center gap-2 font-medium text-fg-primary">
                <Upload size={16} className="text-brand-400" />
                上传店铺凭据 TXT 文件
              </span>
              <input
                type="file"
                accept=".txt,text/plain"
                className="input mt-2"
                disabled={exchanging}
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setCredentialFile(file);
                  setStoreMessage(
                    file
                      ? `已选择 ${file.name}，点击“兑换 Token”自动添加店铺。`
                      : "请选择 TXT 文件。",
                  );
                }}
              />
            </label>

            <div className="mt-4 rounded-lg bg-bg-tertiary p-4">
              <div className="mb-2 text-xs font-semibold text-fg-secondary">
                TXT 文件内容格式
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-bg-secondary p-3 text-xs text-fg-secondary">{`SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...`}</pre>
              <p className="mt-2 text-xs text-fg-tertiary">
                Token 会保存在产品批量优化自己的本地配置中，不写入产品上架绑定。
              </p>
            </div>

            {storeMessage ? (
              <div
                className={`mt-4 rounded-md p-3 text-sm ${
                  /失败|必须|无效|过大|请选择/.test(storeMessage)
                    ? "bg-[var(--danger-bg)] text-danger"
                    : "bg-[var(--brand-50-bg)] text-brand-400"
                }`}
              >
                {storeMessage}
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAddStoreOpen(false)}
                className="btn btn-secondary btn-md"
                disabled={exchanging}
              >
                取消
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-md"
                disabled={exchanging || !credentialFile}
              >
                {exchanging ? <Loader2 size={15} className="animate-spin" /> : null}
                兑换 Token
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function normalizeLimitInput(value: string, fallback: number) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  const fallbackValue = Number(fallback);
  return Number.isFinite(fallbackValue) && fallbackValue > 0
    ? Math.floor(fallbackValue)
    : 1;
}

function buildProductBatchShopifyQuery(query: string, _productTitleKeyword: string) {
  return String(query || "").trim() || "status:active";
}
function readProductBatchPromptPresets(): ProductBatchPromptPreset[] {
  try {
    const raw = window.localStorage.getItem(
      PRODUCT_BATCH_PROMPT_PRESETS_STORAGE_KEY,
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw) as
      | ProductBatchPromptPreset[]
      | { presets?: ProductBatchPromptPreset[] };
    const presets = Array.isArray(parsed) ? parsed : parsed.presets;
    if (!Array.isArray(presets)) return [];
    return presets
      .filter((preset) => preset?.id && preset?.name && preset?.form?.prompt)
      .map((preset) => ({
        id: String(preset.id),
        name: String(preset.name),
        createdAt: Number(preset.createdAt) || 0,
        form: {
          query: String(preset.form.query || "status:active"),
          productTitleKeyword: String(preset.form.productTitleKeyword || preset.form.productTypeKeyword || ""),
          sortOrder: preset.form.sortOrder === "oldest" ? "oldest" : "newest",
          limit: Number(preset.form.limit) || 1,
          start: Math.max(0, Number(preset.form.start) || 0),
          prompt: String(preset.form.prompt || ""),
          includeImages: preset.form.includeImages !== false,
          includeApplied: Boolean(preset.form.includeApplied),
        },
      }));
  } catch {
    return [];
  }
}

function ActiveRunPreviewControls({
  activeRun,
  applying,
  selectedProductCount,
  applyOptions,
  currentStoreProposalCount,
  currentStoreSelectedProposalCount,
  allPreviewProposalCount,
  onSelectAll,
  onClear,
  onDelete,
  onApplySelected,
  onApplyCurrentStoreSelected,
  onApplyCurrentStore,
  onApplyAll,
  onSetDraft,
}: {
  activeRun: RunDocument;
  applying: boolean;
  selectedProductCount: number;
  applyOptions: { setDraft: boolean };
  currentStoreProposalCount: number;
  currentStoreSelectedProposalCount: number;
  allPreviewProposalCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  onApplySelected: () => void;
  onApplyCurrentStoreSelected: () => void;
  onApplyCurrentStore: () => void;
  onApplyAll: () => void;
  onSetDraft: (checked: boolean) => void;
}) {
  return (
      <div className="mb-3 rounded-lg border border-border-subtle bg-bg-secondary p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-fg-primary">
              {activeRun.proposalCount} 条优化预览
            </h3>
            <p className="mt-1 text-xs text-fg-tertiary">
              {runStoreLabel(activeRun)} · {formatTime(activeRun.createdAt)} ·{" "}
              {activeRun.model}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onSelectAll} className="btn btn-outline btn-sm">
              全选
            </button>
            <button type="button" onClick={onClear} className="btn btn-outline btn-sm">
              清空
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="btn btn-danger-outline btn-sm"
            >
              <Trash2 size={14} />
              删除记录
            </button>
            <button
              type="button"
              onClick={onApplySelected}
              className="btn btn-primary btn-sm"
              disabled={applying || selectedProductCount === 0}
            >
              {applying ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CheckCircle2 size={14} />
              )}
              应用 {selectedProductCount} 个
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-sm text-fg-secondary">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={applyOptions.setDraft}
              onChange={(e) => onSetDraft(e.target.checked)}
              className="h-4 w-4"
            />
            应用后设为草稿
          </label>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
          <button
            type="button"
            onClick={onApplyCurrentStoreSelected}
            className="btn btn-danger btn-sm justify-center"
          style={{ backgroundImage: "linear-gradient(90deg, #748BA4 0%, #59708B 100%)" }}
            disabled={applying || currentStoreSelectedProposalCount === 0}
          >
            提交当前店铺选中项
          </button>
          <button
            type="button"
            onClick={onApplyCurrentStore}
            className="btn btn-danger btn-sm justify-center"
          style={{ backgroundImage: "linear-gradient(90deg, #748BA4 0%, #59708B 100%)" }}
            disabled={applying || currentStoreProposalCount === 0}
          >
            自动提交当前店铺全部
          </button>
          <button
            type="button"
            onClick={onApplyAll}
            className="btn btn-danger btn-sm justify-center"
          style={{ backgroundImage: "linear-gradient(90deg, #748BA4 0%, #59708B 100%)" }}
            disabled={applying || allPreviewProposalCount === 0}
          >
            提交预览中的全部店铺
          </button>
          <button
            type="button"
            onClick={onClear}
            className="btn btn-danger btn-sm justify-center"
          style={{ backgroundImage: "linear-gradient(90deg, #748BA4 0%, #59708B 100%)" }}
            disabled={applying || selectedProductCount === 0}
          >
            取消
          </button>
        </div>

        {activeRun.stopped ? (
          <div className="mt-3 rounded-md bg-[var(--warn-bg)] p-3 text-sm text-warn">
            本次生成预览已强制停止，已保留停止前生成的结果。
          </div>
        ) : null}

        {activeRun.failures.length ? (
          <div className="mt-3 rounded-md bg-[var(--warn-bg)] p-3 text-sm text-warn">
            <div className="font-semibold">
              {activeRun.failures.length} 个商品生成失败。
            </div>
            <div className="mt-2 max-h-36 space-y-1 overflow-y-auto text-xs">
              {activeRun.failures.slice(0, 8).map((failure, index) => (
                <div key={`${failure.productId || failure.title || "failure"}-${index}`}>
                  {failure.title || failure.productId || "未知商品"}：{failure.error}
                </div>
              ))}
              {activeRun.failures.length > 8 ? (
                <div>还有 {activeRun.failures.length - 8} 个错误未展开。</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
  );
}

function ActiveRunPreviewResults({
  filteredProposals,
  selectedProposalKeys,
  expandedProposalKey,
  applyResultByProposal,
  onToggleProduct,
  onExpandProduct,
}: {
  filteredProposals: Proposal[];
  selectedProposalKeys: Set<string>;
  expandedProposalKey: string | null;
  applyResultByProposal: Map<string, ApplyResult>;
  onToggleProduct: (key: string) => void;
  onExpandProduct: (key: string) => void;
}) {
  return (
    <div className="space-y-3">
      {filteredProposals.length ? (
        filteredProposals.map((proposal, index) => {
          const key = proposalKey(proposal);
          return (
            <ProposalCard
              key={key}
              index={index + 1}
              proposal={proposal}
              selected={selectedProposalKeys.has(key)}
              expanded={expandedProposalKey === key}
              result={
                applyResultByProposal.get(key) ||
                applyResultByProposal.get(proposal.product.id)
              }
              onToggle={() => onToggleProduct(key)}
              onExpand={() => onExpandProduct(key)}
            />
          );
        })
      ) : (
        <div className="rounded-lg border border-border-subtle bg-bg-secondary p-6 text-center text-sm text-fg-tertiary">
          当前日期和店铺下没有匹配的预览。
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  index,
  proposal,
  selected,
  expanded,
  result,
  onToggle,
  onExpand,
}: {
  index: number;
  proposal: Proposal;
  selected: boolean;
  expanded: boolean;
  result?: ApplyResult;
  onToggle: () => void;
  onExpand: () => void;
}) {
  const proposedAltCount = proposal.proposed.imageAltTexts?.length ?? 0;

  return (
    <article
      className={`card overflow-hidden ${
        selected ? "ring-1 ring-[rgba(99,102,241,0.35)]" : ""
      }`}
    >
      <header className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onChange={onToggle}
            aria-label={`选择第 ${index} 个商品`}
            className="mt-1 h-4 w-4 flex-shrink-0"
          />
          <button
            type="button"
            onClick={onExpand}
            className="min-w-0 flex-1 text-left"
          >
            <span className="block truncate text-base font-semibold text-fg-primary">
              {index}. {proposal.proposed.title || proposal.product.title}
            </span>
            <span className="mt-1 block truncate text-xs text-fg-tertiary">
              {proposal.store.name || proposal.store.shopDomain} · {proposal.product.status} · {proposal.current.handle}
            </span>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {result ? (
            result.ok ? (
              <span className="chip chip-success">
                <CheckCircle2 size={12} />
                已应用
              </span>
            ) : (
              <span className="chip chip-danger">
                <AlertTriangle size={12} />
                失败
              </span>
            )
          ) : null}
          <span className="chip chip-brand">
            <Tags size={12} />
            {proposal.proposed.tags.length} 标签
          </span>
          <span className="chip chip-brand">
            <ImageIcon size={12} />
            {proposedAltCount} Alt
          </span>
          <button
            type="button"
            onClick={onExpand}
            className="icon-btn h-8 w-8"
            title={expanded ? "收起详情" : "查看详情"}
            aria-label={expanded ? "收起详情" : "查看详情"}
          >
            <ChevronDown
              size={16}
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </header>

      {result?.error ? (
        <div className="mx-4 mb-4 rounded-md bg-[var(--danger-bg)] p-3 text-sm text-danger">
          {result.error}
        </div>
      ) : null}

      {expanded ? (
        <div className="border-t border-border-subtle p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-fg-primary">
              {index}. 详细信息
            </div>
            <div className="text-xs text-fg-tertiary">左侧旧内容，右侧新内容</div>
          </div>

          <SnapshotCompareGrid
            current={proposal.current}
            proposed={proposal.proposed}
            targetFields={proposal.targetFields}
            targetCategoryMetafieldKeys={proposal.targetCategoryMetafieldKeys}
          />

          {(proposal.rationale || proposal.warnings.length) ? (
            <div className="mt-3 space-y-3">
              {proposal.rationale ? (
                <TextPanel title="优化理由" text={proposal.rationale} compact />
              ) : null}
              {proposal.warnings.length ? (
                <div className="rounded-md bg-[var(--warn-bg)] p-3">
                  <div className="mb-2 text-xs font-semibold text-warn">
                    注意事项
                  </div>
                  <ul className="space-y-1 text-xs text-warn">
                    {proposal.warnings.map((item, warningIndex) => (
                      <li key={`${item}-${warningIndex}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function SnapshotCompareGrid({
  current,
  proposed,
  targetFields,
  targetCategoryMetafieldKeys,
}: {
  current: Snapshot;
  proposed: Snapshot;
  targetFields?: TargetField[];
  targetCategoryMetafieldKeys?: CategoryMetafieldKey[];
}) {
  const fields = new Set(targetFields?.length ? targetFields : ALL_TARGET_FIELDS);
  const show = (field: TargetField) => fields.has(field);
  const categoryMetafieldKeys = getVisibleCategoryMetafieldKeys(
    current,
    proposed,
    fields,
    targetCategoryMetafieldKeys,
  );

  return (
    <section className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
      <SnapshotCompareHeader title="旧内容" tone="current" />
      <SnapshotCompareHeader title="新内容" tone="proposed" />
      {show("title") ? (
        <>
          <SnapshotField label="商品标题" value={current.title} tone="current" />
          <SnapshotField label="商品标题" value={proposed.title} tone="proposed" />
        </>
      ) : null}
      {show("descriptionHtml") ? (
        <>
          <SnapshotField
            label="商品描述"
            value={htmlToText(current.descriptionHtml)}
            tone="current"
            tall
          />
          <SnapshotField
            label="商品描述"
            value={htmlToText(proposed.descriptionHtml)}
            tone="proposed"
            tall
          />
        </>
      ) : null}
      {show("tags") ? (
        <>
          <SnapshotTagList tags={current.tags} tone="current" />
          <SnapshotTagList tags={proposed.tags} tone="proposed" />
        </>
      ) : null}
      {show("templateStyle") ? (
        <>
          <SnapshotField label="模板样式" value={current.templateStyle} tone="current" />
          <SnapshotField label="模板样式" value={proposed.templateStyle} tone="proposed" />
        </>
      ) : null}
      {categoryMetafieldKeys.length ? (
        <>
          <SnapshotField
            label="类别元字段"
            value={formatCategoryMetafields(current, categoryMetafieldKeys)}
            tone="current"
          />
          <SnapshotField
            label="类别元字段"
            value={formatCategoryMetafields(proposed, categoryMetafieldKeys)}
            tone="proposed"
          />
        </>
      ) : null}
      {show("imageAltTexts") ? (
        <>
          <SnapshotImageAltList imageAltTexts={current.imageAltTexts || []} tone="current" />
          <SnapshotImageAltList imageAltTexts={proposed.imageAltTexts || []} tone="proposed" />
        </>
      ) : null}
      {show("faq") ? (
        <>
          <SnapshotFaqList faq={current.faq} tone="current" />
          <SnapshotFaqList faq={proposed.faq} tone="proposed" />
        </>
      ) : null}
      {show("seoTitle") ? (
        <>
          <SnapshotField label="SEO 标题" value={current.seoTitle} tone="current" />
          <SnapshotField label="SEO 标题" value={proposed.seoTitle} tone="proposed" />
        </>
      ) : null}
      {show("metaDescription") ? (
        <>
          <SnapshotField label="Meta 描述" value={current.metaDescription} tone="current" />
          <SnapshotField label="Meta 描述" value={proposed.metaDescription} tone="proposed" />
        </>
      ) : null}
    </section>
  );
}

type CategoryMetafieldKey = keyof CategoryMetafields;

const CATEGORY_METAFIELD_LABELS: Array<{ key: CategoryMetafieldKey; label: string }> = [
  { key: "size", label: "尺寸" },
  { key: "fabric", label: "织物" },
  { key: "ageGroup", label: "年龄段" },
  { key: "occasion", label: "穿着场合" },
  { key: "dressStyle", label: "裙子风格" },
  { key: "neckline", label: "领口" },
  { key: "dressLengthType", label: "裙子/连衣裙长度类型" },
  { key: "sleeveLengthType", label: "袖长类型" },
  { key: "targetGender", label: "目标性别" },
];

function getVisibleCategoryMetafieldKeys(
  current: Snapshot,
  proposed: Snapshot,
  fields: Set<TargetField>,
  targetCategoryMetafieldKeys: CategoryMetafieldKey[] = [],
) {
  const keys: CategoryMetafieldKey[] = [];
  if (fields.has("categorySize")) keys.push("size");
  if (fields.has("categoryMetafields")) {
    for (const key of targetCategoryMetafieldKeys) {
      if (
        key !== "size" &&
        CATEGORY_METAFIELD_LABELS.some((item) => item.key === key) &&
        !keys.includes(key)
      ) {
        keys.push(key);
      }
    }
    for (const { key } of CATEGORY_METAFIELD_LABELS) {
      const currentValue = getCategoryMetafieldValue(current, key);
      const proposedValue = getCategoryMetafieldValue(proposed, key);
      if (currentValue !== proposedValue && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function formatCategoryMetafields(
  snapshot: Snapshot,
  keys: CategoryMetafieldKey[],
) {
  const rows = keys.map((key) => {
    const label =
      CATEGORY_METAFIELD_LABELS.find((item) => item.key === key)?.label || key;
    return `${label}：${getCategoryMetafieldValue(snapshot, key) || "空"}`;
  });
  return rows.join("\n");
}

function getCategoryMetafieldValue(snapshot: Snapshot, key: CategoryMetafieldKey) {
  if (key === "size") {
    return String(snapshot.categorySize || snapshot.categoryMetafields?.size || "").trim();
  }
  return String(snapshot.categoryMetafields?.[key] || "").trim();
}

function SnapshotCompareHeader({
  title,
  tone,
}: {
  title: string;
  tone: "current" | "proposed";
}) {
  const highlight =
    tone === "proposed"
      ? "border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.08)]"
      : "border-border-subtle bg-bg-tertiary";
  const titleColor = tone === "proposed" ? "text-success" : "text-fg-secondary";

  return (
    <div className={`rounded-lg border p-3 text-sm font-semibold ${highlight} ${titleColor}`}>
      {title}
    </div>
  );
}

function snapshotToneClass(tone: "current" | "proposed") {
  return tone === "proposed"
    ? "border-[rgba(34,197,94,0.28)] bg-[rgba(34,197,94,0.045)]"
    : "border-[rgba(100,116,139,0.28)] bg-[rgba(148,163,184,0.09)]";
}

function SnapshotField({
  label,
  value,
  tone,
  tall = false,
}: {
  label: string;
  value: string;
  tone: "current" | "proposed";
  tall?: boolean;
}) {
  return (
    <div className={`h-full rounded-md border p-3 ${snapshotToneClass(tone)}`}>
      <div className="mb-1.5 text-xs font-semibold text-fg-secondary">{label}</div>
      <div
        className={`whitespace-pre-wrap text-xs leading-relaxed text-fg-secondary ${
          tall ? "max-h-48 overflow-y-auto" : ""
        }`}
      >
        {value || "空"}
      </div>
    </div>
  );
}

function SnapshotTagList({
  tags,
  tone,
}: {
  tags: string[];
  tone: "current" | "proposed";
}) {
  return (
    <div className={`h-full rounded-md border p-3 ${snapshotToneClass(tone)}`}>
      <div className="mb-2 text-xs font-semibold text-fg-secondary">标签</div>
      <div className="flex flex-wrap gap-1.5">
        {tags.length ? (
          tags.map((tag) => (
            <span key={tag} className="chip bg-bg-tertiary text-fg-secondary">
              {tag}
            </span>
          ))
        ) : (
          <span className="text-xs text-fg-tertiary">空</span>
        )}
      </div>
    </div>
  );
}


function SnapshotImageAltList({
  imageAltTexts,
  tone,
}: {
  imageAltTexts: ImageTextItem[];
  tone: "current" | "proposed";
}) {
  return (
    <div className={`h-full rounded-md border p-3 ${snapshotToneClass(tone)}`}>
      <div className="mb-2 text-xs font-semibold text-fg-secondary">图片</div>
      {imageAltTexts.length ? (
        <div className="max-h-48 space-y-2 overflow-y-auto">
          {imageAltTexts.map((item, index) => (
            <div
              key={`${item.mediaId || "image-alt"}-${index}`}
              className="text-xs leading-relaxed text-fg-secondary"
            >
              <div className="font-medium text-fg-primary">图片 {index + 1}</div>
              <div className="mt-1 grid gap-1">
                <div className="whitespace-pre-wrap">
                  <span className="font-medium text-fg-primary">名称：</span>
                  {item.filename || "空"}
                </div>
                <div className="whitespace-pre-wrap">
                  <span className="font-medium text-fg-primary">替换文本：</span>
                  {item.altText || "空"}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-xs text-fg-tertiary">空</span>
      )}
    </div>
  );
}

function SnapshotFaqList({
  faq,
  tone,
}: {
  faq: FaqItem[];
  tone: "current" | "proposed";
}) {
  return (
    <div className={`h-full rounded-md border p-3 ${snapshotToneClass(tone)}`}>
      <div className="mb-2 text-xs font-semibold text-fg-secondary">FAQ</div>
      {faq.length ? (
        <div className="space-y-2">
          {faq.map((item, index) => (
            <div key={`${item.question}-${index}`} className="text-xs text-fg-secondary">
              <div className="font-medium text-fg-primary">
                {index + 1}. Q: {item.question}
              </div>
              <div className="mt-0.5">A: {item.answer}</div>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-xs text-fg-tertiary">空</span>
      )}
    </div>
  );
}

function CompareField({
  label,
  current,
  proposed,
  multiline = false,
}: {
  label: string;
  current: string;
  proposed: string;
  multiline?: boolean;
}) {
  const changed = (current || "") !== (proposed || "");
  return (
    <div className="rounded-md bg-bg-tertiary p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-fg-secondary">{label}</span>
        {changed ? <span className="chip chip-brand">已变更</span> : null}
      </div>
      <div className={`grid grid-cols-1 gap-2 ${multiline ? "" : "md:grid-cols-2"}`}>
        <ValueBlock title="当前" value={current} />
        <ValueBlock title="建议" value={proposed} strong />
      </div>
    </div>
  );
}

function ValueBlock({
  title,
  value,
  strong = false,
}: {
  title: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-fg-tertiary">{title}</div>
      <div
        className={`min-h-[38px] whitespace-pre-wrap rounded border border-border-subtle bg-bg-secondary p-2 text-xs ${
          strong ? "font-medium text-fg-primary" : "text-fg-secondary"
        }`}
      >
        {value || "空"}
      </div>
    </div>
  );
}

function TextPanel({
  title,
  text,
  compact = false,
}: {
  title: string;
  text: string;
  compact?: boolean;
}) {
  return (
    <div className="rounded-md border border-[rgba(245,158,11,0.28)] bg-[rgba(245,158,11,0.08)] p-3">
      <div className="mb-2 text-xs font-semibold text-warn">{title}</div>
      <div
        className={`whitespace-pre-wrap text-xs leading-relaxed text-fg-secondary ${
          compact ? "" : "max-h-52 overflow-y-auto"
        }`}
      >
        {text || "空"}
      </div>
    </div>
  );
}

function TagPanel({ title, tags }: { title: string; tags: string[] }) {
  return (
    <div className="rounded-md bg-bg-tertiary p-3">
      <div className="mb-2 text-xs font-semibold text-fg-secondary">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {tags.length ? (
          tags.map((tag) => (
            <span key={tag} className="chip bg-bg-secondary text-fg-secondary">
              {tag}
            </span>
          ))
        ) : (
          <span className="text-xs text-fg-tertiary">空</span>
        )}
      </div>
    </div>
  );
}

function FaqPanel({ title, faq }: { title: string; faq: FaqItem[] }) {
  return (
    <div className="rounded-md bg-bg-tertiary p-3">
      <div className="mb-2 text-xs font-semibold text-fg-secondary">{title}</div>
      {faq.length ? (
        <div className="space-y-2">
          {faq.map((item, index) => (
            <div key={`${item.question}-${index}`} className="text-xs text-fg-secondary">
              <div className="font-medium text-fg-primary">Q: {item.question}</div>
              <div className="mt-0.5">A: {item.answer}</div>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-xs text-fg-tertiary">空</span>
      )}
    </div>
  );
}

function PreviewProgressCard({
  progress,
  generating,
}: {
  progress: PreviewProgress | null;
  generating: boolean;
}) {
  const percent = clampPercent(progress?.percent ?? 0);
  const throttle = progress?.shopifyThrottle || null;
  const retrySeconds = throttle
    ? Math.max(0, Math.ceil((throttle.retryAt - Date.now()) / 1000))
    : null;
  const message =
    progress?.phase === "waiting"
      ? "系统正在等待 Shopify API 可用后继续读取。"
      : progress?.message || "等待生成预览。";
  const phaseLabel = progress ? progressPhaseLabel(progress.phase) : "未开始";
  const isFailed = progress?.phase === "failed";
  const isDone =
    progress?.phase === "completed" ||
    progress?.phase === "finished" ||
    progress?.phase === "stopped";
  const quotaMayBeInsufficient =
    hasFiniteNumber(throttle?.requestedQueryCost) &&
    hasFiniteNumber(throttle?.currentlyAvailable) &&
    Number(throttle?.requestedQueryCost) > Number(throttle?.currentlyAvailable);

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
          {generating ? (
            <Loader2 size={16} className="animate-spin text-brand-400" />
          ) : isFailed ? (
            <AlertTriangle size={16} className="text-danger" />
          ) : isDone ? (
            <CheckCircle2 size={16} className="text-success" />
          ) : (
            <Sparkles size={16} className="text-brand-400" />
          )}
          此次任务进度
        </div>
        <span
          className={`text-lg font-semibold ${
            isFailed ? "text-danger" : "text-brand-400"
          }`}
        >
          {percent}%
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isFailed ? "bg-[var(--danger)]" : "bg-[var(--brand-400)]"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className="chip chip-brand">{phaseLabel}</span>
        <span className="text-fg-tertiary">
          {progress?.total ? `${progress.completed}/${progress.total}` : "0/0"}
        </span>
      </div>
      <div className="mt-2 text-xs leading-relaxed text-fg-secondary">
        {message}
      </div>
      {progress?.currentStore ? (
        <div className="mt-2 truncate text-[11px] text-fg-tertiary">
          店铺：{progress.currentStore}
        </div>
      ) : null}
      {progress?.currentProduct ? (
        <div className="mt-1 truncate text-[11px] text-fg-tertiary">
          商品：{progress.currentProduct}
        </div>
      ) : null}
      <div className="mt-4 space-y-2 border-t border-border-subtle pt-3 text-xs text-fg-secondary">
        <div className="flex items-center justify-between gap-3">
          <span>可用点数</span>
          <span className="font-semibold text-brand-400">
            {formatOptionalNumber(throttle?.currentlyAvailable)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>额度恢复</span>
          <span className="font-medium text-fg-primary">
            {formatQuotaRestoreRate(throttle?.restoreRate)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>额度恢复时间</span>
          <span className="font-semibold text-success">
            {formatQuotaRecoveryTime(retrySeconds)}
          </span>
        </div>
        {quotaMayBeInsufficient ? (
          <div className="rounded-md border border-amber-200 bg-[var(--warn-bg)] px-2.5 py-2 text-amber-700">
            当前 Shopify API 可用点数可能不足，系统会自动等待额度恢复后继续。
          </div>
        ) : null}
      </div>
    </div>
  );
}

async function readJson<T = unknown>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data as T;
}

function createLocalProgress(jobId: string, total: number): PreviewProgress {
  const now = Date.now();
  return {
    jobId,
    phase: "starting",
    percent: 0,
    completed: 0,
    total,
    message: "正在准备任务...",
    currentStore: null,
    currentProduct: null,
    done: false,
    cancelled: false,
    createdAt: now,
    updatedAt: now,
  };
}

function mergePreviewProgress(
  current: PreviewProgress | null,
  incoming: PreviewProgress,
): PreviewProgress {
  if (!current || incoming.total > 0) return incoming;
  if (incoming.phase !== "lost" && incoming.phase !== "finished") return incoming;
  const total = current.total || 0;
  return {
    ...incoming,
    total,
    completed: current.completed,
    percent: incoming.phase === "lost" ? current.percent : incoming.percent,
  };
}

function progressPhaseLabel(phase: PreviewProgress["phase"]) {
  const labels: Record<PreviewProgress["phase"], string> = {
    idle: "未开始",
    starting: "准备中",
    fetching: "读取商品",
    waiting: "读取商品",
    generating: "生成预览",
    stopping: "停止中",
    stopped: "已停止",
    completed: "已完成",
    failed: "出错",
    finished: "已结束",
    lost: "进度丢失",
  };
  return labels[phase] || "处理中";
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatOptionalNumber(value: number | undefined) {
  return Number.isFinite(value) ? String(value) : "--";
}

function hasFiniteNumber(value: number | undefined) {
  return Number.isFinite(value);
}

function formatQuotaRestoreRate(value: number | undefined) {
  return Number.isFinite(value) ? `${value}/秒` : "--";
}

function formatQuotaRecoveryTime(seconds: number | null) {
  if (seconds === null) return "--";
  return seconds > 0 ? `${seconds}秒` : "已恢复";
}

function parseShopifyCredentials(text: string) {
  const source = String(text || "").replace(/^\uFEFF/, "").trim();
  const values: Record<string, string> = {};
  if (source.startsWith("{")) {
    try {
      const json = JSON.parse(source) as Record<string, unknown>;
      for (const [key, value] of Object.entries(json || {})) {
        values[String(key).trim()] = String(value ?? "").trim();
      }
    } catch {
      // Fall back to line-based parsing.
    }
  }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const match = line.match(/^([A-Za-z0-9_]+)\s*(?:=|:)\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return {
    shopDomain: values.SHOPIFY_SHOP_DOMAIN || values.shopDomain || "",
    clientId: values.SHOPIFY_CLIENT_ID || values.clientId || "",
    clientSecret: values.SHOPIFY_CLIENT_SECRET || values.clientSecret || "",
  };
}

function toSummary(run: RunDocument): RunSummary {
  return {
    id: run.id,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    shopDomain: run.shopDomain,
    shopName: run.shopName,
    storeKeys: run.storeKeys || [],
    stores: run.stores || [],
    proposalStores: run.proposalStores || getRunProposalStores(run),
    start: run.start || 0,
    query: run.query,
    prompt: run.prompt,
    limit: run.limit,
    model: run.model,
    proposalCount: run.proposalCount,
    failureCount: run.failureCount,
    stopped: Boolean(run.stopped),
    stopReason: run.stopReason || null,
    lastApplyAt: run.lastApplyAt,
  };
}

function getRunProposalStores(run: Pick<RunDocument, "proposals">): RunStoreRef[] {
  const stores = new Map<string, RunStoreRef>();
  for (const proposal of run.proposals || []) {
    const key = proposal.store?.key || "";
    if (!key || stores.has(key)) continue;
    stores.set(key, {
      key,
      name: proposal.store?.name || null,
      shopDomain: proposal.store?.shopDomain || "",
    });
  }
  return Array.from(stores.values());
}

function isRunSubmitted(run: Pick<RunSummary, "lastApplyAt">) {
  return Boolean(run.lastApplyAt);
}

function proposalKey(proposal: Pick<Proposal, "store" | "product">) {
  return `${proposal.store.key}::${proposal.product.id}`;
}

function createPreviewJobId() {
  return `preview_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function storePickerLabel(selected: StoreSafe[], all: StoreSafe[]) {
  if (!all.length) return "请先添加店铺";
  if (selected.length === all.length) return `全部店铺（${selected.length}）`;
  if (selected.length === 1) return selected[0].name || selected[0].shopDomain;
  if (selected.length > 1) return `已选择 ${selected.length} 个店铺`;
  return "请选择店铺";
}

function runStoreLabel(run: Pick<RunSummary, "stores" | "shopName" | "shopDomain">) {
  const stores = runFilterStores(run);
  if (stores.length > 1) return `${stores.length} 个店铺`;
  if (stores.length === 1) return stores[0].name || stores[0].shopDomain;
  return run.shopName || run.shopDomain || "未知店铺";
}

function runFilterStores(run: Pick<RunSummary, "stores" | "proposalStores">) {
  return run.proposalStores?.length ? run.proposalStores : run.stores || [];
}

function runMatchesStoreFilter(
  run: Pick<RunSummary, "stores" | "proposalStores">,
  storeKey: string,
) {
  return storeKey === "__all__" || runFilterStores(run).some((store) => store.key === storeKey);
}

function buildRunDisplayLabels(runs: RunSummary[], storeKey: string) {
  const labels = new Map<string, string>();
  const counts = new Map<string, number>();
  const sortedRuns = [...runs].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  for (const run of sortedRuns) {
    const storeName = runDisplayStoreName(run, storeKey);
    const next = (counts.get(storeName) || 0) + 1;
    counts.set(storeName, next);
    labels.set(run.id, `${storeName}${next}`);
  }
  return labels;
}

function runDisplayStoreName(
  run: Pick<RunSummary, "stores" | "proposalStores" | "shopName" | "shopDomain">,
  storeKey: string,
) {
  const stores = runFilterStores(run);
  const matchedStore =
    storeKey !== "__all__" ? stores.find((store) => store.key === storeKey) : null;
  const store = matchedStore || stores[0];
  return store?.name || store?.shopDomain || run.shopName || run.shopDomain || "未知店铺";
}

function tokenCountdown(store: StoreSafe) {
  if (!store.tokenPresent) return "未授权";
  if (!store.tokenIssuedAt || !store.tokenExpiresAt) return "未知";
  if (store.tokenExpired) return "已过期";
  const h = Math.floor(store.tokenRemainingMs / 3600000);
  const m = Math.floor((store.tokenRemainingMs % 3600000) / 60000);
  return `${h}h${m}m`;
}

function formatTime(ts: number) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateInput(ts: number) {
  if (!ts) return "";
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isRunOnDate(ts: number | undefined, dateValue: string) {
  if (!dateValue) return true;
  if (!ts) return false;
  return formatDateInput(ts) === dateValue;
}

function htmlToText(value: string) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
