"use client";

import { NotificationProvider } from "./notification-stack";
import { TaskStoreProvider } from "@/lib/stores/task-store";

/**
 * 全局 Provider 组合
 *
 * 在 app/layout.tsx 里套在 body 最外层，所有子组件（客户端/服务端）
 * 都能用 useNotifications() 和 useTaskStore() / useSlotStore()。
 *
 * 顺序：TaskStore（外）→ Notification（内）。
 * 这样 TaskStore 的更新不会导致 Notification 整树重渲染。
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <TaskStoreProvider>
      <NotificationProvider>{children}</NotificationProvider>
    </TaskStoreProvider>
  );
}
