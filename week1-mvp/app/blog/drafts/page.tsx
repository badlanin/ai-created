"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  PencilLine,
  Plus,
  Search,
  Store,
  Trash2,
  UploadCloud,
  Loader2,
  X,
} from "lucide-react";
import { fetchWithShopifyDevice } from "@/lib/shopify-device-client";

type ShopifyConnection = {
  shopDomain: string;
  isActive?: boolean;
};

type ShopifyTxtCredentials = {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
};

type DraftRecord = {
  id: string;
  prompt: string;
  primaryKeyword: string;
  articleTitle: string;
  articleBodyHtml: string;
  summary: string;
  seoTitle: string;
  metaDescription: string;
  urlHandle: string;
  shopifyBlog: string;
  author: string;
  tags: string;
  coverFileName: string;
  publishStatus: "draft" | "published";
  savedAt: number;
  storage: "single" | "list";
};

const CONTROL_CLASS =
  "h-9 rounded-sm border border-border-default bg-bg-secondary px-3 text-[11px] text-fg-secondary outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-[rgba(99,102,241,0.12)]";

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDraft(
  value: unknown,
  index: number,
  storage: DraftRecord["storage"],
): DraftRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const savedAt =
    typeof record.savedAt === "number" && Number.isFinite(record.savedAt)
      ? record.savedAt
      : Date.now();

  return {
    id:
      storage === "single"
        ? "local-single-draft"
        : asString(record.id) || `local-draft-${savedAt}-${index}`,
    prompt: asString(record.prompt),
    primaryKeyword: asString(record.primaryKeyword),
    articleTitle: asString(record.articleTitle),
    articleBodyHtml: asString(record.articleBodyHtml),
    summary: asString(record.summary),
    seoTitle: asString(record.seoTitle),
    metaDescription: asString(record.metaDescription),
    urlHandle: asString(record.urlHandle),
    shopifyBlog: asString(record.shopifyBlog),
    author: asString(record.author),
    tags: asString(record.tags),
    coverFileName: asString(record.coverFileName),
    publishStatus:
      record.publishStatus === "published" ? "published" : "draft",
    savedAt,
    storage,
  };
}

function readLocalDrafts() {
  const listValue = window.localStorage.getItem("blog-article-drafts");
  if (listValue) {
    try {
      const parsed = JSON.parse(listValue) as unknown;
      if (Array.isArray(parsed)) {
        const drafts = parsed
          .map((item, index) => normalizeDraft(item, index, "list"))
          .filter((item): item is DraftRecord => Boolean(item));
        if (drafts.length) return drafts;
      }
    } catch {
      window.localStorage.removeItem("blog-article-drafts");
    }
  }

  const singleValue = window.localStorage.getItem("blog-article-draft");
  if (!singleValue) return [];

  try {
    const draft = normalizeDraft(JSON.parse(singleValue), 0, "single");
    return draft ? [draft] : [];
  } catch {
    window.localStorage.removeItem("blog-article-draft");
    return [];
  }
}

function readPublishedCount() {
  const value = window.localStorage.getItem("blog-published-articles");
  if (!value) return 0;
  try {
    const records = JSON.parse(value) as unknown;
    return Array.isArray(records) ? records.length : 0;
  } catch {
    window.localStorage.removeItem("blog-published-articles");
    return 0;
  }
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function generationComplete(draft: DraftRecord) {
  return Boolean(
    draft.articleTitle.trim() && stripHtml(draft.articleBodyHtml),
  );
}

function blogLabel(value: string) {
  if (value === "news") return "News";
  if (value === "blog") return "Blog";
  return value || "未选择";
}

export default function BlogDraftsPage() {
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [publishedCount, setPublishedCount] = useState(0);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [searchValue, setSearchValue] = useState("");
  const [blogFilter, setBlogFilter] = useState("all");
  const [generationFilter, setGenerationFilter] = useState("all");
  const [updatedFilter, setUpdatedFilter] = useState("all");
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [connectionLoaded, setConnectionLoaded] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [bindFileName, setBindFileName] = useState("");
  const [bindFileText, setBindFileText] = useState("");
  const [bindError, setBindError] = useState("");
  const [binding, setBinding] = useState(false);

  useEffect(() => {
    const localDrafts = readLocalDrafts().sort(
      (left, right) => right.savedAt - left.savedAt,
    );
    setDrafts(localDrafts);
    setPublishedCount(readPublishedCount());
    setSelectedDraftId(localDrafts[0]?.id || null);
  }, []);

  useEffect(() => {
    let alive = true;

    fetchWithShopifyDevice("/api/shopify/connection")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || response.statusText);
        if (!alive) return;
        const active = (data.connection || (data.bound ? data : null)) as
          | ShopifyConnection
          | null;
        setConnection(active?.shopDomain ? active : null);
      })
      .catch(() => {
        if (alive) setConnection(null);
      })
      .finally(() => {
        if (alive) setConnectionLoaded(true);
      });

    return () => {
      alive = false;
    };
  }, []);

  const blogOptions = useMemo(
    () =>
      Array.from(
        new Set(drafts.map((draft) => draft.shopifyBlog).filter(Boolean)),
      ),
    [drafts],
  );

  const filteredDrafts = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    const now = Date.now();

    return drafts.filter((draft) => {
      const searchText = [
        draft.articleTitle,
        draft.primaryKeyword,
        draft.prompt,
      ]
        .join(" ")
        .toLowerCase();
      const complete = generationComplete(draft);
      const age = now - draft.savedAt;

      return (
        (!query || searchText.includes(query)) &&
        (blogFilter === "all" || draft.shopifyBlog === blogFilter) &&
        (generationFilter === "all" ||
          (generationFilter === "completed" && complete) ||
          (generationFilter === "pending" && !complete)) &&
        (updatedFilter === "all" ||
          (updatedFilter === "7d" && age <= 7 * 24 * 60 * 60 * 1000) ||
          (updatedFilter === "30d" && age <= 30 * 24 * 60 * 60 * 1000))
      );
    });
  }, [blogFilter, drafts, generationFilter, searchValue, updatedFilter]);

  useEffect(() => {
    if (!filteredDrafts.length) {
      setSelectedDraftId(null);
    } else if (!filteredDrafts.some((draft) => draft.id === selectedDraftId)) {
      setSelectedDraftId(filteredDrafts[0].id);
    }
  }, [filteredDrafts, selectedDraftId]);

  const selectedDraft =
    filteredDrafts.find((draft) => draft.id === selectedDraftId) || null;
  const previewText = selectedDraft
    ? selectedDraft.summary.trim() || stripHtml(selectedDraft.articleBodyHtml)
    : "";
  const previewChecks = selectedDraft
    ? [
        { label: "标题", ready: Boolean(selectedDraft.articleTitle.trim()) },
        {
          label: "正文内容",
          ready: Boolean(stripHtml(selectedDraft.articleBodyHtml)),
        },
        { label: "摘要", ready: Boolean(selectedDraft.summary.trim()) },
        { label: "URL 名称", ready: Boolean(selectedDraft.urlHandle.trim()) },
        { label: "标签", ready: Boolean(selectedDraft.tags.trim()) },
        { label: "封面图片", ready: Boolean(selectedDraft.coverFileName) },
        { label: "作者", ready: Boolean(selectedDraft.author.trim()) },
      ]
    : [];
  const completion = previewChecks.length
    ? Math.round(
        (previewChecks.filter((item) => item.ready).length /
          previewChecks.length) *
          100,
      )
    : 0;
  const allVisibleChecked =
    filteredDrafts.length > 0 &&
    filteredDrafts.every((draft) => checkedIds.has(draft.id));

  function toggleChecked(id: string) {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setCheckedIds((current) => {
      const next = new Set(current);
      filteredDrafts.forEach((draft) => {
        if (allVisibleChecked) next.delete(draft.id);
        else next.add(draft.id);
      });
      return next;
    });
  }

  function deleteDraft(draft: DraftRecord) {
    if (!window.confirm("确定删除这篇本地草稿吗？")) return;

    if (draft.storage === "single") {
      window.localStorage.removeItem("blog-article-draft");
    } else {
      const remaining = drafts.filter((item) => item.id !== draft.id);
      window.localStorage.setItem(
        "blog-article-drafts",
        JSON.stringify(
          remaining.map((item) => ({ ...item, storage: undefined })),
        ),
      );
    }

    setDrafts((current) => current.filter((item) => item.id !== draft.id));
    setCheckedIds((current) => {
      const next = new Set(current);
      next.delete(draft.id);
      return next;
    });
    setPreviewExpanded(false);
  }

  async function handleBindFile(file: File | undefined) {
    setBindError("");
    setBindFileName(file?.name || "");
    setBindFileText(file ? await file.text() : "");
  }

  async function handleExchangeToken() {
    setBindError("");
    let credentials: ShopifyTxtCredentials;
    try {
      credentials = parseShopifyCredentials(bindFileText);
    } catch (error) {
      setBindError(error instanceof Error ? error.message : String(error));
      return;
    }

    setBinding(true);
    try {
      const tokenResponse = await fetchWithShopifyDevice("/api/shopify/client-credentials-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          useStored: false,
          shopDomain: credentials.shopDomain,
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
        }),
      });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenData.error || tokenResponse.statusText);

      const saveResponse = await fetchWithShopifyDevice("/api/shopify/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authMode: "access_token",
          shopDomain: credentials.shopDomain,
          accessToken: tokenData.accessToken,
          tokenExpiresAt: tokenData.tokenExpiresAt,
        }),
      });
      const saveData = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(saveData.error || saveResponse.statusText);

      const active = saveData.connection as ShopifyConnection | null;
      setConnection(active?.shopDomain ? active : { shopDomain: credentials.shopDomain, isActive: true });
      setBindOpen(false);
      setBindFileName("");
      setBindFileText("");
    } catch (error) {
      setBindError(error instanceof Error ? error.message : "兑换 Token 失败");
    } finally {
      setBinding(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] px-5 py-6 md:px-7 md:py-7">
      <header className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white"
            style={{
              background: "var(--brand-gradient)",
              boxShadow: "0 0 16px var(--brand-glow)",
            }}
          >
            <FileText size={18} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold text-fg-primary">博客文章</h1>
            <p className="mt-0.5 text-[13px] text-fg-tertiary">
              AI 生成文章 → 编辑审核 → 同步 Shopify
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setBindOpen(true)}
          className={`rounded-sm px-3 py-2 text-[11px] font-semibold ${
            connection
              ? "bg-[var(--success-bg)] text-[#047857]"
              : "bg-bg-tertiary text-fg-secondary hover:bg-[var(--brand-50-bg)] hover:text-brand-600"
          }`}
        >
          {connection
            ? connection.shopDomain
            : connectionLoaded
              ? "Shopify 未绑定"
              : "检测绑定中"}
        </button>
      </header>

      <nav
        aria-label="博客文章页面"
        className="mb-4 flex min-h-11 items-end gap-7 overflow-x-auto border-b border-border-default px-0.5"
      >
        <BlogTab href="/blog" label="新建文章" />
        <BlogTab
          href="/blog/drafts"
          label="草稿箱"
          count={drafts.length}
          active
        />
        <BlogTab
          href="/blog/published"
          label="已发布"
          count={publishedCount}
        />
      </nav>

      <section className="mb-4 flex flex-col gap-3 rounded-md border border-border-subtle bg-bg-secondary p-3 shadow-sm xl:flex-row xl:items-center">
        <label className="relative min-w-0 flex-1 xl:max-w-[360px]">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            className={`${CONTROL_CLASS} w-full pl-9`}
            placeholder="搜索文章标题、关键词"
          />
        </label>

        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3 xl:max-w-[620px]">
          <select
            value={blogFilter}
            onChange={(event) => setBlogFilter(event.target.value)}
            className={`${CONTROL_CLASS} w-full`}
            aria-label="发布博客筛选"
          >
            <option value="all">发布博客：全部</option>
            {blogOptions.map((blog) => (
              <option key={blog} value={blog}>
                {blogLabel(blog)}
              </option>
            ))}
          </select>
          <select
            value={generationFilter}
            onChange={(event) => setGenerationFilter(event.target.value)}
            className={`${CONTROL_CLASS} w-full`}
            aria-label="生成状态筛选"
          >
            <option value="all">生成状态：全部</option>
            <option value="completed">已生成</option>
            <option value="pending">待生成</option>
          </select>
          <select
            value={updatedFilter}
            onChange={(event) => setUpdatedFilter(event.target.value)}
            className={`${CONTROL_CLASS} w-full`}
            aria-label="更新时间筛选"
          >
            <option value="all">更新时间：全部</option>
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
          </select>
        </div>

        <Link
          href="/blog"
          className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-sm bg-brand-600 px-4 text-[11px] font-semibold text-white hover:bg-brand-500"
        >
          <Plus size={14} />
          新建文章
        </Link>
      </section>

      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex min-h-[700px] min-w-0 flex-col overflow-hidden rounded-md border border-border-subtle bg-bg-secondary shadow-sm">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead className="sticky top-0 z-[1] bg-[#fbfcfd]">
                <tr className="h-11 border-b border-border-subtle text-[10px] font-medium text-fg-tertiary">
                  <th className="w-12 px-4">
                    <input
                      type="checkbox"
                      checked={allVisibleChecked}
                      onChange={toggleAllVisible}
                      aria-label="选择全部草稿"
                      className="h-4 w-4 rounded border-border-strong accent-[var(--brand-500)]"
                    />
                  </th>
                  <th className="min-w-[270px] px-3">文章标题</th>
                  <th className="w-[120px] px-3">发布博客</th>
                  <th className="w-[110px] px-3">保存位置</th>
                  <th className="w-[100px] px-3">生成状态</th>
                  <th className="w-[150px] px-3">更新时间</th>
                  <th className="w-[100px] px-3">同步状态</th>
                </tr>
              </thead>
              <tbody>
                {filteredDrafts.map((draft) => {
                  const complete = generationComplete(draft);
                  const active = draft.id === selectedDraftId;
                  return (
                    <tr
                      key={draft.id}
                      className={`h-[68px] border-b border-border-subtle text-[10px] transition-colors last:border-b-0 ${
                        active
                          ? "bg-[var(--brand-50-bg)]"
                          : "hover:bg-bg-hover"
                      }`}
                    >
                      <td className="px-4">
                        <input
                          type="checkbox"
                          checked={checkedIds.has(draft.id)}
                          onChange={() => toggleChecked(draft.id)}
                          aria-label={`选择 ${draft.articleTitle || "未命名文章"}`}
                          className="h-4 w-4 rounded border-border-strong accent-[var(--brand-500)]"
                        />
                      </td>
                      <td className="px-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDraftId(draft.id);
                            setPreviewExpanded(false);
                          }}
                          className="block max-w-[360px] text-left text-[11px] font-medium leading-4 text-fg-primary hover:text-brand-600"
                        >
                          {draft.articleTitle.trim() || "未命名文章"}
                        </button>
                        <div className="mt-1 max-w-[360px] truncate text-[9px] text-fg-muted">
                          {draft.primaryKeyword || "未填写核心关键词"}
                        </div>
                      </td>
                      <td className="px-3 text-fg-secondary">
                        {blogLabel(draft.shopifyBlog)}
                      </td>
                      <td className="px-3 text-fg-secondary">本地草稿</td>
                      <td className="px-3">
                        <StatusChip tone={complete ? "success" : "warning"}>
                          {complete ? "已生成" : "待生成"}
                        </StatusChip>
                      </td>
                      <td className="px-3 text-fg-tertiary">
                        {formatDate(draft.savedAt)}
                      </td>
                      <td className="px-3">
                        <StatusChip tone="warning">未同步</StatusChip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!filteredDrafts.length ? (
              <div className="flex min-h-[520px] flex-col items-center justify-center px-6 text-center">
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-md bg-bg-tertiary text-fg-muted">
                  <FileText size={19} />
                </span>
                <h2 className="text-[13px] font-semibold text-fg-primary">
                  {drafts.length ? "没有符合条件的草稿" : "暂无本地草稿"}
                </h2>
                <p className="mt-1.5 text-[10px] text-fg-muted">
                  {drafts.length
                    ? "调整搜索词或筛选条件后再试"
                    : "在新建文章页面保存后，草稿会显示在这里"}
                </p>
                {!drafts.length ? (
                  <Link
                    href="/blog"
                    className="mt-4 flex h-9 items-center justify-center gap-1.5 rounded-sm border border-brand-200 bg-[var(--brand-50-bg)] px-4 text-[10px] font-semibold text-brand-600 hover:bg-bg-hover"
                  >
                    <Plus size={13} />
                    新建文章
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>

          <footer className="flex min-h-[52px] shrink-0 items-center justify-between gap-3 border-t border-border-subtle px-4 text-[10px] text-fg-muted">
            <span>共 {filteredDrafts.length} 条</span>
            <div className="flex items-center gap-2">
              <PageButton label="上一页">
                <ChevronLeft size={13} />
              </PageButton>
              <span className="flex h-8 min-w-8 items-center justify-center rounded-sm border border-brand-200 bg-[var(--brand-50-bg)] px-2 font-semibold text-brand-600">
                1
              </span>
              <PageButton label="下一页">
                <ChevronRight size={13} />
              </PageButton>
              <span className="ml-1 flex h-8 items-center rounded-sm border border-border-default bg-white px-3">
                20 条/页
              </span>
            </div>
          </footer>
        </section>

        <aside className="flex min-h-[700px] flex-col overflow-hidden rounded-md border border-border-subtle bg-bg-secondary shadow-sm">
          <div className="flex min-h-[50px] shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-fg-primary">
              <PencilLine size={16} className="text-brand-400" />
              草稿预览
            </div>
            {selectedDraft ? (
              <span className="text-[9px] text-fg-muted">本地保存</span>
            ) : null}
          </div>

          {selectedDraft ? (
            <div className="flex flex-1 flex-col p-4">
              <h2 className="text-[14px] font-semibold leading-5 text-fg-primary">
                {selectedDraft.articleTitle.trim() || "未命名文章"}
              </h2>

              <div className="mt-4 border-b border-border-subtle pb-4">
                <div className="mb-1.5 text-[10px] font-semibold text-fg-secondary">
                  摘要
                </div>
                <p
                  className={`text-[10px] leading-5 text-fg-tertiary ${
                    previewExpanded ? "" : "line-clamp-5"
                  }`}
                >
                  {previewText || "暂无摘要"}
                </p>
                {previewText.length > 150 ? (
                  <button
                    type="button"
                    onClick={() => setPreviewExpanded((current) => !current)}
                    className="mt-2 text-[10px] font-medium text-brand-600 hover:text-brand-500"
                  >
                    {previewExpanded ? "收起内容" : "查看全部"}
                  </button>
                ) : null}
              </div>

              <div className="border-b border-border-subtle py-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold text-fg-secondary">
                    SEO 完成度
                  </span>
                  <span className="text-[11px] font-semibold text-brand-600">
                    {completion}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                  <span
                    className="block h-full rounded-full bg-grad-brand transition-[width]"
                    style={{ width: `${completion}%` }}
                  />
                </div>
              </div>

              <div className="py-3">
                {previewChecks.map((item) => (
                  <div
                    key={item.label}
                    className="flex min-h-9 items-center gap-2 border-b border-border-subtle py-1.5 text-[10px] last:border-b-0"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                        item.ready
                          ? "bg-[var(--success-bg)] text-[#059669]"
                          : "bg-bg-tertiary text-fg-muted"
                      }`}
                    >
                      {item.ready ? (
                        <Check size={10} strokeWidth={2.5} />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 text-fg-secondary">
                      {item.label}
                    </span>
                    <span className="text-[9px] text-fg-muted">
                      {item.ready ? "已填写" : "待填写"}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 rounded-sm bg-[var(--warn-bg)] p-2.5 text-[10px] leading-4 text-[#b45309]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  页面标题与元描述作为本地 SEO 建议保存，不通过 Article API
                  直接同步。
                </span>
              </div>

              <div className="mt-auto space-y-2 pt-4">
                <Link
                  href={`/blog?draft=${encodeURIComponent(selectedDraft.id)}`}
                  onClick={() =>
                    window.localStorage.setItem(
                      "blog-article-draft",
                      JSON.stringify({ ...selectedDraft, storage: undefined }),
                    )
                  }
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-sm border border-brand-200 bg-[var(--brand-50-bg)] text-[10px] font-semibold text-brand-600 hover:bg-bg-hover"
                >
                  <PencilLine size={13} />
                  继续编辑
                </Link>
                <button
                  type="button"
                  disabled={!connection}
                  title={
                    connection
                      ? "同步为 Shopify 草稿"
                      : "请先绑定 Shopify 店铺"
                  }
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-sm bg-brand-600 text-[10px] font-semibold text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <UploadCloud size={13} />
                  同步为 Shopify 草稿
                </button>
                <button
                  type="button"
                  onClick={() => deleteDraft(selectedDraft)}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-sm border border-[rgba(239,68,68,0.3)] bg-white text-[10px] font-semibold text-danger hover:bg-[rgba(239,68,68,0.05)]"
                >
                  <Trash2 size={13} />
                  删除草稿
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-md bg-bg-tertiary text-fg-muted">
                <FileText size={19} />
              </span>
              <div className="text-[12px] font-semibold text-fg-primary">
                暂无草稿预览
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-fg-muted">
                保存文章草稿后，可在这里查看完整度和同步状态
              </p>
            </div>
          )}
        </aside>
      </div>
      {bindOpen ? (
        <ShopifyBindModal
          fileName={bindFileName}
          error={bindError}
          binding={binding}
          canSubmit={Boolean(bindFileText)}
          onFileChange={handleBindFile}
          onClose={() => {
            if (!binding) setBindOpen(false);
          }}
          onSubmit={handleExchangeToken}
        />
      ) : null}
    </main>
  );
}

function parseShopifyCredentials(text: string): ShopifyTxtCredentials {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^[\'"]|[\'"]$/g, "");
    values[key] = value;
  }
  const credentials = {
    shopDomain: values.SHOPIFY_SHOP_DOMAIN || values.shopDomain || "",
    clientId: values.SHOPIFY_CLIENT_ID || values.clientId || "",
    clientSecret: values.SHOPIFY_CLIENT_SECRET || values.clientSecret || "",
  };
  if (!credentials.shopDomain || !credentials.clientId || !credentials.clientSecret) {
    throw new Error("TXT 文件必须包含 SHOPIFY_SHOP_DOMAIN、SHOPIFY_CLIENT_ID、SHOPIFY_CLIENT_SECRET。");
  }
  return credentials;
}

function ShopifyBindModal({
  fileName,
  error,
  binding,
  canSubmit,
  onFileChange,
  onClose,
  onSubmit,
}: {
  fileName: string;
  error: string;
  binding: boolean;
  canSubmit: boolean;
  onFileChange: (file: File | undefined) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-[520px] rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-bold text-fg-primary">添加 Shopify 店铺</h2>
            <p className="mt-1 text-[12px] text-fg-muted">
              凭据只发送到本机服务，页面不会显示文件中的密钥。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={binding}
            className="rounded-sm p-1 text-fg-muted hover:bg-bg-tertiary"
          >
            <X size={18} />
          </button>
        </div>
        <label className="mb-4 block rounded-md border border-dashed border-brand-300 bg-[var(--brand-50-bg)] p-4">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-fg-primary">
            <UploadCloud size={16} className="text-brand-500" />
            上传店铺凭据 TXT 文件
          </div>
          <input
            type="file"
            accept=".txt,text/plain"
            disabled={binding}
            onChange={(event) => void onFileChange(event.target.files?.[0])}
            className="w-full rounded-sm bg-white text-[12px] text-fg-secondary file:mr-3 file:rounded-sm file:border file:border-border-subtle file:bg-bg-secondary file:px-3 file:py-1.5 file:text-[12px]"
          />
          {fileName ? <p className="mt-2 text-[10px] text-fg-muted">已选择：{fileName}</p> : null}
        </label>
        <div className="mb-4 rounded-md bg-bg-tertiary p-4">
          <div className="mb-2 text-[12px] font-semibold text-fg-secondary">TXT 文件内容格式</div>
          <pre className="rounded-sm bg-white p-3 text-[11px] leading-5 text-fg-secondary">{`SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com\nSHOPIFY_CLIENT_ID=...\nSHOPIFY_CLIENT_SECRET=...`}</pre>
          <p className="mt-2 text-[11px] text-fg-muted">
            Token 会保存到博客文章模块共用的 Shopify 绑定中。
          </p>
        </div>
        {error ? (
          <div className="mb-4 rounded-sm border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] text-[#dc2626]">
            {error}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={binding}
            className="h-9 rounded-sm border border-border-subtle bg-white px-5 text-[12px] text-fg-secondary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit || binding}
            className="flex h-9 items-center gap-2 rounded-sm bg-grad-brand px-5 text-[12px] font-semibold text-white disabled:opacity-45"
          >
            {binding ? <Loader2 size={14} className="animate-spin" /> : null}
            {binding ? "兑换中..." : "兑换 Token"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BlogTab({
  label,
  href,
  count = null,
  active = false,
}: {
  label: string;
  href?: string;
  count?: number | null;
  active?: boolean;
}) {
  const className = `relative flex h-11 shrink-0 items-center gap-2 px-0.5 text-[12px] transition-colors ${
    active
      ? "font-semibold text-brand-600"
      : "text-fg-tertiary hover:text-fg-primary"
  }`;
  const content = (
    <>
      {label}
      {count !== null ? (
        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bg-tertiary px-1 text-[9px] text-fg-tertiary">
          {count}
        </span>
      ) : null}
      {active ? (
        <span className="absolute inset-x-0 bottom-[-1px] h-0.5 rounded-full bg-brand-400" />
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={className}
      >
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={className}>
      {content}
    </button>
  );
}

function StatusChip({
  tone,
  children,
}: {
  tone: "success" | "warning";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[9px] font-medium ${
        tone === "success"
          ? "bg-[var(--success-bg)] text-[#059669]"
          : "bg-[var(--warn-bg)] text-[#b45309]"
      }`}
    >
      {tone === "success" ? (
        <CheckCircle2 size={10} />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}

function PageButton({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-sm border border-border-default bg-white disabled:opacity-40"
    >
      {children}
    </button>
  );
}
