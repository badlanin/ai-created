"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Upload,
  X,
  PlusCircle,
  PenLine,
  Image as ImageIcon,
} from "lucide-react";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useJobPolling } from "@/lib/hooks/use-job-polling";

/* ─────────────────────────────────────────────────────────
 *  类型
 * ───────────────────────────────────────────────────────── */

type Scene = {
  id: number;
  name: string;
  image_url: string;
  category: string | null;
  category_label: string | null;
  tags: string | null;
};

type ProductFile = {
  id: string;
  file: File;
  url: string; // local preview
};

type SceneEntry =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "image"; scene_id: number; scene_name: string };

const ASPECT_RATIOS = [
  { value: "3:4", label: "3:4 竖（推荐）" },
  { value: "9:16", label: "9:16 竖手机" },
  { value: "1:1", label: "1:1 方" },
  { value: "16:9", label: "16:9 横" },
  { value: "4:3", label: "4:3 横" },
];

/** 默认场景描述预设（点一下塞进新文字场景） */
const TEXT_SCENE_PRESETS: Array<{ name: string; text: string }> = [
  {
    name: "古典柱廊一角",
    text: "古典石质柱廊的一角：模特倚靠在一根多立克石柱旁，柱基厚重；午后金色斜光从右侧射入，地面石板有长条形光影；背景柱廊纵深完全虚化为暖米色色块。85mm 长焦感，浅景深。",
  },
  {
    name: "巴洛克栏杆 · 暖夕阳",
    text: "巴洛克石质栏杆边：模特右手轻搭在栏杆扶手上，扶手是粗糙的米白色石灰岩；夕阳斜射，栏杆边缘有金色轮廓光，背景的石质建筑外墙退到浅暖色调虚化色块。",
  },
  {
    name: "意式石阶 · 蜂蜜光",
    text: "意大利风格的石阶：模特站在台阶中段，身侧是一段石质雕花栏杆和一只大型陶土花盆；蜂蜜般的金色斜光，长长柔和的阴影；背景是淡黄色灰泥外墙和虚化的木百叶窗。",
  },
  {
    name: "拱窗白墙 · 冷柔光",
    text: "白色灰泥墙上嵌一扇高大的拱形窗户，模特半身倚靠窗框旁，柔和冷光从窗户漫射进来，墙面有微微纹理；背景极简，画面整体偏冷调白色。",
  },
  {
    name: "黄昏石廊 · 灯串暖光",
    text: "夕阳后的黄昏，模特站在陈旧石廊外的石板路上，头顶悬挂暖色串灯（轻微散景）；天空淡紫到深蓝过渡，模特身上同时有夕阳余晖和灯串的暖橙补光。",
  },
  {
    name: "湖边礁石 · 晨雾",
    text: "湖边圆润的鹅卵石滩上，模特站在水边一块大石头旁，水面平静映着浅银色晨光；远处树线柔焦成深绿色块，画面有薄雾感，整体冷静、清透；浅景深。",
  },
];

/* ─────────────────────────────────────────────────────────
 *  页面
 * ───────────────────────────────────────────────────────── */

export default function SceneToolsPage() {
  const user = useCurrentUser();

  // 数据
  const [scenesLib, setScenesLib] = useState<Scene[]>([]);

  // 表单
  const [products, setProducts] = useState<ProductFile[]>([]);
  const [scenes, setScenes] = useState<SceneEntry[]>([]);
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [userHint, setUserHint] = useState("");

  // 提交
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 场景图选择面板（显示 / 隐藏）
  const [scenePickerOpen, setScenePickerOpen] = useState(false);

  // 加载场景库
  useEffect(() => {
    fetch("/api/scenes")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Scene[]) => setScenesLib(data))
      .catch(() => {});
  }, []);

  // 产品图本地预览 URL 管理
  const productUrlsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    return () => {
      for (const url of productUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  function onPickProducts(files: FileList | null) {
    if (!files || files.length === 0) return;
    const newProducts: ProductFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.type.startsWith("image/")) continue;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const url = URL.createObjectURL(f);
      productUrlsRef.current.set(id, url);
      newProducts.push({ id, file: f, url });
    }
    setProducts((prev) => [...prev, ...newProducts]);
    setError(null);
  }

  function removeProduct(id: string) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    const url = productUrlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      productUrlsRef.current.delete(id);
    }
  }

  // 添加文字场景
  function addTextScene(initialText = "") {
    const id = `text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setScenes((prev) => [...prev, { id, type: "text", text: initialText }]);
  }

  // 添加图片场景
  function addImageScene(scene: Scene) {
    const id = `image-${scene.id}-${Date.now().toString(36)}`;
    if (scenes.some((s) => s.type === "image" && s.scene_id === scene.id)) {
      // 已加过这张图，跳过
      return;
    }
    setScenes((prev) => [
      ...prev,
      { id, type: "image", scene_id: scene.id, scene_name: scene.name },
    ]);
  }

  function removeScene(id: string) {
    setScenes((prev) => prev.filter((s) => s.id !== id));
  }

  function updateTextScene(id: string, text: string) {
    setScenes((prev) =>
      prev.map((s) =>
        s.id === id && s.type === "text" ? { ...s, text } : s,
      ),
    );
  }

  // 总数 + 软警告
  const totalCount = products.length * scenes.length;
  const estCostCny = totalCount * 1.7; // Pro 4K 约 ¥1.7/张
  const showWarning = totalCount > 20;

  const canSubmit =
    !submitting && products.length > 0 && scenes.length > 0 && !activeJobId;

  // ─── 提交 ───
  async function handleSubmit() {
    if (!canSubmit) return;
    if (showWarning) {
      const ok = confirm(
        `预计出 ${totalCount} 张图（${products.length} 产品 × ${scenes.length} 场景），约花费 ¥${estCostCny.toFixed(2)}。\n\n确认提交？`,
      );
      if (!ok) return;
    }
    // 文字场景必须有内容
    for (const s of scenes) {
      if (s.type === "text" && !s.text.trim()) {
        setError("有空的文字场景，请填写或删除");
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      products.forEach((p, i) => {
        fd.append(`product_image_${i}`, p.file, p.file.name);
      });
      const scenesPayload = scenes.map((s) => {
        if (s.type === "text") return { type: "text", text: s.text.trim() };
        return { type: "image", scene_id: s.scene_id };
      });
      fd.append("scenes", JSON.stringify(scenesPayload));
      fd.append("aspect_ratio", aspectRatio);
      if (userHint.trim()) fd.append("user_hint", userHint.trim());

      const res = await fetch("/api/scene-tools", {
        method: "POST",
        body: fd,
      });
      const body = (await res.json()) as { job_id?: string; error?: string };
      if (!res.ok || !body.job_id) {
        throw new Error(body.error || res.statusText);
      }
      setActiveJobId(body.job_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // ─── 轮询 job ───
  const polled = useJobPolling(activeJobId, {
    onFinished: () => {
      // 完成后让用户在这里看见，job 数据 still on screen
    },
  });
  const job = polled.data?.job;

  // 场景按 category 分组（图片场景库选择面板用）
  const sceneGroups = useMemo(() => {
    const groups = new Map<string, Scene[]>();
    for (const s of scenesLib) {
      const key = s.category_label || "未分类";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return Array.from(groups.entries()).map(([key, items]) => ({ key, items }));
  }, [scenesLib]);

  if (!user) return null;

  return (
    <main className="max-w-7xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-fg-primary flex items-center gap-2">
          <Sparkles size={20} className="text-brand-400" strokeWidth={2.2} />
          服饰场景图
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          上传 N 张产品成片 + 选 M 个场景（文字 / 图片混搭）→ 输出 N×M 张换景成片。
          每张产品图都会和每个场景配出一张图。
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ① 产品图 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3 flex items-center justify-between">
            <span>① 产品图（{products.length}）</span>
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => onPickProducts(e.target.files)}
                className="hidden"
              />
              <span className="text-[11px] text-brand-400 hover:underline inline-flex items-center gap-0.5">
                <PlusCircle size={12} />
                添加
              </span>
            </label>
          </h2>

          {products.length === 0 ? (
            <label className="block">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => onPickProducts(e.target.files)}
                className="hidden"
              />
              <div className="border border-dashed border-border-default rounded p-8 text-center cursor-pointer hover:border-brand-400 hover:bg-bg-hover transition-colors">
                <Upload
                  size={28}
                  strokeWidth={1.6}
                  className="text-fg-tertiary mx-auto mb-2"
                />
                <div className="text-sm text-fg-primary">点击上传产品图</div>
                <div className="text-[11px] text-fg-muted mt-1">
                  PNG / JPG / WebP · 限 20MB · 支持多选
                </div>
                <div className="text-[10px] text-fg-muted mt-2">
                  推荐：批量摄影出过的纯色背景成片（含模特+服装）
                </div>
              </div>
            </label>
          ) : (
            <div className="grid grid-cols-3 gap-2 max-h-[480px] overflow-y-auto pr-1">
              {products.map((p) => (
                <div key={p.id} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={p.file.name}
                    className="w-full aspect-[3/4] object-cover rounded border border-border-subtle"
                  />
                  <button
                    onClick={() => removeProduct(p.id)}
                    className="absolute top-1 right-1 p-1 bg-black/60 text-white rounded hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="移除"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ② 场景列表 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ② 选场景（{scenes.length}）
          </h2>

          {/* 添加按钮 */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => addTextScene()}
              className="flex-1 px-3 py-2 text-xs border border-border-default rounded hover:border-brand-400 hover:bg-bg-hover inline-flex items-center justify-center gap-1.5"
            >
              <PenLine size={14} strokeWidth={2} />
              加文字场景
            </button>
            <button
              onClick={() => setScenePickerOpen(true)}
              className="flex-1 px-3 py-2 text-xs border border-border-default rounded hover:border-brand-400 hover:bg-bg-hover inline-flex items-center justify-center gap-1.5"
            >
              <ImageIcon size={14} strokeWidth={2} />
              加图片场景
            </button>
          </div>

          {/* 已加场景 */}
          {scenes.length === 0 ? (
            <div className="text-[11px] text-fg-muted p-3 border border-dashed border-border-default rounded text-center">
              还没加场景。点击上方按钮添加文字描述或选场景图。
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {scenes.map((s, idx) => (
                <SceneEntryCard
                  key={s.id}
                  entry={s}
                  index={idx + 1}
                  onRemove={() => removeScene(s.id)}
                  onUpdateText={(t) => updateTextScene(s.id, t)}
                  scenesLib={scenesLib}
                />
              ))}
            </div>
          )}

          {/* 文字场景预设按钮 */}
          {scenes.some((s) => s.type === "text") && (
            <div className="mt-3 pt-3 border-t border-border-subtle">
              <div className="text-[11px] text-fg-tertiary mb-1.5">
                文字预设（点一下追加为新文字场景）：
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TEXT_SCENE_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => addTextScene(p.text)}
                    className="px-2 py-1 text-[11px] rounded border border-border-subtle bg-bg-tertiary text-fg-secondary hover:border-brand-400 hover:text-brand-400 transition-colors"
                    title={p.text.slice(0, 80)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ③ 参数 + 提交 + 进度 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ③ 生成
          </h2>

          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-[11px] text-fg-tertiary mb-1">
                输出比例
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="input select text-sm h-9"
              >
                {ASPECT_RATIOS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-fg-tertiary mb-1">
                额外提示（可选）
              </label>
              <textarea
                value={userHint}
                onChange={(e) => setUserHint(e.target.value.slice(0, 200))}
                placeholder="例如：略带胶片颗粒，蓝调时刻"
                rows={2}
                className="input text-sm w-full resize-none"
              />
              <div className="text-[10px] text-fg-muted mt-1 text-right">
                {userHint.length}/200
              </div>
            </div>

            {/* 总数预估 */}
            {totalCount > 0 && (
              <div
                className={`p-2.5 rounded text-[11px] ${
                  showWarning
                    ? "bg-[var(--warn-bg)] border border-amber-200 text-warn"
                    : "bg-bg-tertiary border border-border-subtle text-fg-secondary"
                }`}
              >
                {showWarning && "⚠️ "}
                共出 <strong>{totalCount}</strong> 张图（{products.length}{" "}
                产品 × {scenes.length} 场景）· 预计约{" "}
                <strong>¥{estCostCny.toFixed(2)}</strong>
                {showWarning && " · 数量较大，建议确认后再提交"}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="btn btn-primary w-full"
            >
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  提交中…
                </>
              ) : activeJobId ? (
                <>正在出图…</>
              ) : (
                <>
                  <Sparkles size={14} strokeWidth={2.2} />
                  开始生成
                </>
              )}
            </button>
          </div>

          {/* 进度展示 */}
          {activeJobId && job && (
            <div className="border-t border-border-subtle pt-3 space-y-2">
              <div className="text-[12px] text-fg-secondary">
                进度：{job.completed_count + job.failed_count + job.canceled_count}{" "}
                / {job.total_count}（成功 {job.completed_count}，失败{" "}
                {job.failed_count}）
              </div>
              <div className="w-full h-2 bg-bg-tertiary rounded overflow-hidden">
                <div
                  className="h-full bg-brand-400 transition-all duration-300"
                  style={{
                    width: `${
                      job.total_count > 0
                        ? ((job.completed_count + job.failed_count) /
                            job.total_count) *
                          100
                        : 0
                    }%`,
                  }}
                />
              </div>
              {(job.status === "completed" ||
                job.status === "failed" ||
                job.status === "canceled") && (
                <div className="flex gap-2">
                  <a
                    href="/history"
                    className="btn btn-secondary btn-sm flex-1"
                  >
                    查看结果（去历史记录）
                  </a>
                  <button
                    onClick={() => setActiveJobId(null)}
                    className="btn btn-secondary btn-sm"
                  >
                    新建任务
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* 场景图选择面板（modal） */}
      {scenePickerOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setScenePickerOpen(false)}
        >
          <div
            className="bg-bg-secondary rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="p-4 border-b border-border-subtle flex justify-between items-center">
              <h3 className="text-sm font-semibold">选场景图</h3>
              <button
                onClick={() => setScenePickerOpen(false)}
                className="text-fg-tertiary hover:text-fg-primary"
              >
                <X size={18} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {sceneGroups.length === 0 ? (
                <div className="text-sm text-fg-tertiary text-center py-12">
                  场景库为空，去{" "}
                  <a
                    href="/admin/scenes"
                    className="text-brand-400 underline"
                  >
                    /admin/scenes
                  </a>{" "}
                  添加
                </div>
              ) : (
                sceneGroups.map((g) => (
                  <div key={g.key}>
                    <h4 className="text-xs font-semibold text-fg-secondary mb-2">
                      {g.key} · {g.items.length} 张
                    </h4>
                    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
                      {g.items.map((s) => {
                        const added = scenes.some(
                          (sc) =>
                            sc.type === "image" && sc.scene_id === s.id,
                        );
                        return (
                          <button
                            key={s.id}
                            onClick={() => {
                              if (!added) addImageScene(s);
                            }}
                            disabled={added}
                            className={`relative rounded border overflow-hidden transition-all ${
                              added
                                ? "border-brand-400 opacity-60 cursor-not-allowed"
                                : "border-border-subtle hover:border-brand-400"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={s.image_url}
                              alt={s.name}
                              className="w-full aspect-[3/4] object-cover"
                            />
                            <div className="px-1 py-0.5 text-[10px] text-fg-secondary truncate text-center">
                              {s.name}
                            </div>
                            {added && (
                              <div className="absolute top-1 right-1 px-1 py-0.5 text-[10px] bg-brand-400 text-white rounded">
                                已加
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
            <footer className="p-3 border-t border-border-subtle flex justify-end gap-2">
              <button
                onClick={() => setScenePickerOpen(false)}
                className="btn btn-primary btn-sm"
              >
                完成
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}

/* ─────────── 单条场景 entry 卡片 ─────────── */
function SceneEntryCard({
  entry,
  index,
  onRemove,
  onUpdateText,
  scenesLib,
}: {
  entry: SceneEntry;
  index: number;
  onRemove: () => void;
  onUpdateText: (text: string) => void;
  scenesLib: Scene[];
}) {
  if (entry.type === "text") {
    return (
      <div className="p-2 bg-bg-tertiary rounded border border-border-subtle">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-fg-secondary font-medium">
            <PenLine size={12} strokeWidth={2.2} />
            场景 {index} · 文字
          </div>
          <button
            onClick={onRemove}
            className="text-fg-muted hover:text-danger"
            title="移除"
          >
            <X size={12} />
          </button>
        </div>
        <textarea
          value={entry.text}
          onChange={(e) => onUpdateText(e.target.value.slice(0, 500))}
          placeholder="例如：古典柱廊一角，午后金光斜射，浅景深..."
          rows={3}
          className="input text-xs w-full resize-none"
        />
        <div className="text-[10px] text-fg-muted mt-0.5 text-right">
          {entry.text.length}/500
        </div>
      </div>
    );
  }

  // image
  const scene = scenesLib.find((s) => s.id === entry.scene_id);
  return (
    <div className="p-2 bg-bg-tertiary rounded border border-border-subtle flex items-center gap-2">
      {scene?.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={scene.image_url}
          alt={entry.scene_name}
          className="w-10 h-14 object-cover rounded border border-border-subtle"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-[11px] text-fg-secondary font-medium">
          <ImageIcon size={11} strokeWidth={2.2} />
          场景 {index} · 图片
        </div>
        <div className="text-sm font-medium text-fg-primary truncate">
          {entry.scene_name}
        </div>
      </div>
      <button
        onClick={onRemove}
        className="text-fg-muted hover:text-danger"
        title="移除"
      >
        <X size={14} />
      </button>
    </div>
  );
}
