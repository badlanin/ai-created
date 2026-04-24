/**
 * 进度条 —— Apple 式扁平窄条
 */
export function ProgressBar({
  value,
  max = 100,
  tone = "brand",
  className = "",
  showLabel = false,
}: {
  value: number;
  max?: number;
  tone?: "brand" | "success" | "warn" | "danger";
  className?: string;
  showLabel?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  const toneClass = {
    brand: "bg-blue-500",
    success: "bg-green-500",
    warn: "bg-amber-500",
    danger: "bg-red-500",
  }[tone];
  return (
    <div className={className}>
      <div className="relative w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${toneClass} transition-all duration-300 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel ? (
        <div className="mt-1 text-[11px] text-gray-500 tabular-nums">
          {value} / {max} ({pct.toFixed(0)}%)
        </div>
      ) : null}
    </div>
  );
}

/**
 * 多段进度条（完成/失败/取消分段显示）
 */
export function SegmentedProgressBar({
  segments,
  total,
  className = "",
}: {
  segments: Array<{ value: number; tone: "success" | "danger" | "gray" }>;
  total: number;
  className?: string;
}) {
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const toneClass = {
    success: "bg-green-500",
    danger: "bg-red-500",
    gray: "bg-gray-400",
  };
  return (
    <div
      className={`relative h-1.5 w-full rounded-full bg-gray-100 overflow-hidden flex ${className}`}
    >
      {segments.map((s, i) => (
        <div
          key={i}
          className={`h-full ${toneClass[s.tone]} transition-all duration-300`}
          style={{ width: `${pct(s.value)}%` }}
        />
      ))}
    </div>
  );
}
