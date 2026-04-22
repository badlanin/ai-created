import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "伴娘服 AI 图像工具",
  description: "伴娘服独立站团队内部使用的 AI 批量图像处理工具",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
