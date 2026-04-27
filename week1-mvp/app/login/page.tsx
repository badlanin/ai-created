"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg-primary flex items-center justify-center p-4 relative overflow-hidden">
      {/* 背景光晕装饰 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 w-[480px] h-[480px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-24 w-[480px] h-[480px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, transparent 70%)",
        }}
      />

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-bg-secondary rounded-lg border border-border-default shadow-lg p-7 relative z-10"
      >
        <div className="flex items-center gap-3 mb-1.5">
          <span
            className="w-10 h-10 rounded-md flex items-center justify-center text-white"
            style={{
              background: "var(--brand-gradient)",
              boxShadow: "0 0 20px var(--brand-glow)",
            }}
          >
            <Sparkles size={18} strokeWidth={2.2} />
          </span>
          <h1 className="text-[18px] font-bold text-fg-primary tracking-tight">
            服装AI生图工具
          </h1>
        </div>
        <p className="text-[12px] text-fg-tertiary mb-6 ml-[52px]">
          团队内部登录
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-fg-secondary mb-1.5">
              用户名
            </label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              required
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-fg-secondary mb-1.5">
              密码
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              required
            />
          </div>

          {error && (
            <div
              className="p-3 rounded-md text-[13px] border"
              style={{
                background: "var(--danger-bg)",
                borderColor: "rgba(239, 68, 68, 0.3)",
                color: "var(--danger)",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary btn-md w-full"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </div>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-primary" />}>
      <LoginForm />
    </Suspense>
  );
}
