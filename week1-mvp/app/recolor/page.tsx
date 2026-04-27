"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageCropper } from "@/app/_components/image-cropper";
import { AppShell } from "@/app/_components/app-shell";
import { NotificationStack, useNotifications, notifyHelpers } from "@/app/_components/notification-stack";
import { TaskViewport } from "@/app/_components/task-viewport";
import { Thumbnail, ThumbnailBadge } from "@/app/_components/thumbnail";
import { ResetButton } from "@/app/_components/reset-button";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useJobPolling } from "@/lib/hooks/use-job-polling";
import { useSlotStore } from "@/lib/stores/task-store";
import {
  ChevronDown, ChevronRight, Upload, Palette, Shirt, Sparkles,
  Clipboard, Search, X, Plus, Check
} from "lucide-react";

/* ─────────── 类型 ─────────── */
type Color = {
  id: number;
  name: string;
  hex: string;
  color_group: string | null;
  color_group_label: string | null;
  is_popular?: number | boolean;
};
type AiModel = {
  id: number; model_id: string; label: string; description: string | null;
  badge: string | null; is_default: 0 | 1;
};
type Material = { id: number; name: string; english_name: string | null; description: string | null; };
type Realism = { id: number; name: string; description: string | null; is_default: 0 | 1; };
type GarmentAttrs = Record<string, string | string[]>;

interface CostEstimate {
  per_image_cny: number; total_cost_cny: number; affordable: boolean;
  can_afford_count: number; is_unlimited: boolean; remaining_cny: number;
}

const ASPECT_RATIOS = [
  { value: "3:4", label: "3:4 竖（推荐）" }, { value: "2:3", label: "2:3 竖" },
  { value: "4:5", label: "4:5 竖" }, { value: "1:1", label: "1:1 方" },
  { value: "4:3", label: "4:3 横" }, { value: "16:9", label: "16:9 横" },
] as const;

type QualityLevel = "hd" | "2k" | "4k";
const QUALITY_LEVELS: Array<{ value: QualityLevel; label: string; desc: string }> = [
  { value: "2k", label: "2K 高清（推荐）", desc: "约 1792×2400 · 速度/成本/清晰度平衡最佳" },
  { value: "4k", label: "4K 超清", desc: "约 3584×4800 · 最大清晰度，成本 ~15x" },
  { value: "hd", label: "HD 清晰", desc: "约 896×1200 · 最快最省" },
];

async function resizeImage(file: File, maxSize = 2048): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas 不可用"));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("压缩失败"))), "image/jpeg", 0.95);
    };
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = URL.createObjectURL(file);
  });
}

export default function RecolorPage() {
  const user = useCurrentUser();
  const slotStore = useSlotStore("recolor");
  const { push } = useNotifications();

  const [files, setFiles] = useState<File[]>([]);
  const [compressedBlobs, setCompressedBlobs] = useState<Blob[]>([]);
  const [croppedFlags, setCroppedFlags] = useState<boolean[]>([]);
  const [croppingIndex, setCroppingIndex] = useState<number | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [garmentAttrs, setGarmentAttrs] = useState<GarmentAttrs | null>(null);

  const [aspectRatio, setAspectRatio] = useState<string>("3:4");
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>("2k");
  const [userSeed, setUserSeed] = useState("");

  const [allMaterials, setAllMaterials] = useState<Material[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<number[]>([]);
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);

  const [realisms, setRealisms] = useState<Realism[]>([]);
  const [realismId, setRealismId] = useState<number | null>(null);

  const [colors, setColors] = useState<Color[]>([]);
  const [selectedColorIds, setSelectedColorIds] = useState<Set<number>>(new Set());
  const [customColors, setCustomColors] = useState<Array<{ name: string; hex: string }>>([]);
  const [customName, setCustomName] = useState("");
  const [customHex, setCustomHex] = useState("#722F37");

  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  const [model, setModel] = useState<string>("");

  // 折叠状态
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    upload: false,
    analyze: false,
    color: true, // 颜色默认折叠
  });

  // 颜色搜索
  const [colorSearch, setColorSearch] = useState("");
  // 颜色分类折叠
  const [collapsedColorGroups, setCollapsedColorGroups] = useState<Record<string, boolean>>({});

  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(
    () => slotStore.get<string>("activeJobId") ?? null,
  );
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [viewMode, setViewMode] = useState<"form" | "task">(
    () => (slotStore.get<string>("activeJobId") ? "task" : "form"),
  );
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);

  /* ─── 折叠控制 ─── */
  function toggleSection(key: string) {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }
  function toggleColorGroup(key: string) {
    setCollapsedColorGroups(prev => ({ ...prev, [key]: !prev[key] }));
  }

  /* ─── 初始数据加载 + slot 恢复 ─── */
  useEffect(() => {
    fetch("/api/colors").then((r) => (r.ok ? r.json() : [])).then(setColors).catch(() => {});
    fetch("/api/ai-models?category=image_gen").then((r) => (r.ok ? r.json() : [])).then((list: AiModel[]) => {
      setAiModels(list);
      const saved = slotStore.get<string>("model");
      const def = saved || list.find((m) => m.is_default === 1)?.model_id || list[0]?.model_id;
      if (def) setModel(def);
    }).catch(() => {});
    fetch("/api/materials").then((r) => (r.ok ? r.json() : [])).then(setAllMaterials).catch(() => {});
    fetch("/api/realism").then((r) => (r.ok ? r.json() : [])).then((list: Realism[]) => {
      setRealisms(list);
      const savedId = slotStore.get<number>("realismId");
      const def = savedId || list.find((r) => r.is_default === 1)?.id || list[0]?.id;
      if (def) setRealismId(def);
    }).catch(() => {});

    const savedAspect = slotStore.get<string>("aspectRatio"); if (savedAspect) setAspectRatio(savedAspect);
    const savedQuality = slotStore.get<QualityLevel>("qualityLevel"); if (savedQuality) setQualityLevel(savedQuality);
    const savedSeed = slotStore.get<string>("userSeed"); if (savedSeed) setUserSeed(savedSeed);
    const savedColorIds = slotStore.get<number[]>("selectedColorIds"); if (savedColorIds) setSelectedColorIds(new Set(savedColorIds));
    const savedCustomColors = slotStore.get<Array<{ name: string; hex: string }>>("customColors");
    if (savedCustomColors) setCustomColors(savedCustomColors);
    const savedGarment = slotStore.get<GarmentAttrs>("garmentAttrs"); if (savedGarment) setGarmentAttrs(savedGarment);
    const savedMatIds = slotStore.get<number[]>("selectedMaterialIds"); if (savedMatIds) setSelectedMaterialIds(savedMatIds);

    fetch("/api/jobs/active").then((r) => (r.ok ? r.json() : { count: 0 })).then((d) => setActiveJobCount(d.count || 0)).catch(() => {});
  }, []);

  /* ─── 持久化状态到 slotStore ─── */
  useEffect(() => {
    slotStore.merge({
      aspectRatio, qualityLevel, userSeed, model, realismId,
      selectedColorIds: Array.from(selectedColorIds), customColors, selectedMaterialIds, garmentAttrs,
    });
  }, [aspectRatio, qualityLevel, userSeed, model, realismId, selectedColorIds, customColors, selectedMaterialIds, garmentAttrs]);

  /* ─── 估价 ─── */
  const totalCount = useMemo(() => {
    return files.length * (selectedColorIds.size + customColors.length);
  }, [files.length, selectedColorIds, customColors.length]);

  useEffect(() => {
    if (totalCount === 0 || !model) { setEstimate(null); return; }
    const t = setTimeout(() => {
      fetch("/api/billing/estimate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, quality_level: qualityLevel, image_count: totalCount }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          setEstimate({
            per_image_cny: data.estimate.per_image_cny, total_cost_cny: data.estimate.total_cost_cny,
            affordable: data.affordable, can_afford_count: data.can_afford_count,
            is_unlimited: data.budget.is_unlimited, remaining_cny: data.budget.remaining_cny,
          });
        })
        .catch(() => setEstimate(null));
    }, 300);
    return () => clearTimeout(t);
  }, [totalCount, model, qualityLevel]);

  /* ─── 轮询 ─── */
  const handleJobFinished = useCallback(() => {
    fetch("/api/jobs/active").then((r) => (r.ok ? r.json() : { count: 0 })).then((d) => setActiveJobCount(d.count || 0)).catch(() => {});
  }, []);

  const polling = useJobPolling(activeJobId, {
    intervalMs: 1500,
    onFinished: (result) => {
      handleJobFinished();
      const { job } = result;
      if (job.status === "completed") {
        notifyHelpers.success(push, `换色任务完成 · ${job.completed_count}/${job.total_count}`,
          job.failed_count > 0 ? `${job.failed_count} 张失败，其余已完成。` : undefined);
      } else if (job.status === "canceled") {
        notifyHelpers.info(push, "任务已停止", `已完成 ${job.completed_count} / 共 ${job.total_count}`);
      } else if (job.status === "failed") {
        notifyHelpers.error(push, "任务失败", job.error_message || "请查看详细日志");
      }
    },
  });

  useEffect(() => {
    if (polling.error && polling.error.includes("不存在")) {
      setActiveJobId(null); slotStore.setActiveJob(null); setViewMode("form");
      notifyHelpers.warn(push, "任务已被清理", "任务不存在或已被删除，已回到表单");
    }
  }, [polling.error]);

  /* ─── Ctrl+V 粘贴监听 ─── */
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void onPickFiles([file]);
            break;
          }
        }
      }
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  /* ─── 文件处理 ─── */
  async function onPickFiles(newFiles: File[]) {
    const picked = newFiles.slice(0, 5);
    setFiles(picked); setCompressedBlobs([]); setCroppedFlags(new Array(picked.length).fill(false));
    setGarmentAttrs(null); setSelectedMaterialIds([]);
    try {
      const blobs = await Promise.all(picked.map((f) => resizeImage(f, 2048)));
      setCompressedBlobs(blobs);
    } catch (e) {
      notifyHelpers.error(push, "图片读取失败", e instanceof Error ? e.message : String(e));
    }
  }

  function onCropConfirm(i: number, blob: Blob) {
    setCompressedBlobs((prev) => { const next = [...prev]; next[i] = blob; return next; });
    setCroppedFlags((prev) => { const next = [...prev]; next[i] = true; return next; });
    setCroppingIndex(null);
  }

  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
    setCompressedBlobs((prev) => prev.filter((_, idx) => idx !== i));
    setCroppedFlags((prev) => prev.filter((_, idx) => idx !== i));
  }

  /* ─── 解析 ─── */
  async function handleAnalyze() {
    if (compressedBlobs.length === 0 || files.length === 0) {
      notifyHelpers.warn(push, "请先上传图片"); return;
    }
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("image0", compressedBlobs[0], files[0].name);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const attrs = (await res.json()) as GarmentAttrs;
      setGarmentAttrs(attrs);
      await rematchMaterials(String(attrs["面料材质"] || ""));
      notifyHelpers.success(push, "款式解析完成");
    } catch (e) {
      notifyHelpers.error(push, "款式解析失败", e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function rematchMaterials(materialText: string) {
    if (!materialText) { setSelectedMaterialIds([]); return; }
    try {
      const mRes = await fetch("/api/materials/match", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: materialText }),
      });
      if (mRes.ok) {
        const body = (await mRes.json()) as { matched: Material[] };
        setSelectedMaterialIds(body.matched.map((m) => m.id));
      }
    } catch {}
  }

  function updateGarmentAttr(key: string, value: string) {
    setGarmentAttrs((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function toggleColor(id: number) {
    setSelectedColorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addMaterial(id: number) {
    setSelectedMaterialIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setShowMaterialPicker(false);
  }
  function removeMaterial(id: number) {
    setSelectedMaterialIds((prev) => prev.filter((x) => x !== id));
  }

  const selectedMaterials = selectedMaterialIds
    .map((id) => allMaterials.find((m) => m.id === id)).filter(Boolean) as Material[];
  const unselectedMaterials = allMaterials.filter((m) => !selectedMaterialIds.includes(m.id));

  function addCustomColor() {
    const name = customName.trim();
    if (!name) { notifyHelpers.warn(push, "请先输入颜色名"); return; }
    if (customColors.some((c) => c.name === name || c.hex.toLowerCase() === customHex.toLowerCase())) {
      notifyHelpers.warn(push, "已有同名或同色号的临时色"); return;
    }
    setCustomColors((prev) => [...prev, { name, hex: customHex }]);
    setCustomName("");
  }

  function removeCustomColor(i: number) {
    setCustomColors((prev) => prev.filter((_, idx) => idx !== i));
  }

  /* ─── 提交 ─── */
  async function handleSubmit() {
    if (compressedBlobs.length === 0 || files.length === 0) {
      notifyHelpers.warn(push, "请先上传产品图"); return;
    }
    const colorCount = selectedColorIds.size + customColors.length;
    if (colorCount === 0) {
      notifyHelpers.warn(push, "请至少选择一个颜色，或添加临时颜色"); return;
    }
    if (estimate && !estimate.affordable && !estimate.is_unlimited) {
      const ok = confirm(`预估花费 ¥${estimate.total_cost_cny.toFixed(2)}，超过余额 ¥${estimate.remaining_cny.toFixed(2)}。\n\n建议把任务数减到 ${estimate.can_afford_count} 张以内。仍要提交吗？`);
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      compressedBlobs.forEach((blob, i) => { fd.append(`image${i}`, blob, files[i].name); });
      if (selectedColorIds.size > 0) fd.append("color_ids", JSON.stringify([...selectedColorIds]));
      if (customColors.length > 0) fd.append("custom_colors", JSON.stringify(customColors));
      fd.append("model", model);
      if (aspectRatio) fd.append("aspect_ratio", aspectRatio);
      fd.append("quality_level", qualityLevel);
      if (selectedMaterialIds.length > 0) fd.append("material_ids", JSON.stringify(selectedMaterialIds));
      if (realismId) fd.append("realism_id", String(realismId));
      if (garmentAttrs) fd.append("garment_attrs", JSON.stringify(garmentAttrs));
      if (userSeed.trim()) fd.append("user_seed", userSeed.trim());

      const res = await fetch("/api/jobs/recolor", { method: "POST", body: fd });
      const body = (await res.json()) as { job_id?: string; error?: string };
      if (!res.ok || !body.job_id) throw new Error(body.error || res.statusText);
      setActiveJobId(body.job_id);
      slotStore.setActiveJob(body.job_id);
      setActiveJobCount((v) => v + 1);
      setViewMode("task");
      notifyHelpers.info(push, "任务已提交", `共 ${totalCount} 张 · 预计耗时 ${Math.ceil(totalCount / 2)}+ 分钟`);
    } catch (e) {
      notifyHelpers.error(push, "提交失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  /* ─── 重置 ─── */
  function resetAll() {
    setFiles([]); setCompressedBlobs([]); setCroppedFlags([]); setGarmentAttrs(null);
    setSelectedMaterialIds([]); setSelectedColorIds(new Set()); setCustomColors([]);
    setCustomName(""); setUserSeed(""); setActiveJobId(null); slotStore.reset();
    notifyHelpers.info(push, "已清空当前任务");
  }

  function dismissCurrentJob() {
    setActiveJobId(null); slotStore.setActiveJob(null);
  }

  if (!user) return <div className="p-8 text-center" style={{ color: 'var(--text-tertiary)' }}>正在加载…</div>;

  const showTaskViewport = viewMode === "task" && polling.data;

  // 过滤后的颜色
  const filteredColors = useMemo(() => {
    if (!colorSearch.trim()) return colors;
    const search = colorSearch.toLowerCase();
    return colors.filter(c =>
      c.name.toLowerCase().includes(search) ||
      c.hex.toLowerCase().includes(search) ||
      (c.color_group_label && c.color_group_label.toLowerCase().includes(search))
    );
  }, [colors, colorSearch]);

  // 按分组整理过滤后的颜色
  const groupedColors = useMemo(() => {
    const GROUP_ORDER = ["蓝色系", "绿色系", "中性色系", "粉/红色系", "紫色系", "黄色系", "深色系"];
    const groups = new Map<string, Color[]>();
    for (const c of filteredColors) {
      const key = c.color_group_label || "未分类";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
    const orderedKeys = [
      ...GROUP_ORDER.filter((k) => groups.has(k)),
      ...Array.from(groups.keys()).filter((k) => !GROUP_ORDER.includes(k)),
    ];
    // 默认折叠所有分组
    if (Object.keys(collapsedColorGroups).length === 0) {
      const init: Record<string, boolean> = {};
      orderedKeys.forEach(k => { init[k] = true; });
      // 默认展开第一个有流行色的分组
      for (const c of filteredColors) {
        if (c.is_popular && c.color_group_label) {
          init[c.color_group_label] = false;
          break;
        }
      }
      setCollapsedColorGroups(init);
    }
    return { orderedKeys, groups };
  }, [filteredColors, collapsedColorGroups]);

  /* ═══════════════════ 渲染 ═══════════════════ */
  return (
    <AppShell
      leftNav={{ user, activeJobCount }}
      rightPanel={
        <RightPanelRecolor
          aiModels={aiModels} model={model} onModelChange={setModel}
          aspectRatio={aspectRatio} onAspectChange={setAspectRatio}
          qualityLevel={qualityLevel} onQualityChange={setQualityLevel}
          userSeed={userSeed} onUserSeedChange={setUserSeed}
          totalCount={totalCount} filesLen={files.length} colorsLen={selectedColorIds.size + customColors.length}
          estimate={estimate} submitting={submitting} canSubmit={files.length > 0 && totalCount > 0 && !analyzing}
          onSubmit={handleSubmit} onReset={resetAll}
          poll={polling.data} pollError={polling.error} onDismissJob={dismissCurrentJob}
          hasActiveTask={Boolean(polling.data)} viewMode={viewMode}
          onSwitchView={() => setViewMode((m) => (m === "task" ? "form" : "task"))}
        />
      }
    >
      {showTaskViewport && polling.data ? (
        <TaskViewport
          job={polling.data.job} items={polling.data.items}
          nextTokenReadyAtMs={polling.data.next_token_ready_at_ms}
          serverTimeMs={polling.data.server_time_ms}
          onBackToForm={() => setViewMode("form")}
          onStartNew={() => { resetAll(); setViewMode("form"); }}
          zipPrefix="recolor"
          makeFilename={(it) => {
            const safe = (it.label || `item_${it.idx + 1}`).replace(/[/\\?%*:|"<>]/g, "_");
            return `${safe}.png`;
          }}
        />
      ) : (
      <div className="p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>HEX 精准换色</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-tertiary)' }}>
            上传产品图 → 选择目标颜色 → 批量生成同款不同色
          </p>
        </header>

        {/* Step 1: 上传 - 可折叠 */}
        <CollapsibleSection
          icon={<Upload size={16} />} title="1. 上传产品图"
          subtitle={files.length > 0 ? `已上传 ${files.length} 张` : "最多 5 张"}
          isOpen={!collapsedSections.upload} onToggle={() => toggleSection("upload")}
          badge={files.length > 0 ? "success" : undefined}
        >
          {/* 上传区域 */}
          {files.length === 0 ? (
            <div
              className="upload-zone flex flex-col items-center justify-center"
              style={{ minHeight: '200px' }}
            >
              <Upload size={32} style={{ color: 'var(--text-tertiary)' }} />
              <div className="mt-3 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                点击选择图片 或 Ctrl+V 粘贴
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                支持 JPG、PNG、WebP，最多 5 张
              </div>
              <input
                type="file" accept="image/*" multiple
                onChange={(e) => e.target.files && onPickFiles(Array.from(e.target.files))}
                className="hidden" id="file-upload-input"
              />
              <button
                type="button"
                onClick={() => document.getElementById('file-upload-input')?.click()}
                className="btn btn-md btn-primary mt-4"
              >
                选择图片
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {files.map((f, i) => (
                <div key={i} className="relative group rounded-lg overflow-hidden"
                  style={{ aspectRatio: '3/4', border: '1px solid var(--border-base)', background: 'var(--bg-input)' }}>
                  <img src={compressedBlobs[i] ? URL.createObjectURL(compressedBlobs[i]) : URL.createObjectURL(f)}
                    alt={`原图 ${i + 1}`} className="w-full h-full object-contain" />
                  <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px]"
                    style={{ background: 'rgba(0,0,0,0.7)', color: '#fff' }}>{i + 1}</div>
                  {croppedFlags[i] && (
                    <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px]"
                      style={{ background: 'var(--success-500)', color: '#fff' }}>已裁</div>
                  )}
                  <div className="hover-overlay show">
                    <button type="button" onClick={() => setCroppingIndex(i)}
                      className="btn btn-sm btn-secondary mx-0.5">裁剪</button>
                    <button type="button" onClick={() => removeFile(i)}
                      className="btn btn-sm btn-danger mx-0.5">删除</button>
                  </div>
                </div>
              ))}
              {files.length < 5 && (
                <label
                  className="upload-zone flex flex-col items-center justify-center cursor-pointer"
                  style={{ aspectRatio: '3/4', border: '2px dashed var(--border-base)' }}>
                  <Plus size={20} style={{ color: 'var(--text-tertiary)' }} />
                  <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>添加</div>
                  <input type="file" accept="image/*" multiple
                    onChange={(e) => e.target.files && onPickFiles([...files, ...Array.from(e.target.files)].slice(0, 5))}
                    className="hidden" />
                </label>
              )}
            </div>
          )}
        </CollapsibleSection>

        {/* 裁剪模态 */}
        {croppingIndex !== null && compressedBlobs[croppingIndex] && (
          <ImageCropper
            imageSrc={URL.createObjectURL(compressedBlobs[croppingIndex])}
            initialAspect={0}
            onConfirm={(blob) => onCropConfirm(croppingIndex, blob)}
            onCancel={() => setCroppingIndex(null)}
          />
        )}

        {/* Step 2: 款式解析 - 可折叠 */}
        {files.length > 0 && (
          <CollapsibleSection
            icon={<Shirt size={16} />} title="2. 款式解析 + 材质"
            subtitle={garmentAttrs ? "已解析" : "可选"}
            isOpen={!collapsedSections.analyze}
            onToggle={() => toggleSection("analyze")}
            badge={garmentAttrs ? "success" : undefined}
          >
            <div className="mb-3">
              <button type="button" onClick={handleAnalyze}
                disabled={analyzing || compressedBlobs.length === 0}
                className="btn btn-md btn-primary">
                {analyzing ? <span className="spinner" /> : null}
                {analyzing ? "解析中..." : garmentAttrs ? "重新解析" : "解析款式"}
              </button>
            </div>
            {garmentAttrs && (
              <GarmentAttrsEditor attrs={garmentAttrs} onChange={updateGarmentAttr}
                onMaterialTextBlur={rematchMaterials} />
            )}
            {(garmentAttrs || selectedMaterials.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>匹配材质：</span>
                {selectedMaterials.map((m) => (
                  <span key={m.id} className="chip chip-brand flex items-center gap-1">
                    {m.name}
                    {m.english_name && <span className="text-xs font-mono ml-1" style={{ color: 'var(--primary)' }}>{m.english_name}</span>}
                    <button type="button" onClick={() => removeMaterial(m.id)} className="ml-1 hover:text-red-400">×</button>
                  </span>
                ))}
                <div className="relative">
                  <button type="button" onClick={() => setShowMaterialPicker((v) => !v)}
                    className="btn btn-sm btn-outline">+ 添加材质</button>
                  {showMaterialPicker && (
                    <div className="absolute top-full mt-1 left-0 z-10 rounded-lg border p-2 max-h-64 overflow-y-auto w-64"
                      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-base)' }}>
                      {unselectedMaterials.length === 0 ? (
                        <div className="text-xs p-2" style={{ color: 'var(--text-tertiary)' }}>所有材质都已添加</div>
                      ) : unselectedMaterials.map((m) => (
                        <button key={m.id} onClick={() => addMaterial(m.id)}
                          className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-white/5"
                          style={{ color: 'var(--text-primary)' }}>
                          <div className="font-medium">{m.name}</div>
                          {m.english_name && <div className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>{m.english_name}</div>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {selectedMaterials.length === 0 && garmentAttrs && (
              <p className="mt-2 text-xs" style={{ color: 'var(--warn-500)' }}>
                ⚠ 未匹配到任何材质，AI 可能误判面料
              </p>
            )}
          </CollapsibleSection>
        )}

        {/* Step 3: 真实感 - 可折叠 */}
        {realisms.length > 0 && (
          <CollapsibleSection
            icon={<Sparkles size={16} />} title="3. 真实感预设"
            subtitle={realismId ? "已选择" : "默认"}
            isOpen={!collapsedSections.realism}
            onToggle={() => toggleSection("realism")}
          >
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {realisms.map((r) => {
                const active = realismId === r.id;
                return (
                  <button key={r.id} type="button" onClick={() => setRealismId(r.id)}
                    className={`text-left p-3 rounded-lg border text-xs transition-all ${active ? "selected" : ""}`}
                    style={{
                      background: active ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-card)',
                      borderColor: active ? 'var(--primary)' : 'var(--border-subtle)',
                    }}>
                    <div className="font-medium flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                      {r.name}
                      {r.is_default === 1 && <span className="chip chip-success text-[10px]">默认</span>}
                    </div>
                    {r.description && <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{r.description}</div>}
                  </button>
                );
              })}
            </div>
          </CollapsibleSection>
        )}

        {/* Step 4: 颜色选择 - 可折叠 + 搜索 */}
        <CollapsibleSection
          icon={<Palette size={16} />} title="4. 选择目标颜色"
          subtitle={`已选 ${selectedColorIds.size + customColors.length} 个`}
          isOpen={!collapsedSections.color}
          onToggle={() => toggleSection("color")}
          badge={selectedColorIds.size + customColors.length > 0 ? "success" : undefined}
        >
          {/* 颜色搜索 */}
          <div className="mb-4">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
              <input
                type="text" placeholder="搜索颜色名称或色号（如：#FF0000、红色）"
                value={colorSearch} onChange={(e) => setColorSearch(e.target.value)}
                className="input pl-10"
              />
              {colorSearch && (
                <button type="button" onClick={() => setColorSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X size={14} style={{ color: 'var(--text-tertiary)' }} />
                </button>
              )}
            </div>
          </div>

          {colors.length === 0 ? (
            <div className="empty-state rounded-lg" style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-base)' }}>
              颜色库是空的，<a href="/admin/colors" style={{ color: 'var(--primary)' }} className="underline">去添加</a>，或使用下面的「临时颜色」
            </div>
          ) : (
            <div className="space-y-3">
              {groupedColors.orderedKeys.map((groupLabel) => (
                <div key={groupLabel}>
                  <button
                    type="button"
                    onClick={() => toggleColorGroup(groupLabel)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                    style={{
                      background: collapsedColorGroups[groupLabel] ? 'var(--bg-card)' : 'var(--bg-card-hover)',
                      color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {collapsedColorGroups[groupLabel] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <span>{groupLabel}</span>
                    <span className="text-xs ml-auto" style={{ color: 'var(--text-tertiary)' }}>
                      {groupedColors.groups.get(groupLabel)!.length} 个
                    </span>
                  </button>
                  {!collapsedColorGroups[groupLabel] && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mt-2">
                      {groupedColors.groups.get(groupLabel)!.map((c) => {
                        const active = selectedColorIds.has(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => toggleColor(c.id)}
                            className={`relative p-2 rounded-lg border text-left transition-all ${
                              active ? "selected" : ""
                            }`}
                            style={{
                              background: active ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-card)',
                              borderColor: active ? 'var(--primary)' : 'var(--border-subtle)',
                            }}
                          >
                            {c.is_popular ? (
                              <span className="absolute top-1 right-1 px-1 py-px rounded text-[9px] font-medium"
                                style={{ background: 'var(--warn-500)', color: '#fff' }}>热</span>
                            ) : null}
                            <div className="w-full rounded border" style={{ height: '40px', backgroundColor: c.hex, borderColor: 'rgba(0,0,0,0.1)' }} />
                            <div className="text-xs mt-1 truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</div>
                            <div className="text-[10px] font-mono truncate" style={{ color: 'var(--text-tertiary)' }}>{c.hex}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 临时颜色 */}
          <div className="mt-4 p-3 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            <div className="text-xs mb-2 flex items-center gap-2" style={{ color: 'var(--text-tertiary)' }}>
              <Plus size={12} /> 临时颜色（不保存到颜色库）
            </div>
            {customColors.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {customColors.map((c, i) => (
                  <span key={i} className="chip chip-brand flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full border" style={{ backgroundColor: c.hex, borderColor: 'rgba(0,0,0,0.2)' }} />
                    <span>{c.name}</span>
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{c.hex}</span>
                    <button type="button" onClick={() => removeCustomColor(i)} className="hover:text-red-400">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 items-center">
              <input type="color" value={customHex} onChange={(e) => setCustomHex(e.target.value)}
                className="rounded cursor-pointer" style={{ width: '36px', height: '36px' }} />
              <input type="text" placeholder="颜色名" value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomColor(); } }}
                className="input flex-1 min-w-[120px]" />
              <input type="text" value={customHex} onChange={(e) => setCustomHex(e.target.value)}
                className="input w-28 font-mono" />
              <button type="button" onClick={addCustomColor} disabled={!customName.trim()}
                className="btn btn-md btn-primary">
                <Plus size={14} /> 添加
              </button>
            </div>
          </div>
        </CollapsibleSection>
      </div>
      )}
    </AppShell>
  );
}

/* ═══════════════════ 可折叠区块组件 ═══════════════════ */
function CollapsibleSection({
  icon, title, subtitle, isOpen, onToggle, children, badge
}: {
  icon: React.ReactNode; title: string; subtitle?: string;
  isOpen: boolean; onToggle: () => void; children: React.ReactNode;
  badge?: "success" | "warning";
}) {
  return (
    <div className="mb-3">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all"
        style={{
          background: isOpen ? 'var(--bg-card)' : 'var(--bg-secondary)',
          border: `1px solid ${isOpen ? 'var(--border-glow)' : 'var(--border-subtle)'}`,
          color: 'var(--text-primary)', boxShadow: isOpen ? 'var(--shadow-glow)' : 'none',
        }}>
        <span style={{ color: 'var(--primary)' }}>{icon}</span>
        <span className="flex-1 text-left">{title}</span>
        {subtitle && <span className="text-xs mr-2" style={{ color: 'var(--text-tertiary)' }}>{subtitle}</span>}
        {badge === 'success' && <span className="chip chip-success text-[10px]"><Check size={10} /></span>}
        {isOpen ? <ChevronDown size={16} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />}
      </button>
      {isOpen && (
        <div className="p-4 rounded-b-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderTop: 'none' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ 右栏 - 换色版 ═══════════════════ */
function RightPanelRecolor({
  aiModels, model, onModelChange, aspectRatio, onAspectChange,
  qualityLevel, onQualityChange, userSeed, onUserSeedChange,
  totalCount, filesLen, colorsLen, estimate, submitting, canSubmit,
  onSubmit, onReset, poll, pollError, onDismissJob,
  hasActiveTask, viewMode, onSwitchView
}: {
  aiModels: AiModel[]; model: string; onModelChange: (m: string) => void;
  aspectRatio: string; onAspectChange: (a: string) => void;
  qualityLevel: QualityLevel; onQualityChange: (q: QualityLevel) => void;
  userSeed: string; onUserSeedChange: (s: string) => void;
  totalCount: number; filesLen: number; colorsLen: number;
  estimate: CostEstimate | null; submitting: boolean; canSubmit: boolean;
  onSubmit: () => void; onReset: () => void;
  poll: import("@/lib/hooks/use-job-polling").PollResult | null;
  pollError: string | null; onDismissJob: () => void;
  hasActiveTask: boolean; viewMode: "form" | "task"; onSwitchView: () => void;
}) {
  return (
    <div className="p-4 space-y-4">
      <NotificationStack />

      {hasActiveTask ? (
        <button type="button" onClick={onSwitchView}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs transition-colors"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--primary)', color: 'var(--text-primary)' }}>
          <span className="flex items-center gap-2">
            {poll && (poll.job.status === "running" || poll.job.status === "canceling") ? (
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--primary)', animation: 'pulse 1.5s infinite' }} />
            ) : null}
            {viewMode === "task" ? "返回编辑" : "查看进度"}
          </span>
          <span className="font-mono" style={{ color: 'var(--primary)' }}>
            {poll ? `${poll.job.completed_count}/${poll.job.total_count}` : ""}
          </span>
        </button>
      ) : null}

      {pollError && (
        <div className="p-2 rounded text-xs" style={{ background: 'var(--danger-50)', border: '1px solid var(--danger-500)', color: 'var(--danger-500)' }}>
          轮询失败：{pollError}
        </div>
      )}

      {/* 参数面板 */}
      <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>生成参数</div>
        <div>
          <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>AI 模型</div>
          {aiModels.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>暂无模型</div>
          ) : (
            <select value={model} onChange={(e) => onModelChange(e.target.value)} className="input">
              {aiModels.map((m) => (
                <option key={m.model_id} value={m.model_id}>{m.label}{m.badge ? ` (${m.badge})` : ""}</option>
              ))}
            </select>
          )}
        </div>
        <div>
          <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>输出比例</div>
          <select value={aspectRatio} onChange={(e) => onAspectChange(e.target.value)} className="input">
            {ASPECT_RATIOS.map((a) => (<option key={a.value} value={a.value}>{a.label}</option>))}
          </select>
        </div>
        <div>
          <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>清晰度</div>
          <select value={qualityLevel} onChange={(e) => onQualityChange(e.target.value as QualityLevel)} className="input">
            {QUALITY_LEVELS.map((q) => (<option key={q.value} value={q.value}>{q.label}</option>))}
          </select>
          <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {QUALITY_LEVELS.find((q) => q.value === qualityLevel)?.desc}
          </div>
        </div>
        <div>
          <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
            追加指令 <span className="font-normal">（可选）</span>
          </div>
          <textarea value={userSeed} onChange={(e) => onUserSeedChange(e.target.value)} rows={2}
            placeholder="例：保留蕾丝立体感，背景留白" className="input" />
        </div>
      </div>

      {/* 预估 */}
      {estimate && (
        <div className="rounded-xl p-4" style={{
          background: estimate.is_unlimited || estimate.affordable ? 'rgba(59, 130, 246, 0.1)' : 'rgba(245, 158, 11, 0.1)',
          border: `1px solid ${estimate.is_unlimited || estimate.affordable ? 'var(--primary)' : 'var(--warn-500)'}`,
        }}>
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>预估费用</span>
            <span className="text-xl font-bold" style={{ color: estimate.is_unlimited || estimate.affordable ? 'var(--primary)' : 'var(--warn-500)' }}>
              ¥{estimate.total_cost_cny.toFixed(2)}
            </span>
          </div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            ¥{estimate.per_image_cny.toFixed(3)} × {totalCount} 张（{filesLen} 图 × {colorsLen} 色）
          </div>
          <div className="mt-2 pt-2 text-xs" style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}>
            {estimate.is_unlimited ? "无限额度" : (
              <>余额 ¥{estimate.remaining_cny.toFixed(2)}{estimate.affordable ? " · 充足" : ` · 仅 ${estimate.can_afford_count} 张`}</>
            )}
          </div>
        </div>
      )}

      {/* 提交 */}
      <div className="space-y-2">
        <button onClick={onSubmit} disabled={!canSubmit || submitting} className="btn btn-lg btn-primary w-full">
          {submitting ? (<><span className="spinner" /> 提交中…</>) : (
            <>开始换色 <span className="text-xs opacity-80">· {totalCount} 张</span></>
          )}
        </button>
        <ResetButton label="清空" size="sm" variant="outline" onConfirm={onReset}
          confirmDetail="将清除已上传的图片、解析结果、选择的颜色和预设。当前正在进行的任务不受影响。" />
      </div>

      <div className="text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
        受 Google quota 限制，每分钟最多 2 张
      </div>
    </div>
  );
}

/* ═══════════════════ 子组件 ═══════════════════ */
function GarmentAttrsEditor({
  attrs, onChange, onMaterialTextBlur
}: {
  attrs: GarmentAttrs; onChange: (key: string, value: string) => void; onMaterialTextBlur: (value: string) => void;
}) {
  const entries = Object.entries(attrs).filter(([key]) => !key.startsWith("_"));
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {entries.map(([key, value]) => {
        const strValue = Array.isArray(value) ? value.join("、") : String(value);
        const isMaterial = key === "面料材质";
        return (
          <div key={key} className="p-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
              {key}
              {isMaterial && <span className="ml-1 text-[10px]" style={{ color: 'var(--primary)' }}>（失焦重匹配）</span>}
            </div>
            <input type="text" value={strValue} onChange={(e) => onChange(key, e.target.value)}
              onBlur={isMaterial ? (e) => onMaterialTextBlur(e.target.value) : undefined}
              className="input" />
          </div>
        );
      })}
    </div>
  );
}
