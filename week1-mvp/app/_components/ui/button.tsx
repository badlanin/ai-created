"use client";

import { forwardRef } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "danger-outline";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
}

/**
 * 统一按钮
 *
 * 用法：
 *   <Button variant="primary" leftIcon={<Plus size={14}/>}>添加</Button>
 *   <Button variant="outline" size="sm">取消</Button>
 *   <Button variant="danger" loading={saving}>删除</Button>
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      loading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      className = "",
      children,
      type = "button",
      ...rest
    },
    ref,
  ) {
    const variantClass = `btn-${variant}`;
    const sizeClass = `btn-${size}`;
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={`btn ${variantClass} ${sizeClass} ${fullWidth ? "w-full" : ""} ${className}`}
        {...rest}
      >
        {loading ? (
          <span
            className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin opacity-70"
            aria-hidden
          />
        ) : leftIcon ? (
          <span className="inline-flex items-center" aria-hidden>
            {leftIcon}
          </span>
        ) : null}
        {children ? <span>{children}</span> : null}
        {rightIcon && !loading ? (
          <span className="inline-flex items-center" aria-hidden>
            {rightIcon}
          </span>
        ) : null}
      </button>
    );
  },
);

/**
 * 纯 icon 按钮（正方形，无 padding 副作用）
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "leftIcon" | "rightIcon" | "children"> & {
    icon: React.ReactNode;
    "aria-label": string;
  }
>(function IconButton(
  { icon, size = "md", variant = "ghost", className = "", ...rest },
  ref,
) {
  const sideBySize = size === "sm" ? "w-7 h-7" : size === "lg" ? "w-10 h-10" : "w-8 h-8";
  return (
    <button
      ref={ref}
      type="button"
      className={`btn btn-${variant} ${sideBySize} !p-0 ${className}`}
      {...rest}
    >
      {icon}
    </button>
  );
});
