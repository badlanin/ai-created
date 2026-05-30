"use client";

export interface TabItem {
  key: string;
  label: React.ReactNode;
  /** 右侧角标（数字、chip 等） */
  badge?: React.ReactNode;
  /** 禁用 */
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  /** variant: underline 经典下划线；pills 药丸式 */
  variant?: "underline" | "pills";
  className?: string;
}

/**
 * Tab 条
 *
 *   <Tabs
 *     items={[
 *       { key: "active", label: "进行中", badge: "2" },
 *       { key: "done", label: "已完成", badge: "12" },
 *     ]}
 *     value={tab}
 *     onChange={setTab}
 *   />
 */
export function Tabs({
  items,
  value,
  onChange,
  variant = "underline",
  className = "",
}: TabsProps) {
  if (variant === "pills") {
    return (
      <div
        className={`inline-flex items-center gap-1 p-1 bg-gray-100 rounded-lg ${className}`}
      >
        {items.map((it) => {
          const active = it.key === value;
          return (
            <button
              key={it.key}
              type="button"
              disabled={it.disabled}
              onClick={() => onChange(it.key)}
              className={`
                px-3 py-1 text-xs font-medium rounded-md transition-all
                ${
                  active
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-800"
                }
                disabled:opacity-40 disabled:cursor-not-allowed
              `}
            >
              <span className="inline-flex items-center gap-1.5">
                {it.label}
                {it.badge !== undefined ? (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      active
                        ? "bg-gray-100 text-gray-700"
                        : "bg-gray-200 text-gray-600"
                    }`}
                  >
                    {it.badge}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // underline variant
  return (
    <div
      className={`flex items-center border-b border-gray-200 ${className}`}
    >
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            disabled={it.disabled}
            onClick={() => onChange(it.key)}
            className={`
              relative px-4 py-2.5 text-sm font-medium transition-colors
              ${
                active
                  ? "text-blue-700"
                  : "text-gray-500 hover:text-gray-800"
              }
              disabled:opacity-40 disabled:cursor-not-allowed
            `}
          >
            <span className="inline-flex items-center gap-2">
              {it.label}
              {it.badge !== undefined ? (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    active
                      ? "bg-blue-50 text-blue-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {it.badge}
                </span>
              ) : null}
            </span>
            {active ? (
              <span className="absolute left-3 right-3 -bottom-px h-0.5 bg-blue-600 rounded-full" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
