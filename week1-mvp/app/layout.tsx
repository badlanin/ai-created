import type { Metadata } from "next";
import "./globals.css";
import { ConditionalNav } from "./_components/conditional-nav";
import { AppProviders } from "./_components/providers";
import { getCurrentUser, ensureInitialAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  title: "伴娘服 AI 图像工具",
  description: "伴娘服独立站团队内部使用的 AI 批量图像处理工具",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 确保初始管理员存在（幂等，仅在第一次数据库为空时生效）
  await ensureInitialAdmin();

  // 未登录时 user 为 null，不显示导航栏（/login 页就是这种情况）
  const user = await getCurrentUser();

  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 min-h-screen">
        <AppProviders>
          {user && <ConditionalNav user={user} />}
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
