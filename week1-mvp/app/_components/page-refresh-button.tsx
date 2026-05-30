"use client";

import { RefreshCw } from "lucide-react";

export function PageRefreshButton({
  onClick,
  title = "刷新页面",
  ariaLabel = title,
}: {
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick || (() => window.location.reload())}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-subtle bg-bg-secondary text-fg-tertiary transition-colors hover:bg-bg-hover hover:text-fg-primary"
      title={title}
      aria-label={ariaLabel}
    >
      <RefreshCw size={15} strokeWidth={2.2} />
    </button>
  );
}
