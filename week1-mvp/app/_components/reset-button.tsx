"use client";

import { useState } from "react";

export interface ResetButtonProps {
  /** 主按钮文字。默认 "清空当前任务" */
  label?: string;
  /** 确认弹窗文字 */
  confirmTitle?: string;
  confirmDetail?: string;
  /** 确认按钮文字 */
  confirmText?: string;
  /** 取消按钮文字 */
  cancelText?: string;
  /** 点击确认后执行 */
  onConfirm: () => void;
  /** 是否禁用（比如正在生成中不允许重置） */
  disabled?: boolean;
  /** 尺寸 */
  size?: "sm" | "md";
  /** 样式变体：ghost（透明）/ outline（边框）/ solid（填色） */
  variant?: "ghost" | "outline" | "solid";
}

/**
 * 重置按钮
 *
 * 带二次确认弹窗，避免误触。
 * 点击主按钮 → 弹 modal → 点"确认" → 执行 onConfirm。
 */
export function ResetButton({
  label = "清空当前任务",
  confirmTitle = "确定要清空当前任务吗？",
  confirmDetail = "已上传的图片、解析结果、选择的预设将全部清除。此操作不可撤销。",
  confirmText = "确认清空",
  cancelText = "取消",
  onConfirm,
  disabled = false,
  size = "md",
  variant = "outline",
}: ResetButtonProps) {
  const [open, setOpen] = useState(false);

  const sizeClass =
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  const variantClass = {
    ghost: "text-gray-600 hover:text-gray-900 hover:bg-gray-100",
    outline:
      "border border-gray-300 text-gray-700 hover:border-red-400 hover:text-red-700 hover:bg-red-50",
    solid: "bg-red-600 text-white hover:bg-red-700",
  }[variant];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`${sizeClass} ${variantClass} rounded-md inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
      >
        <span aria-hidden>⟲</span>
        <span>{label}</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="bg-white rounded-lg max-w-md w-full shadow-xl">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">{confirmTitle}</h3>
            </div>
            <div className="px-5 py-4 text-sm text-gray-600 leading-relaxed">
              {confirmDetail}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-1.5 text-sm text-gray-600 rounded-md hover:bg-gray-100"
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onConfirm();
                }}
                className="px-4 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                {confirmText}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
