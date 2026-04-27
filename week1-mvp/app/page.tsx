import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { HomeShell } from "./_components/home-shell";
import {
  Palette,
  Camera,
  History as HistoryIcon,
  Wallet,
  Sparkles,
  Scissors,
  Eye,
  Users2,
  Landmark,
  StickyNote,
  SlidersHorizontal,
  DollarSign,
  Bot,
  Megaphone,
  UserCog,
  BarChart3,
} from "lucide-react";

interface Feature {
  href: string;
  title: string;
  desc: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  accent: "blue" | "pink" | "amber" | "green";
}

const FEATURES: Feature[] = [
  {
    href: "/recolor",
    title: "HEX 精准换色",
    desc: "一张产品图 + 多个颜色预设，批量生成同款不同颜色",
    Icon: Palette,
    accent: "blue",
  },
  {
    href: "/batch-photo",
    title: "批量摄影图",
    desc: "产品图 → 解析款式 → 选模特/场景/姿势 → 批量出图",
    Icon: Camera,
    accent: "pink",
  },
  {
    href: "/history",
    title: "我的历史",
    desc: "查看历次生成任务、结果图、成本和详细参数",
    Icon: HistoryIcon,
    accent: "amber",
  },
  {
    href: "/billing",
    title: "我的账单",
    desc: "本月用量、余额、明细记录",
    Icon: Wallet,
    accent: "green",
  },
];

const ADMIN_FEATURES: Feature[] = [
  {
    href: "/admin/colors",
    title: "颜色库",
    desc: "HEX + 中文名 · 换色用",
    Icon: Palette,
    accent: "blue",
  },
  {
    href: "/admin/materials",
    title: "材质库",
    desc: "面料描述 · 自动匹配款式解析",
    Icon: Scissors,
    accent: "blue",
  },
  {
    href: "/admin/realism",
    title: "真实感预设",
    desc: "控制皮肤 / 发丝真实度",
    Icon: Sparkles,
    accent: "blue",
  },
  {
    href: "/admin/models",
    title: "模特库",
    desc: "模特形象参考图（透明 PNG）",
    Icon: Users2,
    accent: "blue",
  },
  {
    href: "/admin/scenes",
    title: "场景库",
    desc: "婚礼 / 户外 / 影棚等背景",
    Icon: Landmark,
    accent: "blue",
  },
  {
    href: "/admin/poses",
    title: "姿势库",
    desc: "全身 / 半身 / 特写文字描述",
    Icon: Eye,
    accent: "blue",
  },
  {
    href: "/admin/photography",
    title: "摄影参数",
    desc: "镜头 / 光圈 / 色调预设",
    Icon: Camera,
    accent: "blue",
  },
  {
    href: "/admin/prompts",
    title: "Prompt 库",
    desc: "生成指令模板 · 占位符",
    Icon: StickyNote,
    accent: "blue",
  },
  {
    href: "/admin/ai-models",
    title: "AI 模型",
    desc: "Gemini 模型可见性 / 默认",
    Icon: Bot,
    accent: "blue",
  },
  {
    href: "/admin/users",
    title: "用户管理",
    desc: "账号 / 角色 / 预算",
    Icon: UserCog,
    accent: "amber",
  },
  {
    href: "/admin/billing",
    title: "团队账单",
    desc: "整体花费 · 按用户 / 模型",
    Icon: BarChart3,
    accent: "amber",
  },
  {
    href: "/admin/model-prices",
    title: "单价 / 汇率",
    desc: "模型单价 · 美元兑人民币",
    Icon: DollarSign,
    accent: "amber",
  },
  {
    href: "/admin/announcements",
    title: "公告栏",
    desc: "顶部公告内容 / 样式 / 时段",
    Icon: Megaphone,
    accent: "amber",
  },
];

const ACCENT_CLASSES: Record<Feature["accent"], { bg: string; text: string }> = {
  blue: { bg: "bg-blue-50", text: "text-blue-600" },
  pink: { bg: "bg-pink-50", text: "text-pink-600" },
  amber: { bg: "bg-amber-50", text: "text-amber-600" },
  green: { bg: "bg-green-50", text: "text-green-600" },
};

function FeatureCard({ f }: { f: Feature }) {
  const acc = ACCENT_CLASSES[f.accent];
  return (
    <Link
      href={f.href}
      className="group card hover:border-gray-300 hover:shadow-md transition-all p-4 flex items-start gap-3"
    >
      <div
        className={`shrink-0 w-10 h-10 rounded-xl ${acc.bg} flex items-center justify-center transition-transform group-hover:scale-105`}
      >
        <f.Icon size={18} strokeWidth={2} className={acc.text} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[14px] text-gray-900 leading-tight">
          {f.title}
        </div>
        <div className="text-[12px] text-gray-500 mt-1 leading-relaxed">
          {f.desc}
        </div>
      </div>
    </Link>
  );
}

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <HomeShell user={user}>
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-10">
        <header className="mb-8">
          <h1 className="text-[28px] font-bold text-gray-900 tracking-tight">
            你好，{user.display_name || user.username}
          </h1>
          <p className="mt-1.5 text-[14px] text-gray-500">
            从下面选一个工作台开始 · 三栏布局（左栏导航 · 中栏操作 · 右栏参数/进度）
          </p>
        </header>

        <section className="mb-10">
          <h2 className="section-label mb-3">工作台</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FEATURES.map((f) => (
              <FeatureCard key={f.href} f={f} />
            ))}
          </div>
        </section>

        {user.role === "admin" && (
          <section>
            <h2 className="section-label mb-3">素材 / 管理（管理员）</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {ADMIN_FEATURES.map((f) => (
                <FeatureCard key={f.href} f={f} />
              ))}
            </div>
          </section>
        )}

        <footer className="mt-16 text-center text-xs text-gray-400">
          伴娘服团队内部工具 · v0.3 (P3-2)
        </footer>
      </div>
    </HomeShell>
  );
}
