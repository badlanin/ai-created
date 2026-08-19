import fs from "fs/promises";
import path from "path";

type ShopifyOAuthCredentials = {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
};

function clean(value?: string | null) {
  return String(value || "").trim();
}

function normalizeShopDomainForEnv(value: string) {
  const host = clean(value)
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]
    ?.trim()
    .toLowerCase();
  if (!host || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(host)) {
    throw new Error("店铺域名需填写 xxx.myshopify.com");
  }
  return host;
}

function shopEnvPrefix(shopDomain: string) {
  return normalizeShopDomainForEnv(shopDomain)
    .replace(/[^a-z0-9]/gi, "_")
    .replace(/_+/g, "_")
    .toUpperCase();
}

function envPath() {
  return path.join(process.cwd(), ".env.local");
}

function persistentEnvPath() {
  return path.join(
    process.env.DATA_DIR || path.join(process.cwd(), "data"),
    "new-product-listing-shopify-oauth.env",
  );
}

async function readTextFile(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function readEnvLocalText() {
  return readTextFile(envPath());
}

async function readCredentialEnvText() {
  return [await readEnvLocalText(), await readTextFile(persistentEnvPath())]
    .filter(Boolean)
    .join("\n");
}

function parseEnvText(text: string) {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values.set(match[1], match[2].replace(/^['"]|['"]$/g, "").trim());
  }
  return values;
}

function quoteEnvValue(value: string) {
  if (/^[A-Za-z0-9_./:@-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

export async function readShopifyOAuthCredentials(shopDomain: string): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const prefix = shopEnvPrefix(shopDomain);
  const text = await readCredentialEnvText();
  const fileValues = parseEnvText(text);
  const clientId =
    clean(fileValues.get(`SHOPIFY_OAUTH_${prefix}_CLIENT_ID`)) ||
    clean(fileValues.get("SHOPIFY_CLIENT_ID")) ||
    clean(fileValues.get("SHOPIFY_API_KEY")) ||
    clean(fileValues.get("SHOPIFY_APP_CLIENT_ID")) ||
    clean(process.env[`SHOPIFY_OAUTH_${prefix}_CLIENT_ID`]) ||
    clean(process.env.SHOPIFY_CLIENT_ID) ||
    clean(process.env.SHOPIFY_API_KEY) ||
    clean(process.env.SHOPIFY_APP_CLIENT_ID);
  const clientSecret =
    clean(fileValues.get(`SHOPIFY_OAUTH_${prefix}_CLIENT_SECRET`)) ||
    clean(fileValues.get("SHOPIFY_CLIENT_SECRET")) ||
    clean(fileValues.get("SHOPIFY_API_SECRET")) ||
    clean(fileValues.get("SHOPIFY_APP_CLIENT_SECRET")) ||
    clean(process.env[`SHOPIFY_OAUTH_${prefix}_CLIENT_SECRET`]) ||
    clean(process.env.SHOPIFY_CLIENT_SECRET) ||
    clean(process.env.SHOPIFY_API_SECRET) ||
    clean(process.env.SHOPIFY_APP_CLIENT_SECRET);
  return { clientId, clientSecret };
}

export async function saveShopifyOAuthCredentials(
  input: ShopifyOAuthCredentials,
) {
  const shopDomain = normalizeShopDomainForEnv(input.shopDomain);
  const clientId = clean(input.clientId);
  const clientSecret = clean(input.clientSecret);
  if (!clientId || !clientSecret) return { written: false };

  const prefix = shopEnvPrefix(shopDomain);
  const clientIdKey = `SHOPIFY_OAUTH_${prefix}_CLIENT_ID`;
  const clientSecretKey = `SHOPIFY_OAUTH_${prefix}_CLIENT_SECRET`;
  const filePath = persistentEnvPath();
  const text = await readTextFile(filePath);
  const lines = text ? text.replace(/\r\n/g, "\n").split("\n") : [];
  const values = parseEnvText(text);
  const same =
    clean(values.get(clientIdKey)) === clientId &&
    clean(values.get(clientSecretKey)) === clientSecret;
  if (same) return { written: false };

  const nextLines = lines.filter(
    (line) =>
      !new RegExp(`^\\s*${clientIdKey}\\s*=`).test(line) &&
      !new RegExp(`^\\s*${clientSecretKey}\\s*=`).test(line),
  );
  const hasContent = nextLines.some((line) => line.trim());
  if (hasContent && nextLines[nextLines.length - 1]?.trim()) nextLines.push("");
  nextLines.push(`# Shopify OAuth credentials for ${shopDomain}`);
  nextLines.push(`${clientIdKey}=${quoteEnvValue(clientId)}`);
  nextLines.push(`${clientSecretKey}=${quoteEnvValue(clientSecret)}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${nextLines.join("\n").replace(/\n+$/g, "")}\n`, "utf8");
  return { written: true };
}
