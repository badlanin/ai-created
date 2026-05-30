"use client";

import { useEffect, useState } from "react";

type User = {
  id: number;
  username: string;
  display_name: string | null;
  role: "admin" | "user";
  created_at: number;
  monthly_budget_cny: number;
  is_unlimited: number;
  budget_notes: string | null;
  used_this_month_cny: number;
};

function fmtCny(v: number): string {
  return "¥" + (v || 0).toFixed(2);
}

export default function UsersAdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    username: "",
    password: "",
    display_name: "",
    role: "user" as "user" | "admin",
    is_unlimited: true,
    monthly_budget_cny: 0,
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setUsers(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      setForm({
        username: "",
        password: "",
        display_name: "",
        role: "user",
        is_unlimited: true,
        monthly_budget_cny: 0,
      });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePatch(id: number, patch: Record<string, unknown>) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(id: number, username: string) {
    if (!confirm(`确定删除用户 ${username}？历史消费记录保留`)) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleResetPassword(id: number, username: string) {
    const pwd = prompt(`为 ${username} 重置密码（至少 6 位）`);
    if (!pwd || pwd.length < 6) return;
    await handlePatch(id, { password: pwd });
    alert("密码已重置");
  }

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-fg-primary">用户管理</h1>
          <p className="mt-1 text-sm text-fg-tertiary">
            团队成员账号 + 月度预算。管理员账号不受预算限制。
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700"
        >
          {showForm ? "取消" : "+ 新增用户"}
        </button>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      {showForm && (
        <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle p-6 mb-6">
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-fg-secondary mb-1">
                  用户名 <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) =>
                    setForm({ ...form, username: e.target.value })
                  }
                  required
                  className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-fg-secondary mb-1">
                  密码（至少 6 位） <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  minLength={6}
                  required
                  className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-fg-secondary mb-1">
                  显示名
                </label>
                <input
                  type="text"
                  value={form.display_name}
                  onChange={(e) =>
                    setForm({ ...form, display_name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-fg-secondary mb-1">角色</label>
                <select
                  value={form.role}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      role: e.target.value as "user" | "admin",
                    })
                  }
                  className="w-full px-3 py-2 border border-border-default rounded-md text-sm"
                >
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_unlimited}
                  onChange={(e) =>
                    setForm({ ...form, is_unlimited: e.target.checked })
                  }
                />
                无限额度
              </label>
              {!form.is_unlimited && (
                <label className="text-sm flex items-center gap-2">
                  月度预算 (¥)
                  <input
                    type="number"
                    step="1"
                    value={form.monthly_budget_cny}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        monthly_budget_cny: Number(e.target.value),
                      })
                    }
                    className="w-28 px-2 py-1 border border-border-default rounded text-sm"
                  />
                </label>
              )}
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700"
            >
              创建
            </button>
          </form>
        </section>
      )}

      <section className="bg-bg-secondary rounded-lg shadow-sm border border-border-subtle">
        <div className="px-6 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-fg-secondary">
            成员 ({users.length})
          </h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-fg-tertiary">加载中...</div>
        ) : users.length === 0 ? (
          <div className="p-6 text-sm text-fg-tertiary">无</div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                onPatch={handlePatch}
                onDelete={handleDelete}
                onResetPwd={handleResetPassword}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function UserRow({
  user,
  onPatch,
  onDelete,
  onResetPwd,
}: {
  user: User;
  onPatch: (id: number, patch: Record<string, unknown>) => void;
  onDelete: (id: number, username: string) => void;
  onResetPwd: (id: number, username: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    display_name: user.display_name || "",
    role: user.role,
    is_unlimited: user.is_unlimited === 1,
    monthly_budget_cny: user.monthly_budget_cny,
  });

  const pct =
    user.is_unlimited === 1 || user.monthly_budget_cny === 0
      ? 0
      : Math.min(100, (user.used_this_month_cny / user.monthly_budget_cny) * 100);

  return (
    <li className="px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-fg-primary">
              {user.display_name || user.username}
            </span>
            <span className="text-xs text-fg-tertiary">@{user.username}</span>
            {user.role === "admin" && (
              <span className="text-[10px] px-1.5 py-0.5 bg-[var(--warn-bg)] text-warn rounded">
                管理员
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-fg-tertiary">
            本月消费 {fmtCny(user.used_this_month_cny)}
            {user.is_unlimited === 1 ? (
              <span className="ml-2 text-success">· 无限额度</span>
            ) : (
              <>
                {" / "}
                {fmtCny(user.monthly_budget_cny)}{" "}
                <span
                  className={
                    pct > 90
                      ? "text-danger"
                      : pct > 70
                        ? "text-warn"
                        : "text-fg-tertiary"
                  }
                >
                  ({pct.toFixed(0)}%)
                </span>
              </>
            )}
          </div>
          {editing && (
            <div className="mt-3 p-3 bg-[var(--brand-50-bg)] rounded border border-[rgba(59,130,246,0.3)] space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={draft.display_name}
                  onChange={(e) =>
                    setDraft({ ...draft, display_name: e.target.value })
                  }
                  placeholder="显示名"
                  className="px-2 py-1 border border-border-default rounded text-sm"
                />
                <select
                  value={draft.role}
                  onChange={(e) =>
                    setDraft({ ...draft, role: e.target.value as "user" | "admin" })
                  }
                  className="px-2 py-1 border border-border-default rounded text-sm"
                >
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.is_unlimited}
                    onChange={(e) =>
                      setDraft({ ...draft, is_unlimited: e.target.checked })
                    }
                  />
                  无限额度
                </label>
                {!draft.is_unlimited && (
                  <label className="flex items-center gap-1 text-sm">
                    月度预算 ¥
                    <input
                      type="number"
                      step="1"
                      value={draft.monthly_budget_cny}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          monthly_budget_cny: Number(e.target.value),
                        })
                      }
                      className="w-28 px-2 py-1 border border-border-default rounded text-sm"
                    />
                  </label>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onPatch(user.id, draft);
                    setEditing(false);
                  }}
                  className="px-3 py-1 bg-brand-600 text-white text-xs rounded"
                >
                  保存
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="px-3 py-1 text-fg-secondary text-xs hover:bg-bg-tertiary rounded"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-xs text-fg-secondary hover:text-fg-primary px-2 py-1"
          >
            编辑
          </button>
          <button
            onClick={() => onResetPwd(user.id, user.username)}
            className="text-xs text-brand-400 hover:text-brand-400 px-2 py-1"
          >
            重置密码
          </button>
          <button
            onClick={() => onDelete(user.id, user.username)}
            className="text-xs text-danger hover:text-red-800 px-2 py-1"
          >
            删除
          </button>
        </div>
      </div>
    </li>
  );
}
