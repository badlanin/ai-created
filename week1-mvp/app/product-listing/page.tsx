"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Link,
  RefreshCw,
  Save,
  Send,
  ShoppingBag,
  Store,
  Tags,
} from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Dialog,
  Input,
  Select,
  Textarea,
} from "@/app/_components/ui";

type ShopifyBinding = {
  shopDomain: string;
  tokenPreview: string;
  shopName: string | null;
  myshopifyDomain: string | null;
  primaryDomain: string | null;
  createdAt: number;
  updatedAt: number;
  lastTestedAt: number | null;
};

type SyncState = "idle" | "draft" | "syncing" | "synced";

type ProductForm = {
  title: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string;
  color: string;
  material: string;
  neckline: string;
  silhouette: string;
  sku: string;
  price: string;
  inventory: string;
  status: "DRAFT" | "ACTIVE";
  seoTitle: string;
  seoDescription: string;
};

type ShopifySyncResult = {
  productId: string;
  title: string;
  handle: string | null;
  legacyResourceId: string | null;
  adminUrl: string | null;
  warnings: string[];
};

const TEST_SHOP_DOMAIN = "test.myshopify.com";
const TEST_ACCESS_TOKEN = "shpat_test_buqiqi";

const EMPTY_FORM: ProductForm = {
  title: "",
  description: "",
  productType: "",
  vendor: "",
  tags: "",
  color: "",
  material: "",
  neckline: "",
  silhouette: "",
  sku: "",
  price: "",
  inventory: "",
  status: "DRAFT",
  seoTitle: "",
  seoDescription: "",
};

const SAMPLE_AI_TEXT = `商品标题：Dusty Rose Strapless Chiffon Long Prom Dress With Slit
商品描述：A refined long prom dress in dusty rose chiffon, featuring a strapless neckline, fitted bodice, soft drape, and a front slit. Designed for prom, bridesmaid styling, and formal evening occasions.
产品类型：Prom Dress
供应商：BUQIQI
标签：prom dress, chiffon, strapless, long dress, slit, dusty rose
主色调：Dusty Rose
面料材质：Chiffon
领口设计：Strapless
整体版型：Fitted bodice, long flowing skirt
SKU：BQ-PD-DR-001
价格：189.00
库存：12
SEO标题：Dusty Rose Strapless Chiffon Long Prom Dress With Slit
SEO描述：Shop a dusty rose strapless chiffon long prom dress with a front slit, soft drape, and elegant formal silhouette.`;

function formatUnixTime(value: number | null): string {
  if (!value) return "未记录";
  return new Date(value * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sanitizeAiOutput(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripMarkdownJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseAiOutputToForm(raw: string): Partial<ProductForm> {
  const cleaned = sanitizeAiOutput(raw);
  const json = parseAiJson(cleaned);
  if (json) return mapObjectToProductForm(json);
  return mapKeyValueTextToProductForm(cleaned);
}

function parseAiJson(value: string): Record<string, unknown> | null {
  const cleaned = stripMarkdownJsonFence(value);
  const candidates = [
    cleaned,
    cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1),
  ].filter((item) => item && item.includes("{") && item.includes("}"));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {}
  }
  return null;
}

function mapObjectToProductForm(source: Record<string, unknown>): Partial<ProductForm> {
  const read = (...keys: string[]) => {
    for (const key of keys) {
      const value = source[key];
      if (Array.isArray(value)) return value.join(", ");
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return "";
  };
  return {
    title: read("商品标题", "标题", "title", "Title"),
    description: read("商品描述", "描述", "description", "Description"),
    productType: read("产品类型", "礼服类型", "productType", "product_type"),
    vendor: read("供应商", "vendor", "Vendor"),
    tags: read("标签", "tags", "Tags"),
    color: read("主色调", "颜色", "color", "Color"),
    material: read("面料材质", "材质", "material", "Material"),
    neckline: read("领口设计", "领口", "neckline", "Neckline"),
    silhouette: read("整体版型", "版型", "silhouette", "Silhouette"),
    sku: read("SKU", "sku"),
    price: read("价格", "price", "Price"),
    inventory: read("库存", "inventory", "Inventory"),
    seoTitle: read("SEO标题", "SEO 标题", "seoTitle", "seo_title"),
    seoDescription: read("SEO描述", "SEO 描述", "seoDescription", "seo_description"),
  };
}

function mapKeyValueTextToProductForm(value: string): Partial<ProductForm> {
  const aliases: Record<keyof ProductForm, string[]> = {
    title: ["商品标题", "标题", "Title"],
    description: ["商品描述", "描述", "Description"],
    productType: ["产品类型", "礼服类型", "Product type"],
    vendor: ["供应商", "Vendor"],
    tags: ["标签", "Tags"],
    color: ["主色调", "颜色", "Color"],
    material: ["面料材质", "材质", "Material"],
    neckline: ["领口设计", "领口", "Neckline"],
    silhouette: ["整体版型", "版型", "Silhouette"],
    sku: ["SKU"],
    price: ["价格", "Price"],
    inventory: ["库存", "Inventory"],
    status: ["状态", "Status"],
    seoTitle: ["SEO标题", "SEO 标题", "SEO Title"],
    seoDescription: ["SEO描述", "SEO 描述", "SEO Description"],
  };
  const result: Partial<ProductForm> = {};
  for (const [field, labels] of Object.entries(aliases) as Array<
    [keyof ProductForm, string[]]
  >) {
    if (field === "status") continue;
    const extracted = extractByLabels(value, labels);
    if (extracted) result[field] = extracted as never;
  }
  if (!result.description && value) result.description = value;
  return result;
}

function extractByLabels(text: string, labels: string[]): string {
  const labelPattern = labels.map(escapeRegExp).join("|");
  const match = text.match(
    new RegExp(
      `(?:^|\\n)\\s*(?:[-•*]\\s*)?(?:${labelPattern})\\s*[：:]\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-•*]\\s*)?[\\u4e00-\\u9fa5A-Za-z ]{2,24}\\s*[：:]|$)`,
      "i",
    ),
  );
  return sanitizeAiOutput(match?.[1] || "").replace(/\n/g, "、");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function ProductListingPage() {
  const [binding, setBinding] = useState<ShopifyBinding | null>(null);
  const [shopDomain, setShopDomain] = useState("xxx.myshopify.com");
  const [accessToken, setAccessToken] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [loadingBinding, setLoadingBinding] = useState(true);
  const [testing, setTesting] = useState(false);
  const [savingBinding, setSavingBinding] = useState(false);
  const [unbinding, setUnbinding] = useState(false);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const [aiRawText, setAiRawText] = useState(SAMPLE_AI_TEXT);
  const [cleanedAiText, setCleanedAiText] = useState(sanitizeAiOutput(SAMPLE_AI_TEXT));
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [lastAction, setLastAction] = useState("等待填写或应用 AI 解析结果");
  const [shopifyProductUrl, setShopifyProductUrl] = useState<string | null>(null);
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    async function loadBinding() {
      setLoadingBinding(true);
      try {
        const res = await fetch("/api/shopify/connection");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        if (!alive) return;
        if (data.bound) {
          setBinding(data as ShopifyBinding);
          setShopDomain(data.shopDomain);
          setConnectionMessage("已读取 Shopify 绑定信息。");
        } else {
          setBinding(null);
        }
      } catch (e) {
        if (alive) {
          setConnectionMessage(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (alive) setLoadingBinding(false);
      }
    }
    loadBinding();
    return () => {
      alive = false;
    };
  }, []);

  const tokenPreview = useMemo(() => {
    if (binding) return binding.tokenPreview;
    if (!accessToken.trim()) return "未填写";
    return `••••••••••••${accessToken.trim().slice(-4)}`;
  }, [accessToken, binding]);

  async function testConnection() {
    setTesting(true);
    setConnectionMessage(null);
    try {
      const res = await fetch("/api/shopify/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          binding && !accessToken.trim()
            ? { useStored: true }
            : { shopDomain, accessToken },
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setConnectionMessage(
        data.result?.shopName
          ? `连接成功：${data.result.shopName}`
          : "连接成功，已验证 Shopify Admin API。",
      );
    } catch (e) {
      setConnectionMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  async function saveBinding() {
    if (!shopDomain.trim() || !accessToken.trim()) {
      setConnectionMessage("请填写店铺域名和 Admin API Access Token。");
      return;
    }
    setSavingBinding(true);
    setConnectionMessage(null);
    try {
      const res = await fetch("/api/shopify/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopDomain, accessToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setBinding(data.connection as ShopifyBinding);
      setShopDomain(data.connection.shopDomain);
      setAccessToken("");
      setConnectionMessage("Shopify 连接验证通过，绑定信息已加密保存。");
    } catch (e) {
      setConnectionMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingBinding(false);
    }
  }

  function fillTestCredentials() {
    setShopDomain(TEST_SHOP_DOMAIN);
    setAccessToken(TEST_ACCESS_TOKEN);
    setConnectionMessage(
      "已填入测试密钥。点击测试连接或保存会走模拟分支，不调用 Shopify 官方接口。",
    );
  }

  async function unbindShopify() {
    setUnbinding(true);
    try {
      const res = await fetch("/api/shopify/connection", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setBinding(null);
      setAccessToken("");
      setConnectionMessage("已解除 Shopify 绑定。");
      setConfirmUnbind(false);
      setSyncState("idle");
      setLastAction("Shopify 已解除绑定");
    } catch (e) {
      setConnectionMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setUnbinding(false);
    }
  }

  function applyAiToForm() {
    const cleaned = sanitizeAiOutput(aiRawText);
    const parsed = parseAiOutputToForm(cleaned);
    setForm((prev) => ({
      ...prev,
      ...parsed,
      status: prev.status,
    }));
    setCleanedAiText(cleaned);
    setSyncState("idle");
    setLastAction("大模型输出已清理并填入 Shopify 商品表单");
  }

  function saveDraft() {
    setSyncState("draft");
    setLastAction("已保存为本地草稿，等待同步 Shopify");
  }

  async function syncToShopify() {
    setSyncState("syncing");
    setShopifyProductUrl(null);
    setSyncWarnings([]);
    setLastAction("正在同步到 Shopify 商品后台");
    try {
      const res = await fetch("/api/shopify/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product: form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      const result = data.result as ShopifySyncResult;
      setSyncState("synced");
      setShopifyProductUrl(result.adminUrl);
      setSyncWarnings(result.warnings || []);
      setLastAction(
        result.adminUrl
          ? `已同步到 Shopify：${result.title}`
          : `已同步到 Shopify：${result.title}`,
      );
    } catch (e) {
      setSyncState("idle");
      setLastAction(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-5 md:px-8 py-6 md:py-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-10 h-10 rounded-md flex items-center justify-center text-white shrink-0"
            style={{
              background: "var(--brand-gradient)",
              boxShadow: "0 0 16px var(--brand-glow)",
            }}
          >
            <ShoppingBag size={18} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold text-fg-primary tracking-tight">
              产品上架
            </h1>
            <p className="mt-0.5 text-[13px] text-fg-tertiary">
              AI 解析商品信息 → 填入 Shopify 商品字段 → 确认后同步草稿
            </p>
          </div>
        </div>
        <Chip tone={binding ? "success" : "warn"}>
          {binding ? "Shopify 已绑定" : "待绑定"}
        </Chip>
      </header>

      {loadingBinding ? (
        <Card padding="lg">
          <div className="text-sm text-fg-tertiary">正在读取 Shopify 绑定状态...</div>
        </Card>
      ) : !binding ? (
        <UnboundView
          shopDomain={shopDomain}
          accessToken={accessToken}
          tokenPreview={tokenPreview}
          connectionMessage={connectionMessage}
          testing={testing}
          savingBinding={savingBinding}
          onShopDomainChange={setShopDomain}
          onAccessTokenChange={setAccessToken}
          onFillTestCredentials={fillTestCredentials}
          onTestConnection={testConnection}
          onSaveBinding={saveBinding}
        />
      ) : (
        <div className="space-y-4">
          <BoundStatusCard
            binding={binding}
            tokenPreview={tokenPreview}
            connectionMessage={connectionMessage}
            testing={testing}
            onTestConnection={testConnection}
            onConfirmUnbind={() => setConfirmUnbind(true)}
          />

          <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)_310px] gap-4 items-start">
            <AiPanel
              rawText={aiRawText}
              cleanedText={cleanedAiText}
              onRawTextChange={setAiRawText}
              onApply={applyAiToForm}
              onClean={() => {
                const cleaned = sanitizeAiOutput(aiRawText);
                setCleanedAiText(cleaned);
                setLastAction("大模型输出已清理");
              }}
            />
            <ProductFormPanel form={form} setForm={setForm} />
            <SyncPanel
              form={form}
              syncState={syncState}
              lastAction={lastAction}
              shopifyProductUrl={shopifyProductUrl}
              warnings={syncWarnings}
              onSaveDraft={saveDraft}
              onSync={syncToShopify}
            />
          </div>
        </div>
      )}

      <Dialog
        open={confirmUnbind}
        onClose={() => setConfirmUnbind(false)}
        title="确认解除 Shopify 绑定？"
        description="解除后将删除本地保存的店铺域名和 Access Token，产品上架功能将暂停同步到 Shopify。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmUnbind(false)}>
              取消
            </Button>
            <Button variant="danger" loading={unbinding} onClick={unbindShopify}>
              确认解除
            </Button>
          </>
        }
      >
        <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">
          解除绑定只影响 Shopify 连接信息，不会删除当前页面已经填写的商品草稿。
        </div>
      </Dialog>
    </main>
  );
}

function UnboundView({
  shopDomain,
  accessToken,
  tokenPreview,
  connectionMessage,
  testing,
  savingBinding,
  onShopDomainChange,
  onAccessTokenChange,
  onFillTestCredentials,
  onTestConnection,
  onSaveBinding,
}: {
  shopDomain: string;
  accessToken: string;
  tokenPreview: string;
  connectionMessage: string | null;
  testing: boolean;
  savingBinding: boolean;
  onShopDomainChange: (value: string) => void;
  onAccessTokenChange: (value: string) => void;
  onFillTestCredentials: () => void;
  onTestConnection: () => void;
  onSaveBinding: () => void;
}) {
  return (
    <div className="min-h-[520px] flex items-center justify-center">
      <Card elevated padding="lg" className="w-full max-w-3xl">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="md:w-[260px] shrink-0">
            <div className="w-11 h-11 rounded-md bg-[var(--brand-50-bg)] text-brand-400 flex items-center justify-center mb-4">
              <KeyRound size={20} strokeWidth={2.2} />
            </div>
            <h2 className="text-lg font-semibold text-fg-primary">
              请绑定 Shopify 密钥
            </h2>
            <p className="mt-2 text-sm text-fg-tertiary leading-relaxed">
              保存时会先连接 Shopify Admin API 验证店铺，验证通过后再把 Token 加密保存到本地数据库。
            </p>
            <button
              type="button"
              onClick={onFillTestCredentials}
              className="mt-3 text-xs font-medium text-brand-400 hover:text-brand-600"
            >
              填入测试密钥
            </button>
            <div className="mt-4 rounded-md border border-border-subtle bg-bg-tertiary p-3 text-xs text-fg-secondary space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span>连接状态</span>
                <Chip tone="warn">未绑定</Chip>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Token 预览</span>
                <span className="font-mono text-[11px]">{tokenPreview}</span>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-3">
            <Input
              label="店铺域名"
              value={shopDomain}
              onChange={(e) => onShopDomainChange(e.target.value)}
              placeholder="xxx.myshopify.com"
              leftAddon={<Store size={14} />}
            />
            <Input
              label="Admin API Access Token"
              value={accessToken}
              onChange={(e) => onAccessTokenChange(e.target.value)}
              placeholder="shpat_..."
              type="password"
              leftAddon={<KeyRound size={14} />}
            />
            {connectionMessage ? (
              <div className="rounded-md border border-border-subtle bg-bg-tertiary px-3 py-2 text-xs text-fg-secondary">
                {connectionMessage}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="secondary"
                leftIcon={<KeyRound size={14} />}
                onClick={onFillTestCredentials}
              >
                测试密钥
              </Button>
              <Button
                variant="outline"
                leftIcon={<Link size={14} />}
                loading={testing}
                onClick={onTestConnection}
              >
                测试连接
              </Button>
              <Button
                variant="primary"
                leftIcon={<Save size={14} />}
                loading={savingBinding}
                onClick={onSaveBinding}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function BoundStatusCard({
  binding,
  tokenPreview,
  connectionMessage,
  testing,
  onTestConnection,
  onConfirmUnbind,
}: {
  binding: ShopifyBinding;
  tokenPreview: string;
  connectionMessage: string | null;
  testing: boolean;
  onTestConnection: () => void;
  onConfirmUnbind: () => void;
}) {
  return (
    <Card padding="md">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-md bg-[var(--success-bg)] text-success flex items-center justify-center shrink-0">
            <CheckCircle2 size={17} strokeWidth={2.2} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-fg-primary">
                Shopify 已绑定
              </h2>
              <Chip tone="success">可同步</Chip>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-tertiary">
              <span>店铺域名：{binding.shopDomain}</span>
              <span>Access Token：{tokenPreview}</span>
              <span>绑定时间：{formatUnixTime(binding.createdAt)}</span>
              {binding.shopName ? <span>店铺名称：{binding.shopName}</span> : null}
              {binding.primaryDomain ? <span>主域名：{binding.primaryDomain}</span> : null}
            </div>
            {connectionMessage ? (
              <div className="mt-2 text-xs text-fg-secondary">
                {connectionMessage}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Link size={13} />}
            loading={testing}
            onClick={onTestConnection}
          >
            测试连接
          </Button>
          <Button
            variant="danger-outline"
            size="sm"
            onClick={onConfirmUnbind}
          >
            解除绑定
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AiPanel({
  rawText,
  cleanedText,
  onRawTextChange,
  onApply,
  onClean,
}: {
  rawText: string;
  cleanedText: string;
  onRawTextChange: (value: string) => void;
  onApply: () => void;
  onClean: () => void;
}) {
  return (
    <Card padding="md" className="space-y-4">
      <CardHeader
        title="大模型文字输出"
        subtitle="粘贴完整输出，系统会清理并映射到右侧商品字段"
        action={<Chip tone="brand">输入源</Chip>}
      />

      <Textarea
        label="完整大模型输出"
        value={rawText}
        onChange={(e) => onRawTextChange(e.target.value)}
        placeholder="粘贴标题、描述、颜色、材质、SKU、价格等完整输出"
        rows={12}
      />

      <div className="rounded-md border border-border-subtle bg-bg-tertiary p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-medium text-fg-tertiary">
            清理后预览
          </div>
          <Chip tone={cleanedText ? "success" : "gray"}>
            {cleanedText ? `${cleanedText.length} 字符` : "待清理"}
          </Chip>
        </div>
        <div className="mt-2 max-h-[180px] overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-fg-secondary">
          {cleanedText || "清理后会去除多余空格、乱码、无效控制字符，并保留可识别字段。"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          leftIcon={<RefreshCw size={13} />}
          onClick={onClean}
        >
          清理文字
        </Button>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<ArrowRight size={13} />}
          onClick={onApply}
        >
          填入表单
        </Button>
      </div>
    </Card>
  );
}

function ProductFormPanel({
  form,
  setForm,
}: {
  form: ProductForm;
  setForm: React.Dispatch<React.SetStateAction<ProductForm>>;
}) {
  function update<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <Card padding="md">
      <CardHeader
        title="Shopify 商品字段"
        subtitle="按 Shopify 商品编辑页结构组织，确认后再同步"
        action={<Chip tone="gray">草稿表单</Chip>}
      />

      <div className="space-y-5">
        <section className="space-y-3">
          <SectionTitle icon={<FileText size={14} />}>基础信息</SectionTitle>
          <Input
            label="标题 Title"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="商品标题"
          />
          <Textarea
            label="描述 Description"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="商品卖点、款式、面料、适用场景"
            rows={5}
          />
        </section>

        <section className="space-y-3">
          <SectionTitle icon={<ImageIcon size={14} />}>媒体 Media</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            {["主图", "细节", "背面"].map((label) => (
              <div
                key={label}
                className="aspect-[4/5] rounded-md border border-dashed border-border-subtle bg-bg-tertiary flex flex-col items-center justify-center text-xs text-fg-tertiary"
              >
                <ImageIcon size={18} strokeWidth={1.8} />
                <span className="mt-2">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <SectionTitle icon={<Tags size={14} />}>分类与属性</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="产品类型 Product type"
              value={form.productType}
              onChange={(e) => update("productType", e.target.value)}
              placeholder="Prom Dress"
            />
            <Input
              label="供应商 Vendor"
              value={form.vendor}
              onChange={(e) => update("vendor", e.target.value)}
              placeholder="BUQIQI"
            />
            <Input
              label="颜色 Color"
              value={form.color}
              onChange={(e) => update("color", e.target.value)}
            />
            <Input
              label="面料 Material"
              value={form.material}
              onChange={(e) => update("material", e.target.value)}
            />
            <Input
              label="领口 Neckline"
              value={form.neckline}
              onChange={(e) => update("neckline", e.target.value)}
            />
            <Input
              label="版型 Silhouette"
              value={form.silhouette}
              onChange={(e) => update("silhouette", e.target.value)}
            />
          </div>
          <Input
            label="标签 Tags"
            value={form.tags}
            onChange={(e) => update("tags", e.target.value)}
            placeholder="用逗号分隔"
          />
        </section>

        <section className="space-y-3">
          <SectionTitle icon={<ShoppingBag size={14} />}>变体、价格与库存</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input
              label="SKU"
              value={form.sku}
              onChange={(e) => update("sku", e.target.value)}
            />
            <Input
              label="价格"
              value={form.price}
              onChange={(e) => update("price", e.target.value)}
              placeholder="0.00"
            />
            <Input
              label="库存"
              value={form.inventory}
              onChange={(e) => update("inventory", e.target.value)}
              placeholder="0"
            />
            <Select
              label="状态"
              value={form.status}
              onChange={(e) => update("status", e.target.value as ProductForm["status"])}
            >
              <option value="DRAFT">草稿 Draft</option>
              <option value="ACTIVE">发布 Active</option>
            </Select>
          </div>
        </section>

        <section className="space-y-3">
          <SectionTitle icon={<ExternalLink size={14} />}>SEO</SectionTitle>
          <Input
            label="SEO 标题"
            value={form.seoTitle}
            onChange={(e) => update("seoTitle", e.target.value)}
          />
          <Textarea
            label="SEO 描述"
            value={form.seoDescription}
            onChange={(e) => update("seoDescription", e.target.value)}
            rows={3}
          />
        </section>
      </div>
    </Card>
  );
}

function SyncPanel({
  form,
  syncState,
  lastAction,
  shopifyProductUrl,
  warnings,
  onSaveDraft,
  onSync,
}: {
  form: ProductForm;
  syncState: SyncState;
  lastAction: string;
  shopifyProductUrl: string | null;
  warnings: string[];
  onSaveDraft: () => void;
  onSync: () => void;
}) {
  const completed = [
    Boolean(form.title.trim()),
    Boolean(form.description.trim()),
    Boolean(form.productType.trim()),
    Boolean(form.price.trim()),
    Boolean(form.sku.trim()),
  ].filter(Boolean).length;

  const status = {
    idle: { label: "未同步", tone: "gray" as const, icon: <Clock size={13} /> },
    draft: { label: "本地草稿", tone: "brand" as const, icon: <Save size={13} /> },
    syncing: { label: "同步中", tone: "warn" as const, icon: <RefreshCw size={13} className="animate-spin" /> },
    synced: { label: "已同步", tone: "success" as const, icon: <CheckCircle2 size={13} /> },
  }[syncState];

  return (
    <div className="space-y-4">
      <Card padding="md">
        <CardHeader
          title="同步状态"
          subtitle="先确认字段，再同步到 Shopify"
          action={<Chip tone={status.tone} icon={status.icon}>{status.label}</Chip>}
        />
        <div className="space-y-3">
          <div className="rounded-md border border-border-subtle bg-bg-tertiary p-3">
            <div className="flex items-center justify-between text-xs text-fg-tertiary">
              <span>必填字段完成度</span>
              <span>{completed}/5</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(completed / 5) * 100}%`,
                  background: "var(--brand-gradient)",
                }}
              />
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <CheckRow ok={Boolean(form.title.trim())} label="标题已填写" />
            <CheckRow ok={Boolean(form.description.trim())} label="描述已填写" />
            <CheckRow ok={Boolean(form.productType.trim())} label="产品类型已填写" />
            <CheckRow ok={Boolean(form.sku.trim())} label="SKU 已填写" />
            <CheckRow ok={Boolean(form.price.trim())} label="价格已填写" />
          </div>

          <div className="rounded-md bg-[var(--brand-50-bg)] border border-[rgba(99,102,241,0.22)] p-3 text-xs text-fg-secondary">
            {lastAction}
          </div>

          {warnings.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 space-y-1">
              {warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}

          {shopifyProductUrl ? (
            <a
              href={shopifyProductUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2 text-xs text-brand-400 hover:bg-[var(--brand-50-bg)] transition-colors"
            >
              <span>打开 Shopify 商品页面</span>
              <ExternalLink size={13} />
            </a>
          ) : null}

          <div className="grid grid-cols-1 gap-2">
            <Button
              variant="outline"
              leftIcon={<Save size={14} />}
              onClick={onSaveDraft}
            >
              保存草稿
            </Button>
            <Button
              variant="primary"
              leftIcon={<Send size={14} />}
              loading={syncState === "syncing"}
              disabled={completed < 3}
              onClick={onSync}
            >
              同步到 Shopify
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="md">
        <CardHeader title="字段映射" subtitle="AI 字段会写入对应 Shopify 字段" />
        <div className="space-y-2 text-xs">
          <Mapping from="商品标题" to="Title" />
          <Mapping from="商品描述" to="Description" />
          <Mapping from="主色调 / 面料" to="Tags / Metafields" />
          <Mapping from="SKU / 价格 / 库存" to="Variant" />
          <Mapping from="产品图" to="Media" />
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-700">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>同步会在 Shopify 后台创建商品，并返回可打开的商品编辑页面链接。</span>
        </div>
      </Card>
    </div>
  );
}

function AiField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-tertiary px-3 py-2">
      <div className="text-[11px] text-fg-tertiary">{label}</div>
      <div className="mt-0.5 text-xs text-fg-primary line-clamp-2">{value}</div>
    </div>
  );
}

function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-fg-primary">
      <span className="text-fg-tertiary">{icon}</span>
      {children}
    </div>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-fg-secondary">{label}</span>
      {ok ? (
        <CheckCircle2 size={14} strokeWidth={2.2} className="text-success" />
      ) : (
        <Clock size={14} strokeWidth={2} className="text-fg-tertiary" />
      )}
    </div>
  );
}

function Mapping({ from, to }: { from: string; to: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle px-2.5 py-2">
      <span className="text-fg-secondary">{from}</span>
      <span className="font-medium text-fg-primary">{to}</span>
    </div>
  );
}
