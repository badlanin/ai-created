/**
 * UI 原语统一导出
 *
 * 使用方式：
 *   import {
 *     Button,
 *     Card,
 *     Chip,
 *     Dialog,
 *     Select,
 *     Tabs,
 *     ProgressBar,
 *     StatusDot,
 *     EmptyState,
 *     Dropzone,
 *     CollapsibleSection,
 *     SearchInput,
 *   } from "@/app/_components/ui";
 */

export {
  Button,
  IconButton,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
} from "./button";
export { Card, CardHeader, SectionLabel, type CardProps } from "./card";
export { Chip, type ChipTone } from "./chip";
export { Dialog, type DialogProps } from "./dialog";
export {
  Select,
  Input,
  Textarea,
  type SelectProps,
} from "./select";
export { Tabs, type TabItem, type TabsProps } from "./tabs";
export { ProgressBar, SegmentedProgressBar } from "./progress";

// 新增组件（深色主题 UI）
export { StatusDot, type StatusDotProps, type StatusTone } from "./status-dot";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { Dropzone, type DropzoneProps } from "./dropzone";
export {
  CollapsibleSection,
  type CollapsibleSectionProps,
} from "./collapsible-section";
export { SearchInput, type SearchInputProps } from "./search-input";
