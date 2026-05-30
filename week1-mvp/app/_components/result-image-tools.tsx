"use client";

import { useEffect, type ReactNode } from "react";
import { Crop, Download, X } from "lucide-react";

export interface ResultImageAction {
  key: string;
  label: string;
  title?: string;
  icon: ReactNode;
  onClick: () => void;
  tone?: "default" | "brand";
}

export function ResultImageHoverToolbar({
  onCrop,
  onDownload,
  extraActions = [],
}: {
  onCrop: () => void;
  onDownload: () => void;
  extraActions?: ResultImageAction[];
}) {
  const actions: ResultImageAction[] = [
    ...extraActions,
    {
      key: "crop",
      label: "裁剪",
      title: "裁剪这张图",
      icon: <Crop size={13} strokeWidth={2.2} />,
      onClick: onCrop,
      tone: "brand",
    },
    {
      key: "download",
      label: "下载",
      title: "下载原图",
      icon: <Download size={13} strokeWidth={2.2} />,
      onClick: onDownload,
    },
  ];

  return (
    <div className="absolute right-2 top-2 z-20 flex flex-col gap-1.5 pointer-events-auto">
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          title={action.title || action.label}
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={[
            "inline-flex h-8 min-w-[68px] items-center justify-start gap-1.5 rounded-md border px-2 text-[12px] font-medium shadow-lg backdrop-blur transition-colors",
            action.tone === "brand"
              ? "border-brand-500/30 bg-brand-600/95 text-white hover:bg-brand-700"
              : "border-white/20 bg-bg-secondary/95 text-fg-secondary hover:bg-bg-elevated hover:text-fg-primary",
          ].join(" ")}
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}

export function OriginalImagePreview({
  src,
  alt,
  title = "原图预览",
  onClose,
}: {
  src: string;
  alt?: string;
  title?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/85"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-white">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          {alt ? (
            <div className="mt-0.5 truncate text-[11px] text-white/60">
              {alt}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
          title="关闭"
        >
          <X size={16} strokeWidth={2.2} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt || title}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      </div>
    </div>
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objUrl);
}

export function makeCroppedFilename(filename: string, extension = "jpg"): string {
  const clean = filename.trim() || `cropped_${Date.now()}.jpg`;
  const ext = extension.replace(/^\./, "") || "jpg";
  const dot = clean.lastIndexOf(".");
  if (dot > 0) {
    return `${clean.slice(0, dot)}_cropped.${ext}`;
  }
  return `${clean}_cropped.${ext}`;
}
