"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type NavUser = {
  id: number;
  username: string;
  display_name: string | null;
  role: "admin" | "user";
};

const NAV_ITEMS = [
  { href: "/", label: "首页" },
  { href: "/recolor", label: "换色" },
  { href: "/batch-photo", label: "批量摄影图" },
  { href: "/history", label: "历史" },
  { href: "/billing", label: "账单" },
] as const;

const ADMIN_ITEMS = [
  { href: "/admin/billing", label: "团队账单" },
  { href: "/admin/users", label: "用户" },
  { href: "/admin/model-prices", label: "单价/汇率" },
  { href: "/admin/colors", label: "颜色" },
  { href: "/admin/materials", label: "材质" },
  { href: "/admin/models", label: "模特" },
  { href: "/admin/scenes", label: "场景" },
  { href: "/admin/poses", label: "姿势" },
  { href: "/admin/photography", label: "摄影" },
  { href: "/admin/realism", label: "真实感" },
  { href: "/admin/prompts", label: "Prompt" },
  { href: "/admin/ai-models", label: "AI 模型" },
] as const;

export function NavBar({ user }: { user: NavUser }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname?.startsWith(href + "/");
  }

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-1 overflow-x-auto">
            <Link href="/" className="font-semibold text-gray-900 mr-4 whitespace-nowrap">
              服装AI生图工具
            </Link>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap ${
                  isActive(item.href)
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                {item.label}
              </Link>
            ))}
            {user.role === "admin" && (
              <>
                <span className="mx-2 text-gray-300">|</span>
                {ADMIN_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap ${
                      isActive(item.href)
                        ? "bg-amber-50 text-amber-800 font-medium"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </>
            )}
          </div>

          <div className="flex items-center gap-3 text-sm text-gray-600 whitespace-nowrap">
            <span className="hidden md:inline">
              {user.display_name || user.username}
              {user.role === "admin" && (
                <span className="ml-1 text-xs text-amber-700">(管理员)</span>
              )}
            </span>
            <button
              onClick={handleLogout}
              className="text-gray-500 hover:text-gray-900"
            >
              退出
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
