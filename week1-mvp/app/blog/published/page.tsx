"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Link2,
  RefreshCw,
  Search,
  Store,
  Loader2,
  UploadCloud,
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

type SyncStatus = "synced" | "pending" | "failed";

type PublishedRecord = {
  id: string;
  articleTitle: string;
  articleBodyHtml: string;
  summary: string;
  shopifyBlog: string;
  urlHandle: string;
  publicUrl: string;
  shopifyArticleId: string;
  coverImageUrl: string;
  publishedAt: number;
  lastSyncedAt: number;
  syncStatus: SyncStatus;
};

const CONTROL_CLASS =
  "h-9 rounded-sm border border-border-default bg-bg-secondary px-3 text-[11px] text-fg-secondary outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-[rgba(99,102,241,0.12)]";

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asTimestamp(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return fallback;
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePublished(
  value: unknown,
  index: number,
): PublishedRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const now = Date.now();
  const rawStatus = asString(record.syncStatus || record.status);
  const syncStatus: SyncStatus =
    rawStatus === "failed"
      ? "failed"
      : rawStatus === "pending"
        ? "pending"
        : "synced";
  const publishedAt = asTimestamp(
    record.publishedAt || record.publishDate,
    now,
  );

  return {
    id:
      asString(record.id || record.shopifyArticleId || record.articleId) ||
      `published-${publishedAt}-${index}`,
    articleTitle: asString(record.articleTitle || record.title),
    articleBodyHtml: asString(record.articleBodyHtml || record.bodyHtml),
    summary: asString(record.summary),
    shopifyBlog: asString(record.shopifyBlog || record.blogTitle),
    urlHandle: asString(record.urlHandle || record.handle),
    publicUrl: asString(record.publicUrl || record.onlineStoreUrl),
    shopifyArticleId: asString(
      record.shopifyArticleId || record.articleId || record.id,
    ),
    coverImageUrl: asString(record.coverImageUrl || record.imageUrl),
    publishedAt,
    lastSyncedAt: asTimestamp(
      record.lastSyncedAt || record.syncedAt,
      publishedAt,
    ),
    syncStatus,
  };
}

function readPublishedArticles() {
  const listValue = window.localStorage.getItem("blog-published-articles");
  if (listValue) {
    try {
      const parsed = JSON.parse(listValue) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item, index) => normalizePublished(item, index))
          .filter((item): item is PublishedRecord => Boolean(item));
      }
    } catch {
      window.localStorage.removeItem("blog-published-articles");
    }
  }

  const singleValue = window.localStorage.getItem("blog-published-article");
  if (!singleValue) return [];
  try {
    const article = normalizePublished(JSON.parse(singleValue), 0);
    return article ? [article] : [];
  } catch {
    window.localStorage.removeItem("blog-published-article");
    return [];
  }
}

function readDraftCount() {
  const listValue = window.localStorage.getItem("blog-article-drafts");
  if (listValue) {
    try {
      const parsed = JSON.parse(listValue) as unknown;
      if (Array.isArray(parsed) && parsed.length) return parsed.length;
    } catch {
      window.localStorage.removeItem("blog-article-drafts");
    }
  }
  return window.localStorage.getItem("blog-article-draft") ? 1 : 0;
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

function blogLabel(value: string) {
  if (value === "news") return "News";
  if (value === "blog") return "Blog";
  return value || "未记录";
}

export default function BlogPublishedPage() {
  const [articles, setArticles] = useState<PublishedRecord[]>([]);
  const [draftCount, setDraftCount] = useState(0);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(
    null,
  );
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [searchValue, setSearchValue] = useState("");
  const [blogFilter, setBlogFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [syncFilter, setSyncFilter] = useState("all");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [connectionLoaded, setConnectionLoaded] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [bindFileName, setBindFileName] = useState("");
  const [bindFileText, setBindFileText] = useState("");
  const [bindError, setBindError] = useState("");
  const [binding, setBinding] = useState(false);

  useEffect(() => {
    const localArticles = readPublishedArticles().sort(
      (left, right) => right.publishedAt - left.publishedAt,
    );
    setArticles(localArticles);
    setDraftCount(readDraftCount());
    setSelectedArticleId(localArticles[0]?.id || null);
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
        new Set(articles.map((article) => article.shopifyBlog).filter(Boolean)),
      ),
    [articles],
  );

  const filteredArticles = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    const now = Date.now();
    const matched = articles.filter((article) => {
      const searchText = [article.articleTitle, article.urlHandle]
        .join(" ")
        .toLowerCase();
      const age = now - article.publishedAt;

      return (
        (!query || searchText.includes(query)) &&
        (blogFilter === "all" || article.shopifyBlog === blogFilter) &&
        (syncFilter === "all" || article.syncStatus === syncFilter) &&
        (dateFilter === "all" ||
          (dateFilter === "7d" && age <= 7 * 24 * 60 * 60 * 1000) ||
          (dateFilter === "30d" && age <= 30 * 24 * 60 * 60 * 1000))
      );
    });

    return matched.sort((left, right) =>
      sortDirection === "desc"
        ? right.publishedAt - left.publishedAt
        : left.publishedAt - right.publishedAt,
    );
  }, [articles, blogFilter, dateFilter, searchValue, sortDirection, syncFilter]);

  useEffect(() => {
    if (!filteredArticles.length) {
      setSelectedArticleId(null);
    } else if (
      !filteredArticles.some((article) => article.id === selectedArticleId)
    ) {
      setSelectedArticleId(filteredArticles[0].id);
    }
  }, [filteredArticles, selectedArticleId]);

  const selectedArticle =
    filteredArticles.find((article) => article.id === selectedArticleId) ||
    null;
  const allVisibleChecked =
    filteredArticles.length > 0 &&
    filteredArticles.every((article) => checkedIds.has(article.id));

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
      filteredArticles.forEach((article) => {
        if (allVisibleChecked) next.delete(article.id);
        else next.add(article.id);
      });
      return next;
    });
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


      <section className="mb-4 flex flex-col gap-3 rounded-md border border-border-subtle bg-bg-secondary p-3 shadow-sm xl:flex-row xl:items-center">
        <label className="relative min-w-0 flex-1 xl:max-w-[380px]">
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

        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3 xl:max-w-[650px]">
          <select
            value={blogFilter}
            onChange={(event) => setBlogFilter(event.target.value)}
            className={`${CONTROL_CLASS} w-full`}
            aria-label="Shopify 博客筛选"
          >
            <option value="all">Shopify 博客：全部</option>
            {blogOptions.map((blog) => (
              <option key={blog} value={blog}>
                {blogLabel(blog)}
              </option>
            ))}
          </select>
          <select
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
            className={`${CONTROL_CLASS} w-full`}
            aria-label="发布日期筛选"
          >
            <option value="all">发布日期：全部</option>
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
          </select>
          <select
            value={syncFilter}
            onChange={(event) => setSyncFilter(event.target.value)}
            className={`${CONTROL_CLASS} w-full`}
            aria-label="同步状态筛选"
          >
            <option value="all">同步状态：全部</option>
            <option value="synced">已同步</option>
            <option value="pending">待同步</option>
            <option value="failed">同步失败</option>
          </select>
        </div>
      </section>

      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex min-h-[700px] min-w-0 flex-col overflow-hidden rounded-md border border-border-subtle bg-bg-secondary shadow-sm">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[940px] border-collapse text-left">
              <thead className="sticky top-0 z-[1] bg-[#fbfcfd]">
                <tr className="h-11 border-b border-border-subtle text-[10px] font-medium text-fg-tertiary">
                  <th className="w-12 px-4">
                    <input
                      type="checkbox"
                      checked={allVisibleChecked}
                      onChange={toggleAllVisible}
                      aria-label="选择全部文章"
                      className="h-4 w-4 rounded border-border-strong accent-[var(--brand-500)]"
                    />
                  </th>
                  <th className="min-w-[280px] px-3">文章标题</th>
                  <th className="w-[110px] px-3">博客</th>
                  <th className="w-[160px] px-3">URL 名称</th>
                  <th className="w-[150px] px-3">
                    <button
                      type="button"
                      onClick={() =>
                        setSortDirection((current) =>
                          current === "desc" ? "asc" : "desc",
                        )
                      }
                      className="flex items-center gap-1 hover:text-fg-primary"
                    >
                      发布时间
                      <ArrowUpDown size={11} />
                    </button>
                  </th>
                  <th className="w-[150px] px-3">最后同步</th>
                  <th className="w-[90px] px-3">状态</th>
                </tr>
              </thead>
              <tbody>
                {filteredArticles.map((article) => {
                  const active = article.id === selectedArticleId;
                  return (
                    <tr
                      key={article.id}
                      className={`h-[68px] border-b border-border-subtle text-[10px] transition-colors last:border-b-0 ${
                        active
                          ? "bg-[var(--brand-50-bg)]"
                          : "hover:bg-bg-hover"
                      }`}
                    >
                      <td className="px-4">
                        <input
                          type="checkbox"
                          checked={checkedIds.has(article.id)}
                          onChange={() => toggleChecked(article.id)}
                          aria-label={`选择 ${article.articleTitle || "未命名文章"}`}
                          className="h-4 w-4 rounded border-border-strong accent-[var(--brand-500)]"
                        />
                      </td>
                      <td className="px-3">
                        <button
                          type="button"
                          onClick={() => setSelectedArticleId(article.id)}
                          className="block max-w-[380px] text-left text-[11px] font-medium leading-4 text-fg-primary hover:text-brand-600"
                        >
                          {article.articleTitle.trim() || "未命名文章"}
                        </button>
                      </td>
                      <td className="px-3 text-fg-secondary">
                        {blogLabel(article.shopifyBlog)}
                      </td>
                      <td className="px-3">
                        <span
                          className="block max-w-[150px] truncate text-fg-secondary"
                          title={article.urlHandle}
                        >
                          {article.urlHandle || "未记录"}
                        </span>
                      </td>
                      <td className="px-3 text-fg-tertiary">
                        {formatDate(article.publishedAt)}
                      </td>
                      <td className="px-3 text-fg-tertiary">
                        {formatDate(article.lastSyncedAt)}
                      </td>
                      <td className="px-3">
                        <SyncStatusChip status={article.syncStatus} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!filteredArticles.length ? (
              <div className="flex min-h-[520px] flex-col items-center justify-center px-6 text-center">
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-md bg-bg-tertiary text-fg-muted">
                  <FileText size={19} />
                </span>
                <h2 className="text-[13px] font-semibold text-fg-primary">
                  {articles.length ? "没有符合条件的文章" : "暂无已发布文章"}
                </h2>
                <p className="mt-1.5 text-[10px] text-fg-muted">
                  {articles.length
                    ? "调整搜索词或筛选条件后再试"
                    : "文章成功发布到 Shopify 后会显示在这里"}
                </p>
                {!articles.length ? (
                  <Link
                    href="/blog"
                    className="mt-4 flex h-9 items-center justify-center rounded-sm border border-brand-200 bg-[var(--brand-50-bg)] px-4 text-[10px] font-semibold text-brand-600 hover:bg-bg-hover"
                  >
                    新建文章
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>

          <footer className="flex min-h-[52px] shrink-0 items-center justify-between gap-3 border-t border-border-subtle px-4 text-[10px] text-fg-muted">
            <span>共 {filteredArticles.length} 条</span>
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
          <div className="flex min-h-[50px] shrink-0 items-center gap-2 border-b border-border-subtle px-4 text-[13px] font-semibold text-fg-primary">
            <Store size={16} className="text-brand-400" />
            线上文章
          </div>

          {selectedArticle ? (
            <div className="flex flex-1 flex-col p-4">
              <h2 className="text-[14px] font-semibold leading-5 text-fg-primary">
                {selectedArticle.articleTitle.trim() || "未命名文章"}
              </h2>

              <div className="mt-4 space-y-3 border-b border-border-subtle pb-4">
                <DetailRow label="公开 URL">
                  {selectedArticle.publicUrl ? (
                    <a
                      href={selectedArticle.publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block break-all text-[10px] leading-4 text-brand-600 hover:text-brand-500"
                    >
                      {selectedArticle.publicUrl}
                    </a>
                  ) : (
                    <span className="text-[10px] text-fg-muted">未记录</span>
                  )}
                </DetailRow>
                <DetailRow label="Shopify Article ID">
                  <span className="block break-all text-[10px] leading-4 text-fg-secondary">
                    {selectedArticle.shopifyArticleId || "未记录"}
                  </span>
                </DetailRow>
                <DetailRow label="发布时间">
                  <span className="text-[10px] text-fg-secondary">
                    {formatDate(selectedArticle.publishedAt)}
                  </span>
                </DetailRow>
                <DetailRow label="最后同步">
                  <span className="text-[10px] text-fg-secondary">
                    {formatDate(selectedArticle.lastSyncedAt)}
                  </span>
                </DetailRow>
              </div>

              <div className="py-4">
                <div className="mb-2 text-[10px] font-semibold text-fg-secondary">
                  在线预览
                </div>
                <div className="mx-auto max-w-[245px] overflow-hidden rounded-sm border border-border-default bg-white shadow-sm">
                  <div className="flex h-6 items-center gap-1 border-b border-border-subtle bg-[#f7f8fa] px-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#ef4444]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-[#f59e0b]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />
                  </div>
                  {selectedArticle.coverImageUrl ? (
                    <div className="aspect-[16/9] overflow-hidden bg-bg-tertiary">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selectedArticle.coverImageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : null}
                  <div className="min-h-[155px] p-3">
                    <div className="text-[11px] font-semibold leading-4 text-fg-primary">
                      {selectedArticle.articleTitle || "未命名文章"}
                    </div>
                    <p className="mt-2 line-clamp-5 text-[9px] leading-4 text-fg-tertiary">
                      {selectedArticle.summary ||
                        stripHtml(selectedArticle.articleBodyHtml) ||
                        "暂无文章摘要"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
                {selectedArticle.publicUrl ? (
                  <a
                    href={selectedArticle.publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-9 items-center justify-center gap-1.5 rounded-sm border border-border-default bg-white text-[10px] font-semibold text-fg-secondary hover:bg-bg-hover"
                  >
                    <ExternalLink size={13} />
                    查看文章
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="flex h-9 items-center justify-center gap-1.5 rounded-sm border border-border-default bg-white text-[10px] font-semibold text-fg-secondary opacity-45"
                  >
                    <Link2 size={13} />
                    查看文章
                  </button>
                )}
                <button
                  type="button"
                  disabled={!connection}
                  title={
                    connection ? "更新 Shopify 同步" : "请先绑定 Shopify 店铺"
                  }
                  className="flex h-9 items-center justify-center gap-1.5 rounded-sm bg-brand-600 text-[10px] font-semibold text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <RefreshCw size={13} />
                  更新同步
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-md bg-bg-tertiary text-fg-muted">
                <Store size={19} />
              </span>
              <div className="text-[12px] font-semibold text-fg-primary">
                暂无线上的文章
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-fg-muted">
                发布记录同步后，可在这里查看线上地址和同步信息
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

  return href ? (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={className}
    >
      {content}
    </Link>
  ) : (
    <button type="button" className={className}>
      {content}
    </button>
  );
}

function SyncStatusChip({ status }: { status: SyncStatus }) {
  const styles = {
    synced: "bg-[var(--success-bg)] text-[#059669]",
    pending: "bg-[var(--warn-bg)] text-[#b45309]",
    failed: "bg-[rgba(239,68,68,0.08)] text-danger",
  };
  const labels = {
    synced: "已同步",
    pending: "待同步",
    failed: "失败",
  };

  return (
    <span
      className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[9px] font-medium ${styles[status]}`}
    >
      {status === "synced" ? (
        <CheckCircle2 size={10} />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {labels[status]}
    </span>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[9px] text-fg-muted">{label}</div>
      {children}
    </div>
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
