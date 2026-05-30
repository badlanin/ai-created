export type ChipTone = "brand" | "success" | "warn" | "danger" | "gray";

/**
 * 状态 chip（iOS 胶囊）
 *
 * 用法：
 *   <Chip tone="brand">进行中</Chip>
 *   <Chip tone="success">成功</Chip>
 */
export function Chip({
  tone = "gray",
  children,
  className = "",
  icon,
}: {
  tone?: ChipTone;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <span className={`chip chip-${tone} ${className}`}>
      {icon ? <span className="inline-flex items-center">{icon}</span> : null}
      {children}
    </span>
  );
}
