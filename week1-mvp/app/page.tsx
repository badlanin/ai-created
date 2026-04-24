import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { HomeShell } from "./_components/home-shell";

const FEATURES = [
  {
    href: "/recolor",
    title: "HEX 精准换色",
    desc: "一张产品图 + 多个颜色预设，批量生成同款不同颜色，保留蕾丝珠片纹理",
    emoji: "🎨",
  },
  {
    href: "/batch-photo",
    title: "批量摄影图",
    desc: "上传产品图 → 解析款式 → 选模特/场景/姿势 → 批量出模特摄影图",
    emoji: "👗",
  },
  {
    href: "/history",
    title: "我的历史",
    desc: "查看自己历次生成的图片，可重新下载",
    emoji: "🕘",
  },
  {
    href: "/billing",
    title: "我的账单",
    desc: "查看本月余额和使用明细",
    emoji: "¥",
  },
];

const ADMIN_FEATURES = [
  {
    href: "/admin/colors",
    title: "颜色库",
    desc: "管理常用颜色预设（HEX + 中文名）",
    emoji: "🎨",
  },
  {
    href: "/admin/materials",
    title: "材质库",
    desc: "面料材质详细描述，自动匹配款式解析结果",
    emoji: "🧵",
  },
  {
    href: "/admin/realism",
    title: "真实感预设库",
    desc: "控制皮肤/发丝真实度，避免 AI 磨皮塑料感",
    emoji: "✨",
  },
  {
    href: "/admin/models",
    title: "模特库",
    desc: "管理模特形象和姿势参考图",
    emoji: "👤",
  },
  {
    href: "/admin/scenes",
    title: "场景库",
    desc: "管理婚礼、户外、影棚等背景图",
    emoji: "🏛️",
  },
  {
    href: "/admin/poses",
    title: "姿势库",
    desc: "管理姿势文字描述（全身/半身/特写）",
    emoji: "🧍",
  },
  {
    href: "/admin/photography",
    title: "摄影参数库",
    desc: "镜头/光圈/角度/色调等摄影指令预设",
    emoji: "📷",
  },
  {
    href: "/admin/prompts",
    title: "Prompt 库",
    desc: "管理生成指令模板，支持占位符",
    emoji: "📝",
  },
  {
    href: "/admin/ai-models",
    title: "AI 模型管理",
    desc: "控制哪些 Gemini 模型可见 / 哪个默认",
    emoji: "🤖",
  },
  {
    href: "/admin/users",
    title: "用户管理",
    desc: "团队成员账号 / 预算 / 密码",
    emoji: "👥",
  },
  {
    href: "/admin/billing",
    title: "团队账单",
    desc: "团队整体花费明细",
    emoji: "📊",
  },
  {
    href: "/admin/model-prices",
    title: "单价 / 汇率",
    desc: "模型单价和美元兑人民币汇率",
    emoji: "💱",
  },
];

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) {
    // middleware 应该已经拦了，这里兜底避免空值
    return null;
  }

  return (
    <HomeShell user={user}>
      <div className="max-w-5xl mx-auto p-4 md:p-8">
        <header className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
            你好，{user.display_name || user.username}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            选择一个工作台开始 · 三栏布局（左栏导航、中栏操作、右栏参数/进度）
          </p>
        </header>

        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">工作台</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FEATURES.map((f) => (
              <Link
                key={f.href}
                href={f.href}
                className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition"
              >
                <div className="flex items-start gap-3">
                  <div className="text-2xl">{f.emoji}</div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{f.title}</div>
                    <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                      {f.desc}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {user.role === "admin" && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              素材 / 管理（仅管理员）
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {ADMIN_FEATURES.map((f) => (
                <Link
                  key={f.href}
                  href={f.href}
                  className="block bg-white border border-gray-200 rounded-lg p-3 hover:border-amber-300 hover:shadow-sm transition"
                >
                  <div className="flex items-start gap-2">
                    <div className="text-xl">{f.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900">
                        {f.title}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                        {f.desc}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-12 text-center text-xs text-gray-400">
          伴娘服团队内部工具 · v0.3 (P3-1)
        </footer>
      </div>
    </HomeShell>
  );
}
