"use client";

import {
  DragEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * 文件拖放 + 点击 + Ctrl+V 粘贴 三合一
 *
 * 设计动机：
 *   - 旧版 batch-photo 的"选择文件"按钮太低效
 *   - 用户常希望剪贴板里 copy 的图能直接粘贴进来
 *   - 完整的拖拽 + 粘贴是设计 demo 里的核心交互
 *
 * 用法：
 *   <Dropzone
 *     accept="image/*"
 *     multiple
 *     onFiles={(files) => uploadFiles(files)}
 *     icon={<Upload size={28}/>}
 *     title="上传产品图"
 *     description="拖拽 / 点击 / Ctrl+V 粘贴"
 *   />
 *
 *   // 单图模式 + hover 粘贴 (用于批量摄影槽位)
 *   <Dropzone
 *     compact
 *     onFiles={(files) => setSlot(files[0])}
 *   >
 *     {slot ? <img src={URL.createObjectURL(slot)}/> : <span>+</span>}
 *   </Dropzone>
 *
 * Ctrl+V 行为：
 *   - 当组件 hover 或 focus 时，监听 window paste 事件
 *   - 多个 dropzone 同时 hover 不会冲突（用最近 hover 的一个）
 */

export interface DropzoneProps {
  accept?: string;
  multiple?: boolean;
  /** 任意文件入口（拖拽 / 选择 / 粘贴）都汇聚到这里 */
  onFiles: (files: File[]) => void;
  /**
   * 是否额外渲染"选择文件夹"按钮。开启后用户能选整个文件夹，
   * 上传时浏览器会递归收集所有图片，并保留 file.webkitRelativePath。
   * 调用方可以从第一张图的 webkitRelativePath 抠出文件夹名（仅 Chrome / Edge / 新版 FF 支持）。
   */
  enableDirectoryPicker?: boolean;
  /** 紧凑模式：用作槽位（小尺寸、children 自渲染）*/
  compact?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 主图标（compact 模式下不显示）*/
  icon?: ReactNode;
  /** 主标题 */
  title?: string;
  /** 副标题 */
  description?: string;
  /** 自定义内容（compact / 已上传时常用）*/
  children?: ReactNode;
  className?: string;
  /** 受 hover/focus 时是否激活 paste 监听。默认 true */
  pasteEnabled?: boolean;
}

/**
 * 从一组文件里抠出共同的根文件夹名（基于 webkitRelativePath）。
 * 没有 webkitRelativePath（普通拖拽 / 单图）时返回 null。
 *
 * 例：
 *   files = [{ webkitRelativePath: "DRESS-001/front.jpg" }, ...]
 *   → "DRESS-001"
 */
export function extractFolderName(files: File[]): string | null {
  for (const f of files) {
    const rel = (f as File & { webkitRelativePath?: string })
      .webkitRelativePath;
    if (rel && rel.includes("/")) {
      return rel.split("/")[0] || null;
    }
  }
  return null;
}

export function Dropzone({
  accept = "image/*",
  multiple = false,
  onFiles,
  enableDirectoryPicker = false,
  compact = false,
  disabled = false,
  icon,
  title = "拖拽或点击上传",
  description = "支持 Ctrl+V 粘贴",
  children,
  className = "",
  pasteEnabled = true,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [hover, setHover] = useState(false);

  const handlePick = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const handlePickFolder = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (disabled) return;
      dirInputRef.current?.click();
    },
    [disabled],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files || []).filter((f) =>
        matchAccept(f, accept),
      );
      if (files.length === 0) return;
      onFiles(multiple ? files : files.slice(0, 1));
    },
    [accept, disabled, multiple, onFiles],
  );

  // ── Ctrl+V 粘贴：仅当组件 hover / focus 时响应 ──
  useEffect(() => {
    if (!pasteEnabled || disabled) return;
    if (!hover) return;

    function onPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items || []);
      const fileItems = items
        .filter((it) => it.kind === "file")
        .map((it) => it.getAsFile())
        .filter((f): f is File => f !== null && matchAccept(f, accept));
      if (fileItems.length === 0) return;
      e.preventDefault();
      onFiles(multiple ? fileItems : fileItems.slice(0, 1));
    }

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [hover, pasteEnabled, disabled, accept, multiple, onFiles]);

  const baseClass = compact
    ? "relative rounded-md border-2 border-dashed transition-all"
    : "relative rounded-lg border-2 border-dashed transition-all";

  const stateClass = disabled
    ? "border-border-subtle bg-bg-tertiary opacity-60 cursor-not-allowed"
    : dragOver
      ? "border-brand-500 bg-[var(--brand-50-bg)] cursor-pointer"
      : hover
        ? "border-border-strong bg-bg-hover cursor-pointer"
        : "border-border-default bg-bg-card cursor-pointer";

  const sizeClass = compact ? "" : "px-8 py-12";

  return (
    <div
      ref={rootRef}
      tabIndex={disabled ? -1 : 0}
      onClick={handlePick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handlePick();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        // 仅当离开根元素时才清除（子元素冒泡不算）
        if (rootRef.current && !rootRef.current.contains(e.relatedTarget as Node)) {
          setDragOver(false);
        }
      }}
      onDrop={handleDrop}
      className={`${baseClass} ${stateClass} ${sizeClass} ${className}`}
      role="button"
      aria-disabled={disabled}
      aria-label={title}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) onFiles(files);
          e.target.value = ""; // 允许重传同一文件
        }}
      />
      {enableDirectoryPicker ? (
        <input
          ref={dirInputRef}
          type="file"
          // @ts-expect-error: webkitdirectory is non-standard but works in Chrome/Edge/FF
          webkitdirectory=""
          directory=""
          multiple
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            const all = Array.from(e.target.files || []);
            // 文件夹模式可能选到非图片文件，过滤一下
            const imgs = all.filter((f) => matchAccept(f, accept));
            if (imgs.length > 0) onFiles(imgs);
            e.target.value = "";
          }}
        />
      ) : null}

      {children ?? (
        <div className="flex flex-col items-center text-center">
          {icon ? (
            <div className="w-16 h-16 rounded-md bg-bg-tertiary border border-border-subtle flex items-center justify-center text-fg-tertiary mb-5">
              {icon}
            </div>
          ) : null}
          <div className="text-[15px] font-semibold text-fg-primary mb-1.5">
            {title}
          </div>
          <div className="text-[12px] text-fg-tertiary">{description}</div>
          {enableDirectoryPicker && !disabled ? (
            <button
              type="button"
              onClick={handlePickFolder}
              className="mt-3 px-3 py-1.5 text-[11px] rounded-md border border-border-default text-fg-secondary hover:border-brand-500 hover:text-brand-400 hover:bg-[var(--brand-50-bg)] transition-colors"
            >
              📁 选择整个文件夹
            </button>
          ) : null}
        </div>
      )}

      {/* hover 提示：可粘贴 */}
      {!compact && hover && pasteEnabled && !disabled ? (
        <div className="absolute top-2 right-3 text-[10px] text-fg-tertiary opacity-70">
          按 Ctrl+V 粘贴
        </div>
      ) : null}
    </div>
  );
}

function matchAccept(file: File, accept: string): boolean {
  if (!accept || accept === "*") return true;
  const types = accept.split(",").map((s) => s.trim());
  return types.some((t) => {
    if (t.endsWith("/*")) return file.type.startsWith(t.slice(0, -1));
    if (t.startsWith(".")) return file.name.toLowerCase().endsWith(t.toLowerCase());
    return file.type === t;
  });
}
