"use client";

export const SHOPIFY_DEVICE_ID_HEADER = "x-buqiqi-device-id";

const SHOPIFY_DEVICE_ID_STORAGE_KEY =
  "buqiqi_product_listing_shopify_device_id_v1";
const SHOPIFY_DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{12,96}$/;

let memoryDeviceId: string | null = null;

function createShopifyDeviceId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return `pl_${window.crypto.randomUUID()}`;
  }
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function getShopifyDeviceId() {
  if (memoryDeviceId && SHOPIFY_DEVICE_ID_PATTERN.test(memoryDeviceId)) {
    return memoryDeviceId;
  }
  if (typeof window === "undefined") {
    memoryDeviceId = createShopifyDeviceId();
    return memoryDeviceId;
  }

  try {
    const existing = window.localStorage.getItem(SHOPIFY_DEVICE_ID_STORAGE_KEY);
    if (existing && SHOPIFY_DEVICE_ID_PATTERN.test(existing)) {
      memoryDeviceId = existing;
      return existing;
    }

    const next = createShopifyDeviceId();
    window.localStorage.setItem(SHOPIFY_DEVICE_ID_STORAGE_KEY, next);
    memoryDeviceId = next;
    return next;
  } catch {
    memoryDeviceId = createShopifyDeviceId();
    return memoryDeviceId;
  }
}

export function withShopifyDeviceHeaders(headers?: HeadersInit) {
  const next = new Headers(headers);
  next.set(SHOPIFY_DEVICE_ID_HEADER, getShopifyDeviceId());
  return next;
}

export function fetchWithShopifyDevice(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  return fetch(input, {
    ...init,
    headers: withShopifyDeviceHeaders(init.headers),
  });
}
