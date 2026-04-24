"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { IconButton } from "./button";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  /** 最大宽度。默认 max-w-md */
  width?: "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
}

const WIDTH_MAP = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

/**
 * 统一 modal 弹窗
 *
 *   <Dialog open={open} onClose={close} title="删除这条记录?" footer={
 *     <>
 *       <Button variant="ghost" onClick={close}>取消</Button>
 *       <Button variant="danger" onClick={confirm}>删除</Button>
 *     </>
 *   }>
 *     删除后无法撤销，请确认。
 *   </Dialog>
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  width = "md",
  children,
}: DialogProps) {
  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 开启时禁止 body 滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 animate-[fadeIn_120ms_ease-out]"
      style={{
        zIndex: 70,
        background: "rgba(17, 24, 39, 0.4)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`bg-white rounded-2xl shadow-xl w-full ${WIDTH_MAP[width]} flex flex-col max-h-[calc(100vh-2rem)] overflow-hidden animate-[slideUp_180ms_cubic-bezier(0.25,1,0.5,1)]`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
          <div className="min-w-0 flex-1">
            {title ? (
              <h2 className="text-base font-semibold text-gray-900">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-sm text-gray-500">{description}</p>
            ) : null}
          </div>
          <IconButton
            icon={<X size={16} strokeWidth={2.2} />}
            aria-label="关闭"
            size="sm"
            variant="ghost"
            onClick={onClose}
          />
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 text-sm text-gray-700 leading-relaxed">
          {children}
        </div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
