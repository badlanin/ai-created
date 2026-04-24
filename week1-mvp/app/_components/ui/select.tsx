"use client";

import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: "sm" | "md";
  label?: string;
  hint?: string;
  error?: string;
}

/**
 * 统一原生 Select（保持无障碍，一致样式）
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    { size = "md", label, hint, error, className = "", children, ...rest },
    ref,
  ) {
    const sz =
      size === "sm"
        ? "px-2.5 py-1 text-xs h-7 pr-7"
        : "px-3 py-1.5 text-sm h-9 pr-8";
    return (
      <div className={className}>
        {label ? (
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {label}
          </label>
        ) : null}
        <div className="relative">
          <select
            ref={ref}
            className={`
              appearance-none w-full
              ${sz}
              rounded-md border
              ${error ? "border-red-400" : "border-gray-300"}
              bg-white text-gray-900
              transition-colors
              hover:border-gray-400
              focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100
              disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed
            `}
            {...rest}
          >
            {children}
          </select>
          <ChevronDown
            size={size === "sm" ? 12 : 14}
            strokeWidth={2}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
        </div>
        {hint && !error ? (
          <p className="mt-1 text-[11px] text-gray-400">{hint}</p>
        ) : null}
        {error ? (
          <p className="mt-1 text-[11px] text-red-600">{error}</p>
        ) : null}
      </div>
    );
  },
);

/**
 * 输入框（包装原生 input）
 */
export const Input = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
    size?: "sm" | "md";
    label?: string;
    hint?: string;
    error?: string;
    leftAddon?: React.ReactNode;
    rightAddon?: React.ReactNode;
  }
>(function Input(
  {
    size = "md",
    label,
    hint,
    error,
    leftAddon,
    rightAddon,
    className = "",
    ...rest
  },
  ref,
) {
  const sz =
    size === "sm" ? "px-2.5 py-1 text-xs h-7" : "px-3 py-1.5 text-sm h-9";
  return (
    <div className={className}>
      {label ? (
        <label className="block text-xs font-medium text-gray-600 mb-1">
          {label}
        </label>
      ) : null}
      <div className="relative flex items-center">
        {leftAddon ? (
          <span className="absolute left-2.5 text-gray-400 pointer-events-none">
            {leftAddon}
          </span>
        ) : null}
        <input
          ref={ref}
          className={`
            w-full ${sz}
            ${leftAddon ? "pl-8" : ""}
            ${rightAddon ? "pr-8" : ""}
            rounded-md border
            ${error ? "border-red-400" : "border-gray-300"}
            bg-white text-gray-900 placeholder-gray-400
            transition-colors
            hover:border-gray-400
            focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100
            disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed
          `}
          {...rest}
        />
        {rightAddon ? (
          <span className="absolute right-2.5 text-gray-400 pointer-events-none">
            {rightAddon}
          </span>
        ) : null}
      </div>
      {hint && !error ? (
        <p className="mt-1 text-[11px] text-gray-400">{hint}</p>
      ) : null}
      {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
});

/**
 * 文本域
 */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    label?: string;
    hint?: string;
    error?: string;
  }
>(function Textarea({ label, hint, error, className = "", ...rest }, ref) {
  return (
    <div className={className}>
      {label ? (
        <label className="block text-xs font-medium text-gray-600 mb-1">
          {label}
        </label>
      ) : null}
      <textarea
        ref={ref}
        className={`
          w-full px-3 py-2 text-sm rounded-md border resize-none
          ${error ? "border-red-400" : "border-gray-300"}
          bg-white text-gray-900 placeholder-gray-400
          transition-colors
          hover:border-gray-400
          focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100
          disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed
        `}
        {...rest}
      />
      {hint && !error ? (
        <p className="mt-1 text-[11px] text-gray-400">{hint}</p>
      ) : null}
      {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
});
