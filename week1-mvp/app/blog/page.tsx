"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, FileText, Image as ImageIcon, Loader2, Save, Store, Upload, UploadCloud, WandSparkles, X } from "lucide-react";
import { fetchWithShopifyDevice } from "@/lib/shopify-device-client";

type ModuleKey = "quickAnswer" | "toc" | "trendTable" | "recommendations" | "sources" | "faq" | "cta" | "relatedArticles";
type OutputLanguage = "english" | "bilingual" | "chinese";
type PublishStatus = "draft" | "published";
type ShopifyConnection = { shopDomain: string; isActive?: boolean };
type ShopifyTxtCredentials = { shopDomain: string; clientId: string; clientSecret: string };
type BlogSyncArticle = { id: string; title: string; handle: string; blogTitle: string; blogHandle: string; publicUrl: string };
type ShopifyBlogOption = { id: string; title: string; handle: string };
type BlogGeneratedDraft = { title: string; bodyHtml: string; summary: string; seoTitle: string; metaDescription: string; urlHandle: string; tags: string };

const CONTROL_CLASS = "w-full rounded-sm border border-border-default bg-bg-secondary px-3 text-[12px] text-fg-primary outline-none transition-colors placeholder:text-fg-muted focus:border-brand-400 focus:ring-2 focus:ring-[rgba(99,102,241,0.12)]";
const MARKDOWN_SOURCE_MAX_CHARS = 60_000;


export default function BlogPage() {
  const [prompt, setPrompt] = useState("");
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [searchIntent, setSearchIntent] = useState("");
  const [modules, setModules] = useState<Record<ModuleKey, boolean>>({ quickAnswer: false, toc: false, trendTable: false, recommendations: false, sources: false, faq: false, cta: false, relatedArticles: false });
  const [language, setLanguage] = useState<OutputLanguage>("english");
  const [articleTitle, setArticleTitle] = useState("");
  const [articleBodyHtml, setArticleBodyHtml] = useState("");
  const [summary, setSummary] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [urlHandle, setUrlHandle] = useState("");
  const [shopifyBlog, setShopifyBlog] = useState("");
  const [author, setAuthor] = useState("");
  const [tags, setTags] = useState("");
  const [coverFileName, setCoverFileName] = useState("");
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("draft");
  const [generating, setGenerating] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [connectionLoaded, setConnectionLoaded] = useState(false);
  const [shopifyBlogs, setShopifyBlogs] = useState<ShopifyBlogOption[]>([]);
  const [shopifyBlogsLoaded, setShopifyBlogsLoaded] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [bindFileName, setBindFileName] = useState("");
  const [bindFileText, setBindFileText] = useState("");
  const [bindError, setBindError] = useState("");
  const [bindCredentials, setBindCredentials] = useState<ShopifyTxtCredentials | null>(null);
  const [binding, setBinding] = useState(false);
  const [clearingBinding, setClearingBinding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [shopifyArticleId, setShopifyArticleId] = useState("");
  const [markdownFileName, setMarkdownFileName] = useState("");
  const [markdownSource, setMarkdownSource] = useState("");
  const [markdownError, setMarkdownError] = useState("");
  const [generatedDraft, setGeneratedDraft] = useState<BlogGeneratedDraft | null>(null);

  const contentStats = useMemo(() => {
    const text = articleBodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return { words: text ? text.split(" ").filter(Boolean).length : 0, sections: (articleBodyHtml.match(/<h[1-6]\b/gi) || []).length, faqs: (articleBodyHtml.match(/faq|常见问题/gi) || []).length };
  }, [articleBodyHtml]);


  useEffect(() => { void loadShopifyConnection(); }, []);

  useEffect(() => {
    if (!connection?.shopDomain) {
      setShopifyBlogs([]);
      setShopifyBlogsLoaded(false);
      return;
    }
    void loadShopifyBlogs(connection.shopDomain);
  }, [connection?.shopDomain]);

  async function loadShopifyConnection() {
    try {
      const response = await fetchWithShopifyDevice("/api/shopify/connection");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || response.statusText);
      const active = (data.connection || (data.bound ? data : null)) as ShopifyConnection | null;
      setConnection(active?.shopDomain ? active : null);
    } catch {
      setConnection(null);
    } finally {
      setConnectionLoaded(true);
    }
  }

  function handleOptimizePrompt() { if (!prompt.trim()) return; setPrompt(`${prompt.trim()}\n\n输出要求：围绕搜索意图组织 H2/H3 结构，内容具体可信，包含实用建议，并自然关联可选商品。`); }

  async function loadShopifyBlogs(shopDomain: string) {
    setShopifyBlogsLoaded(false);
    try {
      const response = await fetchWithShopifyDevice(`/api/blog/blogs?shopDomain=${encodeURIComponent(shopDomain)}`);
      const data = (await response.json()) as { blogs?: ShopifyBlogOption[]; error?: string };
      if (!response.ok) throw new Error(data.error || response.statusText);
      const blogs = Array.isArray(data.blogs) ? data.blogs : [];
      setShopifyBlogs(blogs);
      setShopifyBlog((current) => {
        if (!blogs.length) return current;
        if (current && blogs.some((blog) => blog.id === current || blog.handle === current || blog.title === current)) return current;
        return blogs.length === 1 ? blogs[0].id : current;
      });
    } catch {
      setShopifyBlogs([]);
    } finally {
      setShopifyBlogsLoaded(true);
    }
  }
  async function handleGenerate() {
    if ((!prompt.trim() && !markdownSource.trim()) || generating) return;
    setGenerating(true);
    try {
      const response = await fetch("/api/blog/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, primaryKeyword, targetAudience, searchIntent, modules, language, shopDomain: connection?.shopDomain || null, markdownFileName, markdownSource }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || response.statusText);
      const article = data.article || {};
      setGeneratedDraft({
        title: typeof article.title === "string" ? article.title : "",
        bodyHtml: typeof article.bodyHtml === "string" ? article.bodyHtml : "",
        summary: typeof article.summary === "string" ? article.summary : "",
        seoTitle: typeof article.seoTitle === "string" ? article.seoTitle : "",
        metaDescription: typeof article.metaDescription === "string" ? article.metaDescription : "",
        urlHandle: typeof article.urlHandle === "string" ? article.urlHandle : "",
        tags: typeof article.tags === "string" ? article.tags : "",
      });
    } catch (error) { window.alert(error instanceof Error ? error.message : "生成文章失败"); } finally { setGenerating(false); }
  }

  function handleApplyGeneratedDraft() {
    if (!generatedDraft) return;
    setArticleTitle(generatedDraft.title);
    setArticleBodyHtml(generatedDraft.bodyHtml);
    setSummary(generatedDraft.summary);
    setSeoTitle(generatedDraft.seoTitle);
    setMetaDescription(generatedDraft.metaDescription);
    setUrlHandle(generatedDraft.urlHandle);
    setTags(generatedDraft.tags);
  }

  function handleSaveDraft() {
    window.localStorage.setItem("blog-article-draft", JSON.stringify({ prompt, primaryKeyword, targetAudience, searchIntent, modules, language, articleTitle, articleBodyHtml, summary, seoTitle, metaDescription, urlHandle, shopifyBlog, author, tags, coverFileName, publishStatus, shopifyArticleId, markdownFileName, markdownSource, generatedDraft, savedAt: Date.now() }));
    setDraftSaved(true); window.setTimeout(() => setDraftSaved(false), 1600);
  }

  async function handleSyncShopify() {
    if (!connection || syncing) return;
    setSyncMessage("");
    setSyncing(true);
    try {
      const response = await fetchWithShopifyDevice("/api/blog/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopDomain: connection.shopDomain, shopifyArticleId, shopifyBlog, articleTitle, articleBodyHtml, summary, seoTitle, metaDescription, urlHandle, author, tags, publishStatus }) });
      const data = (await response.json()) as { article?: BlogSyncArticle; error?: string };
      if (!response.ok) throw new Error(data.error || response.statusText);
      const article = data.article;
      if (!article?.id) throw new Error("Shopify 没有返回文章 ID");
      setShopifyArticleId(article.id);
      if (article.handle) setUrlHandle(article.handle);
      savePublishedArticle({ id: article.id, articleTitle, articleBodyHtml, summary, shopifyBlog: article.blogHandle || shopifyBlog, urlHandle: article.handle || urlHandle, publicUrl: article.publicUrl || "", shopifyArticleId: article.id, coverImageUrl: "", publishedAt: Date.now(), lastSyncedAt: Date.now(), syncStatus: "synced" });
      setSyncMessage(`已同步到 Shopify：${article.title || articleTitle}`);
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "同步 Shopify 失败");
    } finally {
      setSyncing(false);
    }
  }

  async function handleMarkdownFile(file: File | undefined) {
    setMarkdownError("");
    if (!file) {
      setMarkdownFileName("");
      setMarkdownSource("");
      return;
    }
    const lowerName = file.name.toLowerCase();
    const isMarkdown =
      lowerName.endsWith(".md") ||
      lowerName.endsWith(".markdown") ||
      file.type === "text/markdown" ||
      file.type === "text/plain" ||
      !file.type;
    if (!isMarkdown) {
      setMarkdownError("请上传 .md 或 .markdown 文件。");
      return;
    }
    const text = await file.text();
    const normalized = normalizeMarkdownSource(text);
    if (!normalized) {
      setMarkdownError("Markdown 文件内容为空。");
      return;
    }
    setMarkdownFileName(file.name);
    setMarkdownSource(normalized);
    if (normalized.length < text.trim().length) {
      setMarkdownError(`文件内容较长，已截取前 ${MARKDOWN_SOURCE_MAX_CHARS.toLocaleString()} 字符用于生成。`);
    }
  }

  async function handleBindFile(file: File | undefined) {
    setBindError("");
    setBindFileName(file?.name || "");
    setBindFileText("");
    setBindCredentials(null);
    if (!file) return;
    const text = await file.text();
    setBindFileText(text);
    try {
      setBindCredentials(parseShopifyCredentials(text));
    } catch (error) {
      setBindError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleClearShopifyBinding() {
    if (!connection?.shopDomain || clearingBinding || binding) return;
    setBindError("");
    setClearingBinding(true);
    try {
      const response = await fetchWithShopifyDevice(`/api/shopify/connection?shopDomain=${encodeURIComponent(connection.shopDomain)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || response.statusText);
      const active = data.connection as ShopifyConnection | null;
      setConnection(active?.shopDomain ? active : null);
    } catch (error) {
      setBindError(error instanceof Error ? error.message : "清除旧 Shopify 绑定失败");
    } finally {
      setClearingBinding(false);
    }
  }

  async function handleExchangeToken() {
    setBindError("");
    let credentials = bindCredentials;
    if (!credentials) {
      try { credentials = parseShopifyCredentials(bindFileText); } catch (error) { setBindError(error instanceof Error ? error.message : String(error)); return; }
      setBindCredentials(credentials);
    }
    setBinding(true);
    try {
      const tokenResponse = await fetchWithShopifyDevice("/api/shopify/client-credentials-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useStored: false, shopDomain: credentials.shopDomain, clientId: credentials.clientId, clientSecret: credentials.clientSecret }) });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenData.error || tokenResponse.statusText);
      const clearResponse = await fetchWithShopifyDevice(`/api/shopify/connection?shopDomain=${encodeURIComponent(credentials.shopDomain)}`, { method: "DELETE" });
      const clearData = await clearResponse.json();
      if (!clearResponse.ok) throw new Error(clearData.error || clearResponse.statusText);
      const saveResponse = await fetchWithShopifyDevice("/api/shopify/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ authMode: "access_token", shopDomain: credentials.shopDomain, accessToken: tokenData.accessToken, tokenExpiresAt: tokenData.tokenExpiresAt }) });
      const saveData = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(saveData.error || saveResponse.statusText);
      const active = saveData.connection as ShopifyConnection | null;
      setConnection(active?.shopDomain ? active : { shopDomain: credentials.shopDomain, isActive: true });
      setBindOpen(false); setBindFileName(""); setBindFileText(""); setBindCredentials(null);
    } catch (error) { setBindError(error instanceof Error ? error.message : "兑换 Token 失败"); } finally { setBinding(false); }
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] px-5 py-6 md:px-7 md:py-7">
      <header className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-grad-brand text-white shadow-[0_0_16px_var(--brand-glow)]"><FileText size={18} /></span><div className="min-w-0"><h1 className="truncate text-[26px] font-bold text-fg-primary">博客文章</h1><p className="truncate text-[12px] text-fg-secondary">SEO 选题规划 → AI 生成长文 → 编辑审核 → 同步 Shopify 草稿</p></div></div>
        <button type="button" onClick={() => setBindOpen(true)} className={`rounded-sm px-3 py-2 text-[11px] font-semibold ${connection ? "bg-[var(--success-bg)] text-[#047857]" : "bg-bg-tertiary text-fg-secondary hover:bg-[var(--brand-50-bg)] hover:text-brand-600"}`}>{connection ? connection.shopDomain : connectionLoaded ? "Shopify 未绑定" : "检测绑定中"}</button>
      </header>

      <Panel className="mb-4 overflow-hidden"><div className="grid grid-cols-1 lg:grid-cols-2"><section className="border-b border-border-subtle lg:border-b-0 lg:border-r"><PanelHeader icon={<WandSparkles size={16} />} title="AI 创作指令" meta="输入文章要求" /><div className="p-4"><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className={`${CONTROL_CLASS} min-h-[118px] resize-y py-3 leading-5`} placeholder="描述文章主题、目标读者、核心关键词、内容方向或需要关联的商品" /><div className="mt-3 flex flex-wrap items-center justify-end gap-3"><div className="flex flex-wrap items-center gap-2"><label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-sm border border-border-subtle bg-white px-4 text-[11px] font-medium text-fg-secondary hover:border-brand-200 hover:text-brand-600"><input type="file" accept=".md,.markdown,text/markdown,text/plain" className="sr-only" onChange={(event) => void handleMarkdownFile(event.target.files?.[0])} /><Upload size={14} />上传 .md</label>{markdownFileName ? <div className="flex h-9 items-center gap-2 rounded-sm bg-bg-tertiary px-3 text-[10px] text-fg-secondary"><span className="max-w-[220px] truncate">{markdownFileName}</span><span className="text-fg-muted">{markdownSource.length.toLocaleString()} 字符</span><button type="button" onClick={() => { setMarkdownFileName(""); setMarkdownSource(""); setMarkdownError(""); }} className="text-fg-muted hover:text-danger"><X size={12} /></button></div> : null}<button type="button" onClick={handleOptimizePrompt} disabled={!prompt.trim()} className="flex h-9 items-center gap-1.5 rounded-sm border border-border-subtle bg-white px-4 text-[11px] font-medium text-fg-secondary disabled:opacity-45"><WandSparkles size={14} />优化提示词</button><button type="button" onClick={handleGenerate} disabled={(!prompt.trim() && !markdownSource.trim()) || generating} className="flex h-9 items-center gap-1.5 rounded-sm bg-grad-brand px-5 text-[11px] font-semibold text-white shadow-[0_5px_14px_rgba(99,102,241,0.18)] disabled:opacity-45">{generating ? <Loader2 size={14} className="animate-spin" /> : <WandSparkles size={14} />}{generating ? "正在生成..." : "生成文章"}</button></div></div>{markdownError ? <div className={`mt-2 rounded-sm px-3 py-2 text-[10px] ${markdownSource ? "bg-[var(--warn-bg)] text-[#b45309]" : "bg-[#fef2f2] text-[#dc2626]"}`}>{markdownError}</div> : null}</div></section><section><PanelHeader icon={<FileText size={16} />} title="AI 输出结果" meta="生成后先在这里预览" action={<button type="button" onClick={handleApplyGeneratedDraft} disabled={!generatedDraft || generating} className="flex h-8 items-center gap-1.5 rounded-sm bg-grad-brand px-4 text-[11px] font-semibold text-white disabled:opacity-45"><Check size={13} />快速填入</button>} /><GeneratedDraftPreview draft={generatedDraft} generating={generating} /></section></div></Panel>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section className="space-y-4 lg:col-span-8 xl:col-span-8">
          <Panel className="overflow-hidden">
            <PanelHeader icon={<FileText size={16} />} title="添加博客文章" meta={`${contentStats.words} words · ${contentStats.sections} sections · ${contentStats.faqs} FAQs`} />
            <div className="space-y-4 p-5">
              <Field label="标题" hint={`${articleTitle.length} / 70`} compact>
                <input value={articleTitle} onChange={(e) => setArticleTitle(e.target.value)} maxLength={70} className={`${CONTROL_CLASS} h-9`} placeholder="例如，介绍您的最新产品或优惠活动" />
              </Field>
              <Field label="内容" compact>
                <textarea value={articleBodyHtml} onChange={(e) => setArticleBodyHtml(e.target.value)} className={`${CONTROL_CLASS} min-h-[430px] resize-y py-3 font-mono leading-6`} placeholder="AI 生成后正文 HTML 会显示在这里，也可以直接编辑" />
              </Field>
            </div>
          </Panel>

          <Panel className="p-5">
            <PanelTitle title="摘要" />
            <p className="mb-3 text-[11px] text-fg-muted">添加文章摘要，摘要将显示在您的主页或博客上。</p>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} className={`${CONTROL_CLASS} min-h-[82px] resize-y py-2 leading-5`} />
          </Panel>

          <Panel className="p-5">
            <PanelTitle title="搜索引擎列表" />
            <p className="mb-4 text-[11px] text-fg-muted">添加标题和描述以查看此博客文章在搜索引擎中的显示效果。</p>
            <Field label="页面标题" hint={`${seoTitle.length} / 70`} compact>
              <input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} maxLength={70} className={`${CONTROL_CLASS} h-9`} />
            </Field>
            <Field label="元描述" hint={`${metaDescription.length} / 160`} compact>
              <textarea value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} maxLength={160} className={`${CONTROL_CLASS} min-h-[70px] resize-y py-2 leading-5`} />
            </Field>
            <Field label="URL 名称" compact>
              <input value={urlHandle} onChange={(e) => setUrlHandle(e.target.value)} className={`${CONTROL_CLASS} h-9`} placeholder="article-url-name" />
            </Field>
          </Panel>
        </section>

        <aside className="space-y-4 lg:col-span-4 xl:col-span-4">
          <Panel className="p-4">
            <PanelTitle title="可见性" />
            <div className="space-y-2 text-[12px] text-fg-primary">
              <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-border-subtle bg-white px-3 py-2">
                <input type="radio" name="blog-visibility" checked={publishStatus === "published"} onChange={() => setPublishStatus("published")} className="h-4 w-4 accent-brand-500" />
                <span>可见</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-border-subtle bg-white px-3 py-2">
                <input type="radio" name="blog-visibility" checked={publishStatus === "draft"} onChange={() => setPublishStatus("draft")} className="h-4 w-4 accent-brand-500" />
                <span>隐藏</span>
              </label>
            </div>
          </Panel>

          <Panel className="p-4">
            <PanelTitle title="图片" icon={<ImageIcon size={16} />} />
            <label className="flex min-h-[118px] cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-border-default bg-bg-tertiary px-3 text-center">
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => setCoverFileName(e.target.files?.[0]?.name || "")} />
              <ImageIcon size={18} className="mb-2 text-brand-400" />
              <span className="max-w-full truncate text-[11px] text-fg-secondary">{coverFileName || "添加图片"}</span>
            </label>
          </Panel>

          <Panel className="p-4">
            <PanelTitle title="组织" icon={<Store size={16} />} />
            <Field label="作者">
              <input value={author} onChange={(e) => setAuthor(e.target.value)} className={`${CONTROL_CLASS} h-9`} />
            </Field>
            <Field label="博客" required>
              <select value={shopifyBlog} onChange={(e) => setShopifyBlog(e.target.value)} className={`${CONTROL_CLASS} h-9`}>
                <option value="">{shopifyBlogsLoaded ? "请选择 Shopify 博客" : "正在读取 Shopify 博客..."}</option>
                {shopifyBlogs.map((blog) => (
                  <option key={blog.id} value={blog.id}>{blog.title || blog.handle || "未命名博客"}</option>
                ))}
                {shopifyBlogsLoaded && !shopifyBlogs.length ? <option value="news">新闻</option> : null}
              </select>
            </Field>
            <Field label="标记">
              <input value={tags} onChange={(e) => setTags(e.target.value)} className={`${CONTROL_CLASS} h-9`} placeholder="tag one, tag two" />
            </Field>
          </Panel>

          <Panel className="p-4">
            <PanelTitle title="模板样式" />
            <select className={`${CONTROL_CLASS} h-9`} defaultValue="default">
              <option value="default">默认博客文章</option>
            </select>
          </Panel>

          <Panel className="p-4">
            <PanelTitle title="保存 / 同步" />
            {syncMessage ? <div className={`mb-4 rounded-sm px-3 py-2 text-[11px] ${/失败|错误|找不到|请先|没有返回/.test(syncMessage) ? "bg-[#fef2f2] text-[#dc2626]" : "bg-[var(--success-bg)] text-[#047857]"}`}>{syncMessage}</div> : null}
            <button type="button" onClick={handleSaveDraft} className="mb-2 flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-border-subtle bg-white text-[12px] font-semibold text-fg-secondary">
              <Save size={15} />{draftSaved ? "已保存草稿" : "保存草稿"}
            </button>
            <button type="button" onClick={handleSyncShopify} disabled={!connection || syncing || !shopifyBlog || !articleTitle.trim() || !articleBodyHtml.trim()} className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-grad-brand text-[12px] font-semibold text-white disabled:opacity-45">
              {syncing ? <Loader2 size={14} className="animate-spin" /> : null}{syncing ? "同步中..." : shopifyArticleId ? "更新 Shopify 文章" : "同步 Shopify 草稿"}
            </button>
          </Panel>
        </aside>
      </section>      {bindOpen ? <ShopifyBindModal fileName={bindFileName} credentials={bindCredentials} error={bindError} binding={binding} clearing={clearingBinding} canSubmit={Boolean(bindCredentials)} boundShopDomain={connection?.shopDomain || ""} onFileChange={handleBindFile} onClear={handleClearShopifyBinding} onClose={() => { if (!binding && !clearingBinding) setBindOpen(false); }} onSubmit={handleExchangeToken} /> : null}
    </main>
  );
}

function savePublishedArticle(record: {
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
  syncStatus: "synced" | "pending" | "failed";
}) {
  const raw = window.localStorage.getItem("blog-published-articles");
  let list: typeof record[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) list = parsed as typeof record[];
    } catch {
      list = [];
    }
  }
  const next = [
    record,
    ...list.filter((item) => item.shopifyArticleId !== record.shopifyArticleId),
  ];
  window.localStorage.setItem("blog-published-articles", JSON.stringify(next));
  window.localStorage.setItem("blog-published-article", JSON.stringify(record));
}

function normalizeMarkdownSource(value: string) {
  return value
    .normalize("NFC")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MARKDOWN_SOURCE_MAX_CHARS);
}

function GeneratedDraftPreview({
  draft,
  generating,
}: {
  draft: BlogGeneratedDraft | null;
  generating: boolean;
}) {
  if (generating) {
    return <div className="flex min-h-[226px] items-center justify-center px-4 py-8 text-[12px] text-fg-muted"><Loader2 size={16} className="mr-2 animate-spin text-brand-500" />正在生成 AI 输出...</div>;
  }
  if (!draft) {
    return <div className="flex min-h-[226px] flex-col items-center justify-center px-5 py-8 text-center"><FileText size={18} className="mb-2 text-brand-400" /><p className="text-[12px] font-semibold text-fg-secondary">暂无 AI 输出</p><p className="mt-1 max-w-[360px] text-[10px] leading-4 text-fg-muted">填写左侧提示词或上传 .md 后点击生成，结果会先展示在这里。确认后再快速填入下方文章编辑区。</p></div>;
  }
  const bodyPreview = htmlToPreviewText(draft.bodyHtml);
  return (
    <div className="p-4">
      <div className="mb-3 text-[11px] font-semibold text-fg-primary">待填入内容</div>
      <div className="max-h-[214px] overflow-y-auto rounded-sm border border-border-subtle bg-bg-secondary">
        <PreviewRow label="文章标题" value={draft.title} />
        <PreviewRow label="页面标题" value={draft.seoTitle} />
        <PreviewRow label="元描述" value={draft.metaDescription} />
        <PreviewRow label="URL 名称" value={draft.urlHandle} />
        <PreviewRow label="文章标签" value={draft.tags} />
        <PreviewRow label="文章摘要" value={draft.summary} />
        <PreviewRow label="正文预览" value={bodyPreview} tall />
      </div>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  tall = false,
}: {
  label: string;
  value: string;
  tall?: boolean;
}) {
  return <div className="grid grid-cols-[86px_minmax(0,1fr)] gap-3 border-b border-border-subtle px-3 py-2 last:border-b-0"><span className="text-[10px] text-fg-muted">{label}</span><span className={`whitespace-pre-wrap break-words text-[10px] leading-4 text-fg-secondary ${tall ? "line-clamp-6" : ""}`}>{value || "待生成"}</span></div>;
}

function htmlToPreviewText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

function parseShopifyCredentials(text: string): ShopifyTxtCredentials {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    values[key] = value;
  }
  const credentials = { shopDomain: values.SHOPIFY_SHOP_DOMAIN || values.shopDomain || "", clientId: values.SHOPIFY_CLIENT_ID || values.clientId || "", clientSecret: values.SHOPIFY_CLIENT_SECRET || values.clientSecret || "" };
  if (!credentials.shopDomain || !credentials.clientId || !credentials.clientSecret) throw new Error("TXT 文件必须包含 SHOPIFY_SHOP_DOMAIN、SHOPIFY_CLIENT_ID、SHOPIFY_CLIENT_SECRET。");
  return credentials;
}

function ShopifyBindModal({ fileName, credentials, error, binding, clearing, canSubmit, boundShopDomain, onFileChange, onClear, onClose, onSubmit }: { fileName: string; credentials: ShopifyTxtCredentials | null; error: string; binding: boolean; clearing: boolean; canSubmit: boolean; boundShopDomain: string; onFileChange: (file: File | undefined) => void; onClear: () => void; onClose: () => void; onSubmit: () => void }) {
  const busy = binding || clearing;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"><div className="w-full max-w-[520px] rounded-lg bg-white p-5 shadow-xl"><div className="mb-3 flex items-start justify-between gap-4"><div><h2 className="text-[18px] font-bold text-fg-primary">添加 / 重新绑定 Shopify 店铺</h2><p className="mt-1 text-[12px] text-fg-muted">上传后会立即解析 TXT。重新绑定只使用下方识别出的店铺与 Client ID 换 token。</p></div><button type="button" onClick={onClose} disabled={busy} className="rounded-sm p-1 text-fg-muted hover:bg-bg-tertiary"><X size={18} /></button></div>{boundShopDomain ? <div className="mb-4 rounded-sm border border-[#fde68a] bg-[var(--warn-bg)] px-3 py-2 text-[11px] leading-5 text-[#92400e]">当前已绑定：{boundShopDomain}。如云端仍读取旧权限，可先清除旧绑定再上传 TXT 重新兑换。</div> : null}<label className="mb-4 block rounded-md border border-dashed border-brand-300 bg-[var(--brand-50-bg)] p-4"><div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-fg-primary"><UploadCloud size={16} className="text-brand-500" />上传店铺凭据 TXT 文件</div><input type="file" accept=".txt,text/plain" disabled={busy} onChange={(event) => void onFileChange(event.target.files?.[0])} className="w-full rounded-sm bg-white text-[12px] text-fg-secondary file:mr-3 file:rounded-sm file:border file:border-border-subtle file:bg-bg-secondary file:px-3 file:py-1.5 file:text-[12px]" />{fileName ? <p className="mt-2 text-[10px] text-fg-muted">已选择：{fileName}</p> : null}</label>{credentials ? <div className="mb-4 rounded-sm border border-[#bbf7d0] bg-[var(--success-bg)] px-3 py-2 text-[11px] leading-5 text-[#047857]"><div className="font-semibold">TXT 已识别，将使用以下信息兑换 token：</div><div>店铺：{credentials.shopDomain}</div><div>Client ID：{maskCredential(credentials.clientId)}</div><div>Client Secret：已识别，不显示明文</div></div> : fileName && !error ? <div className="mb-4 rounded-sm border border-border-subtle bg-bg-tertiary px-3 py-2 text-[11px] text-fg-muted">正在解析 TXT...</div> : null}<div className="mb-4 rounded-md bg-bg-tertiary p-4"><div className="mb-2 text-[12px] font-semibold text-fg-secondary">TXT 文件内容格式</div><pre className="rounded-sm bg-white p-3 text-[11px] leading-5 text-fg-secondary">{`SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com\nSHOPIFY_CLIENT_ID=...\nSHOPIFY_CLIENT_SECRET=...`}</pre><p className="mt-2 text-[11px] text-fg-muted">字段不完整时不会允许重新绑定；Token 会保存到当前云端账号与浏览器设备对应的 Shopify 绑定中。</p></div>{error ? <div className="mb-4 whitespace-pre-wrap rounded-sm border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] text-[#dc2626]">{error}</div> : null}<div className="flex items-center justify-between gap-2"><button type="button" onClick={onClear} disabled={!boundShopDomain || busy} className="flex h-9 items-center gap-2 rounded-sm border border-[#fecaca] bg-white px-4 text-[12px] font-medium text-[#dc2626] disabled:opacity-45">{clearing ? <Loader2 size={14} className="animate-spin" /> : null}{clearing ? "清除中..." : "清除旧绑定"}</button><div className="flex gap-2"><button type="button" onClick={onClose} disabled={busy} className="h-9 rounded-sm border border-border-subtle bg-white px-5 text-[12px] text-fg-secondary">取消</button><button type="button" onClick={onSubmit} disabled={!canSubmit || busy} className="flex h-9 items-center gap-2 rounded-sm bg-grad-brand px-5 text-[12px] font-semibold text-white disabled:opacity-45">{binding ? <Loader2 size={14} className="animate-spin" /> : null}{binding ? "重新绑定中..." : "清除并重新绑定"}</button></div></div></div></div>;
}

function maskCredential(value: string) {
  const text = String(value || "").trim();
  if (text.length <= 8) return text ? "••••" : "";
  return `${text.slice(0, 4)}••••${text.slice(-6)}`;
}
function Tab({ href, label, count, active = false }: { href: string; label: string; count?: string; active?: boolean }) { return <Link href={href} className={`relative pb-3 ${active ? "font-semibold text-brand-600" : "text-fg-secondary"}`}>{label}{count ? <span className="ml-1 text-[11px] text-fg-muted">{count}</span> : null}{active ? <span className="absolute bottom-[-1px] left-0 h-0.5 w-full rounded-full bg-brand-500" /> : null}</Link>; }
function Panel({ className = "", children }: { className?: string; children: React.ReactNode }) { return <div className={`rounded-md border border-border-subtle bg-white shadow-sm ${className}`}>{children}</div>; }
function PanelHeader({ icon, title, meta, action }: { icon: React.ReactNode; title: string; meta?: string; action?: React.ReactNode }) { return <div className="flex min-h-[56px] items-center justify-between gap-3 border-b border-border-subtle px-4 py-3"><div className="flex min-w-0 items-center gap-2"><span className="text-brand-500">{icon}</span><div className="min-w-0"><h2 className="text-[13px] font-semibold text-fg-primary">{title}</h2>{meta ? <p className="text-[9px] text-fg-muted">{meta}</p> : null}</div></div>{action ? <div className="shrink-0">{action}</div> : null}</div>; }
function PanelTitle({ title, icon }: { title: string; icon?: React.ReactNode }) { return <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-fg-primary"><span className="text-brand-500">{icon}</span>{title}</div>; }
function Field({ label, hint, required = false, compact = false, children }: { label: string; hint?: string; required?: boolean; compact?: boolean; children: React.ReactNode }) { return <label className={compact ? "mb-3 block" : "mb-4 block"}><div className="mb-1.5 flex justify-between text-[11px] font-medium text-fg-secondary"><span>{label}{required ? <span className="ml-0.5 text-[#ef4444]">*</span> : null}</span>{hint ? <span className="text-[9px] font-normal text-fg-muted">{hint}</span> : null}</div>{children}</label>; }
