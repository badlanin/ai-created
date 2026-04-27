"use client";

import { useEffect, useState } from "react";
import { Megaphone, Plus, Trash2, CheckCircle2, CircleOff, Pencil } from "lucide-react";
import {
  Button,
  IconButton,
  Card,
  Chip,
  Dialog,
  Input,
  Select,
  Textarea,
} from "@/app/_components/ui";

type Announcement = {
  id: number;
  content: string;
  tone: "info" | "success" | "warn" | "danger";
  enabled: number;
  dismissible: number;
  starts_at: number | null;
  ends_at: number | null;
  created_at: number;
  updated_at: number;
};

const TONE_LABEL: Record<Announcement["tone"], string> = {
  info: "普通",
  success: "成功",
  warn: "警告",
  danger: "紧急",
};

function formatTime(unix: number | null) {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function unixInputValue(unix: number | null): string {
  if (!unix) return "";
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseInputValue(s: string): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

export default function AnnouncementsAdminPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/announcements");
      if (res.ok) {
        const body = (await res.json()) as { items: Announcement[] };
        setItems(body.items || []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleEnabled(a: Announcement) {
    await fetch(`/api/admin/announcements/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !a.enabled }),
    });
    load();
  }

  async function del(a: Announcement) {
    if (!confirm(`确定删除这条公告吗？\n\n${a.content.slice(0, 60)}`)) return;
    await fetch(`/api/admin/announcements/${a.id}`, { method: "DELETE" });
    load();
  }

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-8">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-fg-primary flex items-center gap-2">
            <Megaphone size={22} className="text-brand-400" strokeWidth={2} />
            公告栏管理
          </h1>
          <p className="mt-1 text-sm text-fg-tertiary">
            所有用户登录后会在页面顶部看到生效的公告。支持定时上下线、紧急样式。
          </p>
        </div>
        <Button
          variant="primary"
          leftIcon={<Plus size={14} strokeWidth={2.2} />}
          onClick={() => setCreating(true)}
        >
          新建公告
        </Button>
      </header>

      {loading ? (
        <div className="p-6 text-sm text-fg-tertiary">加载中...</div>
      ) : items.length === 0 ? (
        <Card className="text-center p-12 text-sm text-fg-tertiary">
          还没有公告。点右上角"新建公告"创建第一条。
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <Card key={a.id} padding="md">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Chip tone={a.tone === "info" ? "brand" : a.tone}>
                      {TONE_LABEL[a.tone]}
                    </Chip>
                    {a.enabled ? (
                      <Chip tone="success" icon={<CheckCircle2 size={10} />}>
                        启用
                      </Chip>
                    ) : (
                      <Chip tone="gray" icon={<CircleOff size={10} />}>
                        已停用
                      </Chip>
                    )}
                    <span className="text-[11px] text-fg-tertiary">
                      {formatTime(a.starts_at)} → {formatTime(a.ends_at)}
                    </span>
                    <span className="text-[11px] text-fg-tertiary">
                      · 创建 {formatTime(a.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-fg-primary whitespace-pre-wrap break-words leading-relaxed">
                    {a.content}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <IconButton
                    icon={<Pencil size={14} strokeWidth={2} />}
                    aria-label="编辑"
                    size="sm"
                    onClick={() => setEditing(a)}
                  />
                  <IconButton
                    icon={
                      a.enabled ? (
                        <CircleOff size={14} strokeWidth={2} />
                      ) : (
                        <CheckCircle2 size={14} strokeWidth={2} />
                      )
                    }
                    aria-label={a.enabled ? "停用" : "启用"}
                    size="sm"
                    onClick={() => toggleEnabled(a)}
                  />
                  <IconButton
                    icon={<Trash2 size={14} strokeWidth={2} />}
                    aria-label="删除"
                    size="sm"
                    variant="danger-outline"
                    onClick={() => del(a)}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating ? (
        <EditDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      ) : null}

      {editing ? (
        <EditDialog
          announcement={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}
    </main>
  );
}

function EditDialog({
  announcement,
  onClose,
  onSaved,
}: {
  announcement?: Announcement;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState(announcement?.content || "");
  const [tone, setTone] = useState<Announcement["tone"]>(announcement?.tone || "info");
  const [enabled, setEnabled] = useState<boolean>(
    announcement ? announcement.enabled === 1 : true,
  );
  const [dismissible, setDismissible] = useState<boolean>(
    announcement ? announcement.dismissible === 1 : true,
  );
  const [startsAt, setStartsAt] = useState<string>(
    unixInputValue(announcement?.starts_at ?? null),
  );
  const [endsAt, setEndsAt] = useState<string>(
    unixInputValue(announcement?.ends_at ?? null),
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!content.trim()) {
      alert("公告正文不能为空");
      return;
    }
    setSaving(true);
    try {
      const body = {
        content: content.trim(),
        tone,
        enabled,
        dismissible,
        starts_at: parseInputValue(startsAt),
        ends_at: parseInputValue(endsAt),
      };
      const res = announcement
        ? await fetch(`/api/admin/announcements/${announcement.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/announcements", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!res.ok)
        throw new Error((await res.json()).error || res.statusText);
      onSaved();
    } catch (e) {
      alert("保存失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      width="lg"
      title={announcement ? "编辑公告" : "新建公告"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea
          label="正文"
          rows={4}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="例：下周一 10:00-11:00 系统维护，期间可能无法提交任务。"
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="样式"
            value={tone}
            onChange={(e) => setTone(e.target.value as Announcement["tone"])}
          >
            <option value="info">普通（蓝）</option>
            <option value="success">成功（绿）</option>
            <option value="warn">警告（黄）</option>
            <option value="danger">紧急（红）</option>
          </Select>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded border-border-default"
              />
              启用
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <input
                type="checkbox"
                checked={dismissible}
                onChange={(e) => setDismissible(e.target.checked)}
                className="rounded border-border-default"
              />
              用户可关闭
            </label>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="开始时间（留空=立即）"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
          <Input
            label="结束时间（留空=永久）"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}
