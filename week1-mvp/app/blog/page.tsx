"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, FileText, Image as ImageIcon, Loader2, Save, Store, UploadCloud, WandSparkles, X } from "lucide-react";
import { fetchWithShopifyDevice } from "@/lib/shopify-device-client";

type ModuleKey = "quickAnswer" | "toc" | "trendTable" | "recommendations" | "sources" | "faq" | "cta" | "relatedArticles";
type OutputLanguage = "english" | "bilingual" | "chinese";
type PublishStatus = "draft" | "published";
type ShopifyConnection = { shopDomain: string; isActive?: boolean };
type ShopifyTxtCredentials = { shopDomain: string; clientId: string; clientSecret: string };

const CONTROL_CLASS = "w-full rounded-sm border border-border-default bg-bg-secondary px-3 text-[12px] text-fg-primary outline-none transition-colors placeholder:text-fg-muted focus:border-brand-400 focus:ring-2 focus:ring-[rgba(99,102,241,0.12)]";

const PROMPT_TEMPLATES = [
  ["根据产品生成", "请根据我选择的 Shopify 商品生成一篇博客文章，说明产品特点、适用场景、选购建议和搭配方式，并自然引导读者查看相关商品。"],
  ["根据关键词生成", "请围绕我填写的核心关键词生成一篇 SEO 博客文章，覆盖用户搜索意图、相关问题、实用建议和常见疑问。"],
  ["趋势文章", "请生成一篇行业趋势文章，提炼当前流行方向、代表性风格、颜色与材质，并给出可执行的选购建议。"],
  ["选购指南", "请生成一篇完整的选购指南，按使用场景、体型、预算、颜色、面料和尺码逐项说明选择方法。"],
  ["对比文章", "请生成一篇对比型文章，清晰比较不同款式、材质或场景的优缺点，并给出适合不同用户的结论。"],
  ["FAQ 文章", "请根据用户常见搜索问题生成一篇 FAQ 博客文章，回答简洁、准确，并补充必要的选购建议。"],
] as const;

const MODULE_OPTIONS: Array<{ key: ModuleKey; label: string }> = [
  { key: "quickAnswer", label: "Quick Answer" },
  { key: "toc", label: "文章目录" },
  { key: "trendTable", label: "趋势对比表" },
  { key: "recommendations", label: "搭配推荐" },
  { key: "sources", label: "来源资料" },
  { key: "faq", label: "FAQ" },
  { key: "cta", label: "收藏 CTA" },
  { key: "relatedArticles", label: "相关文章" },
];

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
  const [bindOpen, setBindOpen] = useState(false);
  const [bindFileName, setBindFileName] = useState("");
  const [bindFileText, setBindFileText] = useState("");
  const [bindError, setBindError] = useState("");
  const [binding, setBinding] = useState(false);

  const contentStats = useMemo(() => {
    const text = articleBodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return { words: text ? text.split(" ").filter(Boolean).length : 0, sections: (articleBodyHtml.match(/<h[1-6]\b/gi) || []).length, faqs: (articleBodyHtml.match(/faq|常见问题/gi) || []).length };
  }, [articleBodyHtml]);

  const syncFields = [["发布博客", Boolean(shopifyBlog)], ["文章标题", Boolean(articleTitle.trim())], ["正文 HTML", Boolean(articleBodyHtml.trim())], ["文章摘要", Boolean(summary.trim())], ["URL 名称", Boolean(urlHandle.trim())], ["文章标签", Boolean(tags.trim())], ["作者", Boolean(author.trim())], ["封面图片", Boolean(coverFileName)]] as const;
  const syncReadyCount = syncFields.filter(([, ready]) => ready).length;

  useEffect(() => { void loadShopifyConnection(); }, []);

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

  function toggleModule(key: ModuleKey) { setModules((current) => ({ ...current, [key]: !current[key] })); }
  function handleOptimizePrompt() { if (!prompt.trim()) return; setPrompt(`${prompt.trim()}\n\n输出要求：围绕搜索意图组织 H2/H3 结构，内容具体可信，包含实用建议，并自然关联可选商品。`); }

  async function handleGenerate() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    try {
      const response = await fetch("/api/blog/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, primaryKeyword, targetAudience, searchIntent, modules, language, shopDomain: connection?.shopDomain || null }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || response.statusText);
      const article = data.article || {};
      if (typeof article.title === "string") setArticleTitle(article.title);
      if (typeof article.bodyHtml === "string") setArticleBodyHtml(article.bodyHtml);
      if (typeof article.summary === "string") setSummary(article.summary);
      if (typeof article.seoTitle === "string") setSeoTitle(article.seoTitle);
      if (typeof article.metaDescription === "string") setMetaDescription(article.metaDescription);
      if (typeof article.urlHandle === "string") setUrlHandle(article.urlHandle);
      if (typeof article.tags === "string") setTags(article.tags);
    } catch (error) { window.alert(error instanceof Error ? error.message : "生成文章失败"); } finally { setGenerating(false); }
  }

  function handleSaveDraft() {
    window.localStorage.setItem("blog-article-draft", JSON.stringify({ prompt, primaryKeyword, targetAudience, searchIntent, modules, language, articleTitle, articleBodyHtml, summary, seoTitle, metaDescription, urlHandle, shopifyBlog, author, tags, coverFileName, publishStatus, savedAt: Date.now() }));
    setDraftSaved(true); window.setTimeout(() => setDraftSaved(false), 1600);
  }

  async function handleBindFile(file: File | undefined) {
    setBindError("");
    setBindFileName(file?.name || "");
    setBindFileText(file ? await file.text() : "");
  }

  async function handleExchangeToken() {
    setBindError("");
    let credentials: ShopifyTxtCredentials;
    try { credentials = parseShopifyCredentials(bindFileText); } catch (error) { setBindError(error instanceof Error ? error.message : String(error)); return; }
    setBinding(true);
    try {
      const tokenResponse = await fetchWithShopifyDevice("/api/shopify/client-credentials-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useStored: false, shopDomain: credentials.shopDomain, clientId: credentials.clientId, clientSecret: credentials.clientSecret }) });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenData.error || tokenResponse.statusText);
      const saveResponse = await fetchWithShopifyDevice("/api/shopify/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ authMode: "access_token", shopDomain: credentials.shopDomain, accessToken: tokenData.accessToken, tokenExpiresAt: tokenData.tokenExpiresAt }) });
      const saveData = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(saveData.error || saveResponse.statusText);
      const active = saveData.connection as ShopifyConnection | null;
      setConnection(active?.shopDomain ? active : { shopDomain: credentials.shopDomain, isActive: true });
      setBindOpen(false); setBindFileName(""); setBindFileText("");
    } catch (error) { setBindError(error instanceof Error ? error.message : "兑换 Token 失败"); } finally { setBinding(false); }
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] px-5 py-6 md:px-7 md:py-7">
      <header className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-grad-brand text-white shadow-[0_0_16px_var(--brand-glow)]"><FileText size={18} /></span><div className="min-w-0"><h1 className="truncate text-[26px] font-bold text-fg-primary">博客文章</h1><p className="truncate text-[12px] text-fg-secondary">SEO 选题规划 → AI 生成长文 → 编辑审核 → 同步 Shopify 草稿</p></div></div>
        <button type="button" onClick={() => setBindOpen(true)} className={`rounded-sm px-3 py-2 text-[11px] font-semibold ${connection ? "bg-[var(--success-bg)] text-[#047857]" : "bg-bg-tertiary text-fg-secondary hover:bg-[var(--brand-50-bg)] hover:text-brand-600"}`}>{connection ? connection.shopDomain : connectionLoaded ? "Shopify 未绑定" : "检测绑定中"}</button>
      </header>

      <nav className="mb-4 flex items-center gap-7 border-b border-border-subtle text-[13px]"><Tab href="/blog" active label="新建文章" /><Tab href="/blog/drafts" label="草稿箱" count="0" /><Tab href="/blog/published" label="已发布" count="0" /></nav>

      <Panel className="mb-4"><PanelHeader icon={<WandSparkles size={16} />} title="AI 创作指令" meta="输入文章要求" /><div className="p-4"><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className={`${CONTROL_CLASS} min-h-[94px] resize-y py-3 leading-5`} placeholder="描述文章主题、目标读者、核心关键词、内容方向或需要关联的商品" /><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-[10px] text-fg-muted">提示词模板</span>{PROMPT_TEMPLATES.map(([label, text]) => <button key={label} type="button" onClick={() => setPrompt(text)} className="h-7 rounded-sm border border-border-subtle bg-white px-3 text-[10px] text-fg-secondary hover:border-brand-200 hover:text-brand-600">{label}</button>)}</div><div className="flex gap-2"><button type="button" onClick={handleOptimizePrompt} disabled={!prompt.trim()} className="flex h-9 items-center gap-1.5 rounded-sm border border-border-subtle bg-white px-4 text-[11px] font-medium text-fg-secondary disabled:opacity-45"><WandSparkles size={14} />优化提示词</button><button type="button" onClick={handleGenerate} disabled={!prompt.trim() || generating} className="flex h-9 items-center gap-1.5 rounded-sm bg-grad-brand px-5 text-[11px] font-semibold text-white shadow-[0_5px_14px_rgba(99,102,241,0.18)] disabled:opacity-45">{generating ? <Loader2 size={14} className="animate-spin" /> : <WandSparkles size={14} />}{generating ? "正在生成..." : "生成文章"}</button></div></div></div></Panel>

      <section className="grid min-h-[900px] grid-cols-1 gap-4 lg:grid-cols-12">
        <aside className="lg:col-span-3 xl:col-span-2"><Panel className="h-full p-4"><PanelTitle title="SEO 简报" /><Field label="核心关键词" required><input value={primaryKeyword} onChange={(e) => setPrimaryKeyword(e.target.value)} className={`${CONTROL_CLASS} h-9`} /></Field><Field label="搜索意图"><input value={searchIntent} onChange={(e) => setSearchIntent(e.target.value)} className={`${CONTROL_CLASS} h-9`} placeholder="信息 + 商业调查" /></Field><Field label="目标用户"><input value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} className={`${CONTROL_CLASS} h-9`} placeholder="美丽学生" /></Field><div className="mb-4"><div className="mb-2 flex justify-between text-[11px] text-fg-secondary"><span>内容模块</span><span>{Object.values(modules).filter(Boolean).length} 项启用</span></div><div className="grid grid-cols-2 gap-2">{MODULE_OPTIONS.map((item) => <button key={item.key} type="button" onClick={() => toggleModule(item.key)} className={`flex h-8 items-center gap-2 rounded-sm border px-2 text-[10px] ${modules[item.key] ? "border-brand-200 bg-[var(--brand-50-bg)] text-brand-700" : "border-border-subtle bg-bg-tertiary text-fg-secondary"}`}><span className={`flex h-4 w-4 items-center justify-center rounded-[4px] border ${modules[item.key] ? "border-brand-500 bg-brand-500 text-white" : "border-border-default bg-white"}`}>{modules[item.key] ? <Check size={11} /> : null}</span>{item.label}</button>)}</div></div><Field label="输出语言"><div className="grid grid-cols-3 rounded-sm bg-bg-tertiary p-1">{([['english','英文'],['bilingual','中英双语'],['chinese','中文']] as Array<[OutputLanguage,string]>).map(([value,label]) => <button key={value} type="button" onClick={() => setLanguage(value)} className={`h-7 rounded-[6px] text-[10px] ${language === value ? "bg-white font-semibold text-brand-600 shadow-sm" : "text-fg-tertiary"}`}>{label}</button>)}</div></Field></Panel></aside>
        <section className="lg:col-span-6 xl:col-span-7"><Panel className="flex h-full flex-col overflow-hidden"><PanelHeader icon={<FileText size={16} />} title="文章编辑" meta={`${contentStats.words} words · ${contentStats.sections} sections · ${contentStats.faqs} FAQs`} /><div className="border-b border-border-subtle px-5 py-4"><div className="mb-1 flex justify-between text-[10px] text-fg-muted"><span>标题</span><span>{articleTitle.length} / 70</span></div><input value={articleTitle} onChange={(e) => setArticleTitle(e.target.value)} maxLength={70} className="w-full bg-transparent text-[20px] font-bold text-fg-primary outline-none placeholder:text-fg-muted" placeholder="输入文章标题" /></div><textarea value={articleBodyHtml} onChange={(e) => setArticleBodyHtml(e.target.value)} className="min-h-[430px] flex-1 resize-y border-0 bg-bg-secondary p-5 font-mono text-[12px] leading-6 text-fg-secondary outline-none" placeholder="AI 生成后正文 HTML 会显示在这里" /><section className="border-t border-border-subtle px-5 py-4"><Field label="摘要" hint={`${summary.length} 字符`} compact><textarea value={summary} onChange={(e) => setSummary(e.target.value)} className={`${CONTROL_CLASS} min-h-[78px] resize-y py-2 leading-5`} /></Field><Field label="页面标题" hint={`${seoTitle.length} / 70`} compact><input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} maxLength={70} className={`${CONTROL_CLASS} h-9`} /></Field><Field label="元描述" hint={`${metaDescription.length} / 160`} compact><textarea value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} maxLength={160} className={`${CONTROL_CLASS} min-h-[70px] resize-y py-2 leading-5`} /></Field><Field label="URL 名称" compact><input value={urlHandle} onChange={(e) => setUrlHandle(e.target.value)} className={`${CONTROL_CLASS} h-9`} placeholder="article-url-name" /></Field></section></Panel></section>
        <aside className="lg:col-span-3 xl:col-span-3"><Panel className="flex h-full flex-col p-4"><PanelTitle title="Shopify 同步" icon={<Store size={16} />} /><Field label="发布博客" required><select value={shopifyBlog} onChange={(e) => setShopifyBlog(e.target.value)} className={`${CONTROL_CLASS} h-9`}><option value="">请选择 Shopify 博客</option><option value="news">News</option><option value="blog">Blog</option></select></Field><Field label="作者"><input value={author} onChange={(e) => setAuthor(e.target.value)} className={`${CONTROL_CLASS} h-9`} /></Field><Field label="文章标签"><input value={tags} onChange={(e) => setTags(e.target.value)} className={`${CONTROL_CLASS} h-9`} placeholder="tag one, tag two" /></Field><label className="mb-4 flex min-h-[82px] cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-border-default bg-bg-tertiary px-3 text-center"><input type="file" accept="image/*" className="sr-only" onChange={(e) => setCoverFileName(e.target.files?.[0]?.name || "")} /><ImageIcon size={17} className="mb-1.5 text-brand-400" /><span className="max-w-full truncate text-[10px] text-fg-secondary">{coverFileName || "选择封面图片"}</span></label><Field label="发布状态"><div className="grid grid-cols-2 rounded-sm bg-bg-tertiary p-1">{([['draft','草稿'],['published','立即发布']] as Array<[PublishStatus,string]>).map(([value,label]) => <button key={value} type="button" onClick={() => setPublishStatus(value)} className={`h-7 rounded-[6px] text-[10px] ${publishStatus === value ? "bg-white font-semibold text-brand-600 shadow-sm" : "text-fg-tertiary"}`}>{label}</button>)}</div></Field><div className="mb-4 divide-y divide-border-subtle rounded-sm border border-border-subtle">{syncFields.map(([label, ready]) => <div key={label} className="flex justify-between px-3 py-2 text-[10px]"><span className="text-fg-secondary">{label}</span><span className={ready ? "text-[#059669]" : "text-fg-muted"}>{ready ? "待同步" : "待填写"}</span></div>)}</div><div className="mb-4 flex gap-2 rounded-sm bg-[var(--warn-bg)] p-2.5 text-[10px] leading-4 text-[#b45309]"><AlertTriangle size={14} className="shrink-0" />页面标题与元描述仅在本地保存为 SEO 建议，Shopify Article API 没有对应字段。</div><div className="mt-auto"><button type="button" onClick={handleSaveDraft} className="mb-2 flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-border-subtle bg-white text-[12px] font-semibold text-fg-secondary"><Save size={15} />{draftSaved ? "已保存草稿" : "保存草稿"}</button><button type="button" disabled={!connection} className="flex h-10 w-full items-center justify-center rounded-sm bg-grad-brand text-[12px] font-semibold text-white disabled:opacity-45">同步 Shopify 草稿</button></div></Panel></aside>
      </section>
      {bindOpen ? <ShopifyBindModal fileName={bindFileName} error={bindError} binding={binding} canSubmit={Boolean(bindFileText)} onFileChange={handleBindFile} onClose={() => { if (!binding) setBindOpen(false); }} onSubmit={handleExchangeToken} /> : null}
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
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    values[key] = value;
  }
  const credentials = { shopDomain: values.SHOPIFY_SHOP_DOMAIN || values.shopDomain || "", clientId: values.SHOPIFY_CLIENT_ID || values.clientId || "", clientSecret: values.SHOPIFY_CLIENT_SECRET || values.clientSecret || "" };
  if (!credentials.shopDomain || !credentials.clientId || !credentials.clientSecret) throw new Error("TXT 文件必须包含 SHOPIFY_SHOP_DOMAIN、SHOPIFY_CLIENT_ID、SHOPIFY_CLIENT_SECRET。");
  return credentials;
}

function ShopifyBindModal({ fileName, error, binding, canSubmit, onFileChange, onClose, onSubmit }: { fileName: string; error: string; binding: boolean; canSubmit: boolean; onFileChange: (file: File | undefined) => void; onClose: () => void; onSubmit: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"><div className="w-full max-w-[520px] rounded-lg bg-white p-5 shadow-xl"><div className="mb-3 flex items-start justify-between gap-4"><div><h2 className="text-[18px] font-bold text-fg-primary">添加 Shopify 店铺</h2><p className="mt-1 text-[12px] text-fg-muted">凭据只发送到本机服务，页面不会显示文件中的密钥。</p></div><button type="button" onClick={onClose} disabled={binding} className="rounded-sm p-1 text-fg-muted hover:bg-bg-tertiary"><X size={18} /></button></div><label className="mb-4 block rounded-md border border-dashed border-brand-300 bg-[var(--brand-50-bg)] p-4"><div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-fg-primary"><UploadCloud size={16} className="text-brand-500" />上传店铺凭据 TXT 文件</div><input type="file" accept=".txt,text/plain" disabled={binding} onChange={(event) => void onFileChange(event.target.files?.[0])} className="w-full rounded-sm bg-white text-[12px] text-fg-secondary file:mr-3 file:rounded-sm file:border file:border-border-subtle file:bg-bg-secondary file:px-3 file:py-1.5 file:text-[12px]" />{fileName ? <p className="mt-2 text-[10px] text-fg-muted">已选择：{fileName}</p> : null}</label><div className="mb-4 rounded-md bg-bg-tertiary p-4"><div className="mb-2 text-[12px] font-semibold text-fg-secondary">TXT 文件内容格式</div><pre className="rounded-sm bg-white p-3 text-[11px] leading-5 text-fg-secondary">{`SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com\nSHOPIFY_CLIENT_ID=...\nSHOPIFY_CLIENT_SECRET=...`}</pre><p className="mt-2 text-[11px] text-fg-muted">Token 会保存到当前浏览器设备对应的 Shopify 绑定中。</p></div>{error ? <div className="mb-4 rounded-sm border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] text-[#dc2626]">{error}</div> : null}<div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={binding} className="h-9 rounded-sm border border-border-subtle bg-white px-5 text-[12px] text-fg-secondary">取消</button><button type="button" onClick={onSubmit} disabled={!canSubmit || binding} className="flex h-9 items-center gap-2 rounded-sm bg-grad-brand px-5 text-[12px] font-semibold text-white disabled:opacity-45">{binding ? <Loader2 size={14} className="animate-spin" /> : null}{binding ? "兑换中..." : "兑换 Token"}</button></div></div></div>;
}

function Tab({ href, label, count, active = false }: { href: string; label: string; count?: string; active?: boolean }) { return <Link href={href} className={`relative pb-3 ${active ? "font-semibold text-brand-600" : "text-fg-secondary"}`}>{label}{count ? <span className="ml-1 text-[11px] text-fg-muted">{count}</span> : null}{active ? <span className="absolute bottom-[-1px] left-0 h-0.5 w-full rounded-full bg-brand-500" /> : null}</Link>; }
function Panel({ className = "", children }: { className?: string; children: React.ReactNode }) { return <div className={`rounded-md border border-border-subtle bg-white shadow-sm ${className}`}>{children}</div>; }
function PanelHeader({ icon, title, meta }: { icon: React.ReactNode; title: string; meta?: string }) { return <div className="flex min-h-[56px] items-center gap-2 border-b border-border-subtle px-4 py-3"><span className="text-brand-500">{icon}</span><div><h2 className="text-[13px] font-semibold text-fg-primary">{title}</h2>{meta ? <p className="text-[9px] text-fg-muted">{meta}</p> : null}</div></div>; }
function PanelTitle({ title, icon }: { title: string; icon?: React.ReactNode }) { return <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-fg-primary"><span className="text-brand-500">{icon}</span>{title}</div>; }
function Field({ label, hint, required = false, compact = false, children }: { label: string; hint?: string; required?: boolean; compact?: boolean; children: React.ReactNode }) { return <label className={compact ? "mb-3 block" : "mb-4 block"}><div className="mb-1.5 flex justify-between text-[11px] font-medium text-fg-secondary"><span>{label}{required ? <span className="ml-0.5 text-[#ef4444]">*</span> : null}</span>{hint ? <span className="text-[9px] font-normal text-fg-muted">{hint}</span> : null}</div>{children}</label>; }
