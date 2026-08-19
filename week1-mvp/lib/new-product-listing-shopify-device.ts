import type { NextRequest } from "next/server";

export const SHOPIFY_DEVICE_ID_HEADER = "x-buqiqi-new-product-listing-device-id";

const SHOPIFY_DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{12,96}$/;

export function normalizeShopifyDeviceId(value: string | null | undefined) {
  const deviceId = String(value || "").trim();
  if (!SHOPIFY_DEVICE_ID_PATTERN.test(deviceId)) {
    const error = new Error("缺少本机 Shopify 绑定标识，请刷新页面后重试。") as Error & {
      status?: number;
    };
    error.status = 400;
    throw error;
  }
  return deviceId;
}

export function getShopifyDeviceIdFromRequest(req: NextRequest) {
  return normalizeShopifyDeviceId(req.headers.get(SHOPIFY_DEVICE_ID_HEADER));
}
