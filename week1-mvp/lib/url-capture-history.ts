export const URL_CAPTURE_HISTORY_STORAGE_KEY =
  "buqiqi:history:url-captures";

export type UrlCaptureHistorySource = "recolor";

export interface UrlCaptureHistoryRecord {
  id: string;
  userId?: number;
  username?: string;
  displayName?: string | null;
  source: UrlCaptureHistorySource;
  sourceLabel: string;
  sourceUrl: string;
  selectedCount: number;
  addedCount: number;
  imageUrls: string[];
  thumbnailUrl: string | null;
  createdAt: number;
}

export interface UrlCaptureHistoryInput {
  userId?: number;
  username?: string;
  displayName?: string | null;
  source: UrlCaptureHistorySource;
  sourceLabel: string;
  sourceUrl: string;
  selectedCount: number;
  addedCount: number;
  imageUrls: string[];
}

export function readUrlCaptureHistory(): UrlCaptureHistoryRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(URL_CAPTURE_HISTORY_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as UrlCaptureHistoryRecord[]) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter((item) => item && typeof item.id === "string")
          .sort((a, b) => b.createdAt - a.createdAt)
      : [];
  } catch {
    return [];
  }
}

export function appendUrlCaptureHistory(input: UrlCaptureHistoryInput) {
  if (typeof window === "undefined") return [];
  const imageUrls = input.imageUrls.map((url) => url.trim()).filter(Boolean);
  const record: UrlCaptureHistoryRecord = {
    id: `url-capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId,
    username: input.username,
    displayName: input.displayName,
    source: input.source,
    sourceLabel: input.sourceLabel,
    sourceUrl: input.sourceUrl.trim(),
    selectedCount: input.selectedCount,
    addedCount: input.addedCount,
    imageUrls,
    thumbnailUrl: imageUrls[0] || null,
    createdAt: Date.now(),
  };
  const next = [record, ...readUrlCaptureHistory()].slice(0, 300);
  window.localStorage.setItem(
    URL_CAPTURE_HISTORY_STORAGE_KEY,
    JSON.stringify(next),
  );
  return next;
}

export function writeUrlCaptureHistory(records: UrlCaptureHistoryRecord[]) {
  if (typeof window === "undefined") return [];
  const next = records.slice(0, 300);
  window.localStorage.setItem(
    URL_CAPTURE_HISTORY_STORAGE_KEY,
    JSON.stringify(next),
  );
  return next;
}

export function deleteUrlCaptureHistory(ids: string[]) {
  const idSet = new Set(ids);
  return writeUrlCaptureHistory(
    readUrlCaptureHistory().filter((item) => !idSet.has(item.id)),
  );
}
