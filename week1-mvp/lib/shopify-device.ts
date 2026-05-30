export const SHOPIFY_DEVICE_HEADER = "x-buqiqi-device-key";
export const DEFAULT_SHOPIFY_DEVICE_KEY = "legacy-global";

export function normalizeShopifyDeviceKey(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return DEFAULT_SHOPIFY_DEVICE_KEY;
  const cleaned = raw.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 96);
  return cleaned || DEFAULT_SHOPIFY_DEVICE_KEY;
}
