"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Palette, Sparkles, X, Upload, Crop as CropIcon, Search } from "lucide-react";
import { ImageCropper } from "@/app/_components/image-cropper";
import { AppShell } from "@/app/_components/app-shell";
import {
  NotificationStack,
  useNotifications,
  notifyHelpers,
} from "@/app/_components/notification-stack";
import { TaskViewport } from "@/app/_components/task-viewport";
import { TaskDock } from "@/app/_components/task-dock";
import { Thumbnail, ThumbnailBadge } from "@/app/_components/thumbnail";
import { ResetButton } from "@/app/_components/reset-button";
import {
  CollapsibleSection,
  Dropzone,
  SearchInput,
  extractFolderName,
} from "@/app/_components/ui";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useJobPolling } from "@/lib/hooks/use-job-polling";
import { useSlotStore } from "@/lib/stores/task-store";

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
  id: number;
  model_id: string;
  label: string;
  description: string | null;
  badge: string | null;
  is_default: 0 | 1;
};
type Material = {
  id: number;
  name: string;
  english_name: string | null;
  description: string | null;
};
type Realism = {
  id: number;
  name: string;
  description: string | null;
  is_default: 0 | 1;
};
type GarmentAttrs = Record<string, string | string[]>;

interface CostEstimate {
  per_image_cny: number;
  total_cost_cny: number;
  affordable: boolean;
  can_afford_count: number;
  is_unlimited: boolean;
  remaining_cny: number;
}

/* ─────────── 常量 ─────────── */

const ASPECT_RATIOS = [
  { value: "3:4", label: "3:4 竖（推荐）" },
  { value: "2:3", label: "2:3 竖" },
  { value: "4:5", label: "4:5 竖" },
  { value: "1:1", label: "1:1 方" },
  { value: "4:3", label: "4:3 横" },
  { value: "16:9", label: "16:9 横" },
] as const;

type QualityLevel = "hd" | "2k" | "4k";
const QUALITY_LEVELS: Array<{
  value: QualityLevel;
  label: string;
  desc: string;
}> = [
  { value: "2k", label: "2K 高清（推荐）", desc: "约 1792×2400" },
  { value: "4k", label: "4K 超清", desc: "约 3584×4800 · 贵 15x" },
  { value: "hd", label: "HD 清晰", desc: "约 896×1200 · 最省" },
];

// v2 色卡 9 色系展示顺序（label 文本，跟 api/colors 的 COLOR_GROUP_LABELS 对齐）
// 暖系（黄→橙→粉→红）→ 紫 → 中性 → 冷（蓝→绿）→ 深
const COLOR_GROUP_ORDER = [
  "黄色系",
  "橙色系",
  "粉色系",
  "红色系",
  "紫色系",
  "中性色系",
  "蓝色系",
  "绿色系",
  "深色系",
  // legacy（老数据残留）
  "粉/红色系",
];

/* ─────────── 客户端压缩 ─────────── */

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
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("压缩失败"))),
        "image/jpeg",
        0.95,
      );
    };
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = URL.createObjectURL(file);
  });
}

/* ─────────── 页面主组件 ─────────── */

export default function RecolorPage() {
  const user = useCurrentUser();
  const slotStore = useSlotStore("recolor");
  const { push } = useNotifications();

  // ─── 文件 + 裁剪 ───
  const [files, setFiles] = useState<File[]>([]);
  const [compressedBlobs, setCompressedBlobs] = useState<Blob[]>([]);
  const [croppedFlags, setCroppedFlags] = useState<boolean[]>([]);
  const [croppingIndex, setCroppingIndex] = useState<number | null>(null);
  /**
   * 用户选文件夹上传时抠出的根文件夹名（如 "DRESS-001"）。
   * 用作下载文件名 / ZIP 名前缀。null = 普通选图模式
   */
  const [sourceFolderName, setSourceFolderName] = useState<string | null>(null);

  // ─── 解析 ───
  const [analyzing, setAnalyzing] = useState(false);
  const [garmentAttrs, setGarmentAttrs] = useState<GarmentAttrs | null>(null);

  // ─── 配置 ───
  const [aspectRatio, setAspectRatio] = useState<string>("3:4");
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>("2k");
  const [userSeed, setUserSeed] = useState("");

  // ─── 素材库 ───
  const [allMaterials, setAllMaterials] = useState<Material[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<number[]>([]);
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);

  const [realisms, setRealisms] = useState<Realism[]>([]);
  const [realismId, setRealismId] = useState<number | null>(null);

  const [colors, setColors] = useState<Color[]>([]);
  const [selectedColorIds, setSelectedColorIds] = useState<Set<number>>(
    new Set(),
  );
  const [colorQuery, setColorQuery] = useState(""); // 颜色搜索

  const [customColors, setCustomColors] = useState<
    Array<{ name: string; hex: string }>
  >([]);
  const [customName, setCustomName] = useState("");
  const [customHex, setCustomHex] = useState("#722F37");

  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  const [model, setModel] = useState<string>("");

  // ─── 提交 / 任务 ───
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(
    () => slotStore.get<string>("activeJobId") ?? null,
  );
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [viewMode, setViewMode] = useState<"form" | "task">(
    () => (slotStore.get<string>("activeJobId") ? "task" : "form"),
  );

  // ─── 估价 ───
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);

  /* ─── 初始数据加载 + slot 恢复 ─── */
  useEffect(() => {
    fetch("/api/colors")
      .then((r) => (r.ok ? r.json() : []))
      .then(setColors)
      .catch(() => {});
    fetch("/api/ai-models?category=image_gen")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: AiModel[]) => {
        setAiModels(list);
        const saved = slotStore.get<string>("model");
        const def =
          saved ||
          list.find((m) => m.is_default === 1)?.model_id ||
          list[0]?.model_id;
        if (def) setModel(def);
      })
      .catch(() => {});
    fetch("/api/materials")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAllMaterials)
      .catch(() => {});
    fetch("/api/realism")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Realism[]) => {
        setRealisms(list);
        const savedId = slotStore.get<number>("realismId");
        const def =
          savedId || list.find((r) => r.is_default === 1)?.id || list[0]?.id;
        if (def) setRealismId(def);
      })
      .catch(() => {});

    const savedAspect = slotStore.get<string>("aspectRatio");
    if (savedAspect) setAspectRatio(savedAspect);
    const savedQuality = slotStore.get<QualityLevel>("qualityLevel");
    if (savedQuality) setQualityLevel(savedQuality);
    const savedSeed = slotStore.get<string>("userSeed");
    if (savedSeed) setUserSeed(savedSeed);
    const savedColorIds = slotStore.get<number[]>("selectedColorIds");
    if (savedColorIds) setSelectedColorIds(new Set(savedColorIds));
    const savedCustomColors =
      slotStore.get<Array<{ name: string; hex: string }>>("customColors");
    if (savedCustomColors) setCustomColors(savedCustomColors);
    const savedGarment = slotStore.get<GarmentAttrs>("garmentAttrs");
    if (savedGarment) setGarmentAttrs(savedGarment);
    const savedMatIds = slotStore.get<number[]>("selectedMaterialIds");
    if (savedMatIds) setSelectedMaterialIds(savedMatIds);

    fetch("/api/jobs/active")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => setActiveJobCount(d.count || 0))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── 持久化 ─── */
  useEffect(() => {
    slotStore.merge({
      aspectRatio,
      qualityLevel,
      userSeed,
      model,
      realismId,
      selectedColorIds: Array.from(selectedColorIds),
      customColors,
      selectedMaterialIds,
      garmentAttrs,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    aspectRatio,
    qualityLevel,
    userSeed,
    model,
    realismId,
    selectedColorIds,
    customColors,
    selectedMaterialIds,
    garmentAttrs,
  ]);

  const totalCount = useMemo(() => {
    const c = selectedColorIds.size + customColors.length;
    return files.length * c;
  }, [files.length, selectedColorIds, customColors.length]);

  /* ─── 临时颜色操作 ─── */
  function addCustomColor() {
    const name = customName.trim();
    if (!name) {
      notifyHelpers.warn(push, "请先输入颜色名");
      return;
    }
    if (
      customColors.some(
        (c) =>
          c.name === name || c.hex.toLowerCase() === customHex.toLowerCase(),
      )
    ) {
      notifyHelpers.warn(push, "已有同名或同色号的临时色");
      return;
    }
    setCustomColors((prev) => [...prev, { name, hex: customHex }]);
    setCustomName("");
  }

  function removeCustomColor(i: number) {
    setCustomColors((prev) => prev.filter((_, idx) => idx !== i));
  }

  /* ─── 估价 ─── */
  useEffect(() => {
    if (totalCount === 0 || !model) {
      setEstimate(null);
      return;
    }
    const t = setTimeout(() => {
      fetch("/api/billing/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          quality_level: qualityLevel,
          image_count: totalCount,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          setEstimate({
            per_image_cny: data.estimate.per_image_cny,
            total_cost_cny: data.estimate.total_cost_cny,
            affordable: data.affordable,
            can_afford_count: data.can_afford_count,
            is_unlimited: data.budget.is_unlimited,
            remaining_cny: data.budget.remaining_cny,
          });
        })
        .catch(() => setEstimate(null));
    }, 300);
    return () => clearTimeout(t);
  }, [totalCount, model, qualityLevel]);

  /* ─── 轮询 ─── */
  const handleJobFinished = useCallback(() => {
    fetch("/api/jobs/active")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => setActiveJobCount(d.count || 0))
      .catch(() => {});
  }, []);

  const polling = useJobPolling(activeJobId, {
    intervalMs: 1500,
    onFinished: (result) => {
      handleJobFinished();
      const { job } = result;
      if (job.status === "completed") {
        notifyHelpers.success(
          push,
          `换色任务完成 · ${job.completed_count}/${job.total_count}`,
          job.failed_count > 0
            ? `${job.failed_count} 张失败，其余已完成。`
            : undefined,
        );
      } else if (job.status === "canceled") {
        notifyHelpers.info(
          push,
          `任务已停止`,
          `已完成 ${job.completed_count} / 共 ${job.total_count}，剩余已跳过`,
        );
      } else if (job.status === "failed") {
        notifyHelpers.error(
          push,
          `任务失败`,
          job.error_message || "请查看详细日志",
        );
      }
    },
  });

  useEffect(() => {
    if (polling.error && polling.error.includes("不存在")) {
      setActiveJobId(null);
      slotStore.setActiveJob(null);
      setViewMode("form");
      notifyHelpers.warn(
        push,
        "任务已被清理",
        "任务不存在或已被删除，已回到表单",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling.error]);

  /* ─── 文件处理 ─── */
  async function onPickFiles(picked: File[]) {
    if (picked.length === 0) {
      setFiles([]);
      setCompressedBlobs([]);
      setGarmentAttrs(null);
      setSelectedMaterialIds([]);
      setSourceFolderName(null);
      return;
    }
    const trimmed = picked.slice(0, 50);

    // 文件夹选择模式：抠出根文件夹名作为下载命名前缀
    // （普通文件 / 拖拽时 webkitRelativePath 是空的，extractFolderName 返回 null）
    const folder = extractFolderName(trimmed);
    if (folder) {
      setSourceFolderName(folder);
      notifyHelpers.info(
        push,
        `从文件夹"${folder}"导入`,
        `${trimmed.length} 张图。下载时会按此名称命名。`,
      );
    } else {
      setSourceFolderName(null);
    }

    setFiles(trimmed);
    setCompressedBlobs([]);
    setCroppedFlags(new Array(trimmed.length).fill(false));
    setGarmentAttrs(null);
    setSelectedMaterialIds([]);
    try {
      const blobs = await Promise.all(
        trimmed.map((f) => resizeImage(f, 2048)),
      );
      setCompressedBlobs(blobs);
    } catch (e) {
      notifyHelpers.error(
        push,
        "图片读取失败",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  function onCropConfirm(i: number, blob: Blob) {
    setCompressedBlobs((prev) => {
      const next = [...prev];
      next[i] = blob;
      return next;
    });
    setCroppedFlags((prev) => {
      const next = [...prev];
      next[i] = true;
      return next;
    });
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
      notifyHelpers.warn(push, "请先上传图片");
      return;
    }
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("image0", compressedBlobs[0], files[0].name);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      if (!res.ok) {
        throw new Error((await res.json()).error || res.statusText);
      }
      const attrs = (await res.json()) as GarmentAttrs;
      setGarmentAttrs(attrs);
      await rematchMaterials(String(attrs["面料材质"] || ""));
      notifyHelpers.success(push, "款式解析完成");
    } catch (e) {
      notifyHelpers.error(
        push,
        "款式解析失败",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setAnalyzing(false);
    }
  }

  async function rematchMaterials(materialText: string) {
    if (!materialText) {
      setSelectedMaterialIds([]);
      return;
    }
    try {
      const mRes = await fetch("/api/materials/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    setSelectedMaterialIds((prev) =>
      prev.includes(id) ? prev : [...prev, id],
    );
    setShowMaterialPicker(false);
  }
  function removeMaterial(id: number) {
    setSelectedMaterialIds((prev) => prev.filter((x) => x !== id));
  }

  const selectedMaterials = selectedMaterialIds
    .map((id) => allMaterials.find((m) => m.id === id))
    .filter(Boolean) as Material[];
  const unselectedMaterials = allMaterials.filter(
    (m) => !selectedMaterialIds.includes(m.id),
  );

  /* ─── 颜色：搜索 + 分组 ─── */
  const colorGroups = useMemo(() => {
    // 1) 应用搜索过滤（按 name 或 hex 模糊匹配，不区分大小写）
    const q = colorQuery.trim().toLowerCase();
    const filtered = q
      ? colors.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.hex.toLowerCase().includes(q),
        )
      : colors;

    // 2) 按 color_group_label 分组
    const groups = new Map<string, Color[]>();
    for (const c of filtered) {
      const key = c.color_group_label || "未分类";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }

    // 3) 按预设顺序排列
    const orderedKeys = [
      ...COLOR_GROUP_ORDER.filter((k) => groups.has(k)),
      ...Array.from(groups.keys()).filter(
        (k) => !COLOR_GROUP_ORDER.includes(k),
      ),
    ];
    return orderedKeys.map((key) => ({ key, items: groups.get(key)! }));
  }, [colors, colorQuery]);

  const totalFilteredColors = useMemo(
    () => colorGroups.reduce((acc, g) => acc + g.items.length, 0),
    [colorGroups],
  );

  /* ─── 提交 ─── */
  async function handleSubmit() {
    if (compressedBlobs.length === 0 || files.length === 0) {
      notifyHelpers.warn(push, "请先上传产品图");
      return;
    }
    const colorCount = selectedColorIds.size + customColors.length;
    if (colorCount === 0) {
      notifyHelpers.warn(push, "请至少选择一个颜色，或添加临时颜色");
      return;
    }

    if (estimate && !estimate.affordable && !estimate.is_unlimited) {
      const ok = confirm(
        `预估花费 ¥${estimate.total_cost_cny.toFixed(2)}，` +
          `超过你当前余额 ¥${estimate.remaining_cny.toFixed(2)}。\n\n` +
          `建议把任务数减到 ${estimate.can_afford_count} 张以内。\n\n` +
          `仍要提交吗？（服务端会拒绝或只完成一部分）`,
      );
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      compressedBlobs.forEach((blob, i) => {
        fd.append(`image${i}`, blob, files[i].name);
      });
      if (selectedColorIds.size > 0) {
        fd.append("color_ids", JSON.stringify([...selectedColorIds]));
      }
      if (customColors.length > 0) {
        fd.append("custom_colors", JSON.stringify(customColors));
      }
      fd.append("model", model);
      if (aspectRatio) fd.append("aspect_ratio", aspectRatio);
      fd.append("quality_level", qualityLevel);
      if (selectedMaterialIds.length > 0) {
        fd.append("material_ids", JSON.stringify(selectedMaterialIds));
      }
      if (realismId) fd.append("realism_id", String(realismId));
      if (garmentAttrs) fd.append("garment_attrs", JSON.stringify(garmentAttrs));
      if (userSeed.trim()) fd.append("user_seed", userSeed.trim());
      if (sourceFolderName) fd.append("source_folder", sourceFolderName);

      const res = await fetch("/api/jobs/recolor", {
        method: "POST",
        body: fd,
      });
      const body = (await res.json()) as { job_id?: string; error?: string };
      if (!res.ok || !body.job_id) {
        throw new Error(body.error || res.statusText);
      }
      setActiveJobId(body.job_id);
      slotStore.setActiveJob(body.job_id);
      setActiveJobCount((v) => v + 1);
      setViewMode("task");
      notifyHelpers.info(
        push,
        `任务已提交`,
        `共 ${totalCount} 张 · 受 quota 限制，预计耗时 ${Math.ceil(totalCount / 2)}+ 分钟`,
      );
    } catch (e) {
      notifyHelpers.error(
        push,
        "提交失败",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setSubmitting(false);
    }
  }

  /* ─── 重置 ─── */
  function resetAll() {
    setFiles([]);
    setCompressedBlobs([]);
    setCroppedFlags([]);
    setGarmentAttrs(null);
    setSelectedMaterialIds([]);
    setSelectedColorIds(new Set());
    setCustomColors([]);
    setCustomName("");
    setUserSeed("");
    setColorQuery("");
    setSourceFolderName(null);
    setActiveJobId(null);
    slotStore.reset();
    notifyHelpers.info(push, "已清空当前任务");
  }

  function dismissCurrentJob() {
    setActiveJobId(null);
    slotStore.setActiveJob(null);
  }

  if (!user) {
    return <div className="p-8 text-fg-tertiary text-sm">正在加载…</div>;
  }

  /* ─────────── 渲染 ─────────── */

  const showTaskViewport = viewMode === "task" && polling.data;

  return (
    <AppShell
      leftNav={{ user, activeJobCount }}
      rightPanel={
        <RightPanel
          aiModels={aiModels}
          model={model}
          onModelChange={setModel}
          aspectRatio={aspectRatio}
          onAspectChange={setAspectRatio}
          qualityLevel={qualityLevel}
          onQualityChange={setQualityLevel}
          userSeed={userSeed}
          onUserSeedChange={setUserSeed}
          totalCount={totalCount}
          filesLen={files.length}
          colorsLen={selectedColorIds.size + customColors.length}
          estimate={estimate}
          submitting={submitting}
          canSubmit={files.length > 0 && totalCount > 0 && !analyzing}
          onSubmit={handleSubmit}
          onReset={resetAll}
          poll={polling.data}
          pollError={polling.error}
          onDismissJob={dismissCurrentJob}
          hasActiveTask={Boolean(polling.data)}
          viewMode={viewMode}
          onSwitchView={() =>
            setViewMode((m) => (m === "task" ? "form" : "task"))
          }
        />
      }
    >
      {showTaskViewport && polling.data ? (
        <TaskViewport
          job={polling.data.job}
          items={polling.data.items}
          nextTokenReadyAtMs={polling.data.next_token_ready_at_ms}
          serverTimeMs={polling.data.server_time_ms}
          onBackToForm={() => setViewMode("form")}
          onStartNew={() => {
            resetAll();
            setViewMode("form");
          }}
          zipPrefix={(() => {
            // 优先用上传时的文件夹名（"DRESS-001_recolor"）；fallback 到通用 "recolor"
            try {
              const params = polling.data.job.params
                ? (JSON.parse(polling.data.job.params) as {
                    source_folder?: string;
                  })
                : null;
              if (params?.source_folder)
                return `${params.source_folder}_recolor`;
            } catch {}
            return sourceFolderName
              ? `${sourceFolderName}_recolor`
              : "recolor";
          })()}
          makeFilename={(it) => {
            // 拿任务的 source_folder（轮询数据里的）作为前缀
            let folderPrefix = "";
            try {
              const params = polling.data?.job.params
                ? (JSON.parse(polling.data.job.params) as {
                    source_folder?: string;
                  })
                : null;
              folderPrefix = params?.source_folder
                ? `${params.source_folder}_`
                : sourceFolderName
                  ? `${sourceFolderName}_`
                  : "";
            } catch {}
            const safe = (it.label || `item_${it.idx + 1}`).replace(
              /[/\\?%*:|"<>]/g,
              "_",
            );
            return `${folderPrefix}${safe}.png`;
          }}
        />
      ) : (
        <div className="mx-auto w-full max-w-7xl px-5 md:px-8 py-6 md:py-8">
          <header className="mb-6 flex items-center gap-3">
            <span
              className="w-10 h-10 rounded-md flex items-center justify-center text-white"
              style={{
                background: "var(--brand-gradient)",
                boxShadow: "0 0 16px var(--brand-glow)",
              }}
            >
              <Palette size={18} strokeWidth={2.2} />
            </span>
            <div>
              <h1 className="text-[22px] font-bold text-fg-primary tracking-tight">
                HEX 精准换色
              </h1>
              <p className="mt-0.5 text-[13px] text-fg-tertiary">
                上传 → 解析款式 + 识别材质 → 选颜色批量生成
              </p>
            </div>
          </header>

          {/* 任务看板 —— 持久化展示我的最近任务 */}
          <TaskDock feature="recolor" />

          <div className="space-y-4">
            {/* Step 1: 上传 */}
            <CollapsibleSection
              title="① 上传产品图"
              description="最多 50 张同款不同角度 · 拖拽 / 点击 / Ctrl+V 粘贴"
              defaultOpen
            >
              {files.length === 0 ? (
                <Dropzone
                  accept="image/*"
                  multiple
                  enableDirectoryPicker
                  onFiles={onPickFiles}
                  icon={<Upload size={28} strokeWidth={1.6} />}
                  title="拖拽 / 点击 / Ctrl+V 粘贴上传产品图"
                  description="支持多张同时上传（最多 50 张），或选择整个文件夹"
                />
              ) : (
                <div className="space-y-3">
                  {sourceFolderName ? (
                    <div className="flex items-center gap-2 text-[12px] text-fg-secondary">
                      <span className="chip chip-brand text-[11px]">
                        📁 {sourceFolderName}
                      </span>
                      <span className="text-fg-tertiary">
                        下载会用此文件夹名命名
                      </span>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
                    {files.map((f, i) => (
                      <Thumbnail
                        key={i}
                        src={
                          compressedBlobs[i]
                            ? URL.createObjectURL(compressedBlobs[i])
                            : URL.createObjectURL(f)
                        }
                        alt={`原图 ${i + 1}`}
                        ratio="3/4"
                        fit="contain"
                        selected={croppedFlags[i]}
                        checkbox={
                          <span
                            className="w-5 h-5 rounded text-white text-[10px] flex items-center justify-center"
                            style={{ background: "rgba(0, 0, 0, 0.6)" }}
                          >
                            {i + 1}
                          </span>
                        }
                        badge={
                          croppedFlags[i] ? (
                            <ThumbnailBadge tone="green">已裁</ThumbnailBadge>
                          ) : undefined
                        }
                        hoverOverlay={
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCroppingIndex(i);
                              }}
                              className="px-3 py-1 bg-white/95 text-gray-900 text-xs rounded hover:bg-white flex items-center gap-1"
                            >
                              <CropIcon size={11} strokeWidth={2.2} />
                              裁剪
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFile(i);
                              }}
                              className="px-3 py-1 text-white text-xs rounded flex items-center gap-1"
                              style={{ background: "var(--danger)" }}
                            >
                              <X size={11} strokeWidth={2.2} />
                              删除
                            </button>
                          </div>
                        }
                      />
                    ))}
                  </div>
                  {files.length < 50 && (
                    <Dropzone
                      accept="image/*"
                      multiple
                      onFiles={(more) =>
                        onPickFiles([...files, ...more].slice(0, 50))
                      }
                      compact
                      className="aspect-[5/1] flex items-center justify-center"
                    >
                      <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-tertiary pointer-events-none gap-2">
                        <Upload size={14} strokeWidth={1.8} />
                        继续添加（{50 - files.length} 张剩余 · 支持 Ctrl+V）
                      </div>
                    </Dropzone>
                  )}
                </div>
              )}
            </CollapsibleSection>

            {croppingIndex !== null && compressedBlobs[croppingIndex] && (
              <ImageCropper
                imageSrc={URL.createObjectURL(compressedBlobs[croppingIndex])}
                initialAspect={0}
                onConfirm={(blob) => onCropConfirm(croppingIndex, blob)}
                onCancel={() => setCroppingIndex(null)}
              />
            )}

            {/* Step 2: 款式解析 */}
            {files.length > 0 && (
              <CollapsibleSection
                title="② 款式解析"
                description="可选 · 解析结果可编辑"
                defaultOpen={!!garmentAttrs}
              >
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={handleAnalyze}
                    disabled={analyzing || compressedBlobs.length === 0}
                    className="btn btn-secondary btn-sm"
                  >
                    <Sparkles size={12} strokeWidth={2.2} />
                    {analyzing
                      ? "解析中..."
                      : garmentAttrs
                        ? "重新解析"
                        : "解析款式"}
                  </button>
                </div>
                {garmentAttrs && (
                  <GarmentAttrsEditor
                    attrs={garmentAttrs}
                    onChange={updateGarmentAttr}
                    onMaterialTextBlur={rematchMaterials}
                  />
                )}
              </CollapsibleSection>
            )}

            {/* Step 3: 材质 —— 始终显示，简单款式不解析也能直接选 */}
            <CollapsibleSection
              title="③ 服装材质"
              description={
                garmentAttrs
                  ? "解析自动匹配，可手动增删"
                  : "可手动选择 · 简单款式无需解析"
              }
              badge={
                selectedMaterials.length > 0
                  ? selectedMaterials.length
                  : undefined
              }
              defaultOpen
            >
              <div className="flex flex-wrap gap-2 items-center">
                {selectedMaterials.map((m) => (
                  <span
                    key={m.id}
                    className="inline-flex items-center gap-1.5 chip chip-brand"
                  >
                    <span>{m.name}</span>
                    {m.english_name && (
                      <span className="text-[10px] text-brand-400/80 font-mono">
                        {m.english_name}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeMaterial(m.id)}
                      className="ml-0.5 opacity-60 hover:opacity-100 hover:text-danger"
                    >
                      <X size={10} strokeWidth={2.5} />
                    </button>
                  </span>
                ))}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowMaterialPicker((v) => !v)}
                    className="px-3 py-0.5 h-[22px] rounded-full border border-dashed border-border-default text-[11px] text-fg-tertiary hover:border-brand-500 hover:text-brand-400 inline-flex items-center"
                  >
                    + 添加材质
                  </button>
                  {showMaterialPicker && (
                    <div className="absolute top-full mt-1 left-0 z-20 bg-bg-elevated border border-border-default rounded-md shadow-lg p-2 max-h-64 overflow-y-auto w-72 animate-fade-in">
                      {unselectedMaterials.length === 0 ? (
                        <div className="text-xs text-fg-tertiary p-2">
                          {allMaterials.length === 0
                            ? "材质库为空，请联系管理员添加"
                            : "所有材质都已添加"}
                        </div>
                      ) : (
                        unselectedMaterials.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => addMaterial(m.id)}
                            className="w-full text-left px-2 py-1.5 rounded hover:bg-bg-hover text-fg-primary"
                          >
                            <div className="text-sm font-medium">
                              {m.name}
                              {m.english_name && (
                                <span className="ml-1 text-xs text-fg-tertiary font-mono">
                                  {m.english_name}
                                </span>
                              )}
                            </div>
                            {m.description && (
                              <div className="text-xs text-fg-tertiary mt-0.5 truncate">
                                {m.description}
                              </div>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
              {selectedMaterials.length === 0 ? (
                <MaterialMissingHint files={files} hasGarmentAttrs={!!garmentAttrs} />
              ) : null}
            </CollapsibleSection>

            {/* Step 4: 真实感 */}
            {realisms.length > 0 && (
              <CollapsibleSection
                title="④ 真实感预设"
                description="控制皮肤 / 发丝真实度"
                defaultOpen={false}
              >
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                  {realisms.map((r) => {
                    const active = realismId === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setRealismId(r.id)}
                        className={`text-left p-3 rounded-md border text-[12px] transition-colors ${
                          active
                            ? "border-transparent text-fg-primary"
                            : "border-border-default text-fg-secondary hover:border-border-strong hover:bg-bg-hover"
                        }`}
                        style={
                          active
                            ? {
                                background: "var(--brand-50-bg)",
                                borderColor: "rgba(59, 130, 246, 0.4)",
                              }
                            : undefined
                        }
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{r.name}</span>
                          {r.is_default === 1 && (
                            <span className="chip chip-success text-[10px]">
                              默认
                            </span>
                          )}
                        </div>
                        {r.description && (
                          <div className="text-fg-tertiary mt-0.5 text-[11px]">
                            {r.description}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </CollapsibleSection>
            )}

            {/* Step 5: 颜色（含搜索 + 折叠分组）*/}
            <CollapsibleSection
              title="⑤ 选择目标颜色"
              description={
                selectedColorIds.size + customColors.length > 0
                  ? `已选 ${selectedColorIds.size + customColors.length} 个`
                  : "可多选 · 按色系折叠 · 支持搜索"
              }
              badge={
                selectedColorIds.size + customColors.length > 0
                  ? selectedColorIds.size + customColors.length
                  : undefined
              }
              headerExtra={
                <div className="w-56">
                  <SearchInput
                    placeholder="搜色名 / 色号（如 酒红 / #722F37）"
                    value={colorQuery}
                    onChange={(e) => setColorQuery(e.target.value)}
                    onClear={() => setColorQuery("")}
                    size="sm"
                  />
                </div>
              }
              defaultOpen
            >
              {colors.length === 0 ? (
                <div className="text-xs text-fg-tertiary p-3 bg-bg-tertiary rounded-md border border-dashed border-border-default">
                  颜色库是空的，
                  <a
                    href="/admin/colors"
                    className="text-brand-400 hover:underline"
                  >
                    去添加
                  </a>
                  ，或使用下面的「临时颜色」
                </div>
              ) : totalFilteredColors === 0 ? (
                <div className="text-center py-8 text-[13px] text-fg-tertiary">
                  <Search
                    size={20}
                    strokeWidth={1.6}
                    className="mx-auto mb-2 opacity-50"
                  />
                  没有匹配「{colorQuery}」的颜色
                </div>
              ) : (
                <div className="space-y-2">
                  {colorGroups.map((g, idx) => {
                    const selectedInGroup = g.items.filter((c) =>
                      selectedColorIds.has(c.id),
                    ).length;
                    return (
                      <CollapsibleSection
                        key={g.key}
                        variant="minimal"
                        title={g.key}
                        badge={
                          selectedInGroup > 0
                            ? `${selectedInGroup}/${g.items.length}`
                            : g.items.length
                        }
                        // 搜索时全部展开；否则展开第一组 + 当前选中所属组
                        defaultOpen={
                          colorQuery.trim().length > 0 ||
                          idx === 0 ||
                          g.items.some((c) => selectedColorIds.has(c.id))
                        }
                      >
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 mt-2">
                          {g.items.map((c) => {
                            const active = selectedColorIds.has(c.id);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => toggleColor(c.id)}
                                className={`relative p-2 rounded-md border text-left transition-colors ${
                                  active
                                    ? "border-transparent ring-2 ring-brand-500 ring-offset-2 ring-offset-bg-primary"
                                    : "border-border-default hover:border-border-strong"
                                }`}
                                style={
                                  active
                                    ? { background: "var(--brand-50-bg)" }
                                    : undefined
                                }
                              >
                                {c.is_popular ? (
                                  <span
                                    className="absolute top-1 right-1 px-1 py-px rounded text-[9px] font-medium leading-none border"
                                    style={{
                                      background: "var(--warn-bg)",
                                      borderColor: "rgba(245, 158, 11, 0.3)",
                                      color: "var(--warn)",
                                    }}
                                  >
                                    流行
                                  </span>
                                ) : null}
                                <div
                                  className="w-full h-10 rounded border border-border-subtle"
                                  style={{ backgroundColor: c.hex }}
                                />
                                <div className="text-[12px] mt-1.5 truncate text-fg-primary">
                                  {c.name}
                                </div>
                                <div className="text-[10px] text-fg-tertiary font-mono truncate">
                                  {c.hex}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </CollapsibleSection>
                    );
                  })}
                </div>
              )}

              {/* 临时颜色 */}
              <div className="mt-4 p-4 rounded-md border border-border-subtle bg-bg-tertiary">
                <div className="text-[11px] text-fg-tertiary mb-2.5">
                  临时颜色（可选） · 不保存到颜色库，但本次任务会参与生成
                </div>

                {customColors.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {customColors.map((c, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-bg-secondary border text-[12px] text-fg-primary"
                        style={{ borderColor: "rgba(59, 130, 246, 0.4)" }}
                      >
                        <span
                          className="w-4 h-4 rounded-full border border-border-subtle"
                          style={{ backgroundColor: c.hex }}
                        />
                        <span>{c.name}</span>
                        <span className="text-[10px] text-fg-tertiary font-mono">
                          {c.hex}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeCustomColor(i)}
                          className="ml-0.5 text-fg-tertiary hover:text-danger"
                          aria-label="移除"
                        >
                          <X size={10} strokeWidth={2.5} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    type="color"
                    value={customHex}
                    onChange={(e) => setCustomHex(e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border-0 bg-transparent"
                    title="选色号"
                  />
                  <input
                    type="text"
                    placeholder="颜色名"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomColor();
                      }
                    }}
                    className="input flex-1 min-w-[140px] h-9 text-[12px]"
                  />
                  <input
                    type="text"
                    value={customHex}
                    onChange={(e) => setCustomHex(e.target.value)}
                    className="input w-24 h-9 text-[12px] font-mono"
                  />
                  <button
                    type="button"
                    onClick={addCustomColor}
                    disabled={!customName.trim()}
                    className="btn btn-primary btn-md"
                  >
                    + 添加
                  </button>
                </div>
              </div>
            </CollapsibleSection>
          </div>
        </div>
      )}
    </AppShell>
  );
}

/* ─────────── 右栏 ─────────── */

function RightPanel({
  aiModels,
  model,
  onModelChange,
  aspectRatio,
  onAspectChange,
  qualityLevel,
  onQualityChange,
  userSeed,
  onUserSeedChange,
  totalCount,
  filesLen,
  colorsLen,
  estimate,
  submitting,
  canSubmit,
  onSubmit,
  onReset,
  poll,
  pollError,
  onDismissJob: _onDismissJob,
  hasActiveTask,
  viewMode,
  onSwitchView,
}: {
  aiModels: AiModel[];
  model: string;
  onModelChange: (m: string) => void;
  aspectRatio: string;
  onAspectChange: (a: string) => void;
  qualityLevel: QualityLevel;
  onQualityChange: (q: QualityLevel) => void;
  userSeed: string;
  onUserSeedChange: (s: string) => void;
  totalCount: number;
  filesLen: number;
  colorsLen: number;
  estimate: CostEstimate | null;
  submitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onReset: () => void;
  poll: import("@/lib/hooks/use-job-polling").PollResult | null;
  pollError: string | null;
  onDismissJob: () => void;
  hasActiveTask: boolean;
  viewMode: "form" | "task";
  onSwitchView: () => void;
}) {
  return (
    <div className="p-4 space-y-3 text-sm">
      <NotificationStack />

      {hasActiveTask ? (
        <button
          type="button"
          onClick={onSwitchView}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-md border text-xs transition-colors"
          style={{
            background: "var(--brand-50-bg)",
            borderColor: "rgba(59, 130, 246, 0.3)",
            color: "var(--brand-400)",
          }}
        >
          <span className="flex items-center gap-2">
            {poll &&
            (poll.job.status === "running" ||
              poll.job.status === "canceling") ? (
              <span className="status-dot status-dot-success status-dot-pulse" />
            ) : null}
            {viewMode === "task"
              ? "切到「表单」编辑"
              : "切到「任务视窗」看进度"}
          </span>
          <span className="text-[11px] font-mono opacity-90">
            {poll ? `${poll.job.completed_count}/${poll.job.total_count}` : ""}
          </span>
        </button>
      ) : null}

      {pollError ? (
        <div
          className="p-2.5 rounded border text-xs"
          style={{
            background: "var(--danger-bg)",
            borderColor: "rgba(239, 68, 68, 0.3)",
            color: "var(--danger)",
          }}
        >
          轮询失败：{pollError}
        </div>
      ) : null}

      {/* 生成参数 */}
      <div className="card p-4 space-y-3">
        <div className="section-label">生成参数</div>

        <div>
          <div className="text-[11px] text-fg-tertiary mb-1.5">模型</div>
          {aiModels.length === 0 ? (
            <div className="text-xs text-fg-tertiary">暂无模型</div>
          ) : (
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="input select text-[12px] h-9"
            >
              {aiModels.map((m) => (
                <option key={m.model_id} value={m.model_id}>
                  {m.label}
                  {m.badge ? ` (${m.badge})` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <div className="text-[11px] text-fg-tertiary mb-1.5">输出比例</div>
          <select
            value={aspectRatio}
            onChange={(e) => onAspectChange(e.target.value)}
            className="input select text-[12px] h-9"
          >
            {ASPECT_RATIOS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="text-[11px] text-fg-tertiary mb-1.5">清晰度</div>
          <select
            value={qualityLevel}
            onChange={(e) => onQualityChange(e.target.value as QualityLevel)}
            className="input select text-[12px] h-9"
          >
            {QUALITY_LEVELS.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
          <div className="text-[10px] text-fg-muted mt-1">
            {QUALITY_LEVELS.find((q) => q.value === qualityLevel)?.desc}
          </div>
        </div>

        <div>
          <div className="text-[11px] text-fg-tertiary mb-1.5">
            追加指令{" "}
            <span className="text-fg-muted font-normal">（可选）</span>
          </div>
          <textarea
            value={userSeed}
            onChange={(e) => onUserSeedChange(e.target.value)}
            rows={2}
            placeholder="例：保留蕾丝立体感，背景留白"
            className="input text-[12px] resize-none"
          />
        </div>
      </div>

      {estimate && (
        <div
          className="rounded-md border p-3 text-xs"
          style={{
            background:
              estimate.is_unlimited || estimate.affordable
                ? "var(--brand-50-bg)"
                : "var(--warn-bg)",
            borderColor:
              estimate.is_unlimited || estimate.affordable
                ? "rgba(59, 130, 246, 0.3)"
                : "rgba(245, 158, 11, 0.3)",
            color:
              estimate.is_unlimited || estimate.affordable
                ? "var(--brand-400)"
                : "var(--warn)",
          }}
        >
          <div className="flex justify-between items-baseline mb-1.5">
            <span className="font-medium">预估</span>
            <span className="text-lg font-bold">
              ¥{estimate.total_cost_cny.toFixed(2)}
            </span>
          </div>
          <div className="text-[11px] opacity-80">
            ¥{estimate.per_image_cny.toFixed(3)} × {totalCount} 张
          </div>
          <div className="mt-2 pt-2 border-t border-current/20 text-[11px]">
            {estimate.is_unlimited ? (
              <span>无限额度</span>
            ) : (
              <span>
                余额 ¥{estimate.remaining_cny.toFixed(2)}
                {estimate.affordable
                  ? " · 充足"
                  : ` · 仅能做 ${estimate.can_afford_count} 张`}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <button
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
          className="btn btn-primary btn-lg w-full"
        >
          {submitting ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              提交中…
            </>
          ) : (
            <>
              开始换色{" "}
              <span className="text-xs opacity-80">
                · {totalCount} 张（{filesLen} 图 × {colorsLen} 色）
              </span>
            </>
          )}
        </button>
        <div className="flex gap-2">
          <ResetButton
            label="清空"
            size="sm"
            variant="outline"
            onConfirm={onReset}
            confirmDetail="将清除已上传的图片、解析结果、选择的颜色和预设。当前正在进行的任务不受影响（可在右栏继续查看）。"
          />
          <div className="text-[10px] text-fg-muted flex-1 self-center">
            刷新浏览器会清空所有状态
          </div>
        </div>
      </div>

      <div className="text-[10px] text-fg-muted text-center pt-2">
        受 quota 限制，速度按当前 RPM 配置
      </div>
    </div>
  );
}

/* ─────────── 子组件 ─────────── */

/**
 * 没选材质时的智能提示
 *
 * 设计目标：让用户**在跑出失败任务之前**就意识到风险。
 * 实测过 "Lime Green velvet → Gold" 这种 case，没选材质导致模型 5 次重试
 * 后仍然拒绝出图。velvet / satin / lace / chiffon 这类高难度面料尤其需要
 * 明确告知模型，否则 Nano Banana 容易"做不准就不做"。
 *
 * 策略：
 *   1. 默认显示一个常规黄色提醒
 *   2. 文件名 / garment_attrs 中检测到 velvet / satin / 蕾丝 / 雪纺 等关键字
 *      → 升级成醒目红色提醒，告诉用户"几乎一定会失败"
 */
function MaterialMissingHint({
  files,
  hasGarmentAttrs,
}: {
  files: File[];
  hasGarmentAttrs: boolean;
}) {
  // 高风险面料关键字（模型对这些面料没材质指引时几乎必拒）
  const HIGH_RISK_FABRICS = [
    { kw: /velvet|天鹅绒|丝绒/i, name: "天鹅绒 / velvet" },
    { kw: /lace|蕾丝/i, name: "蕾丝 / lace" },
    { kw: /chiffon|雪纺/i, name: "雪纺 / chiffon" },
    { kw: /satin|缎面|缎子/i, name: "缎面 / satin" },
    { kw: /sequin|亮片/i, name: "亮片 / sequin" },
    { kw: /tulle|网纱/i, name: "网纱 / tulle" },
    { kw: /silk|真丝/i, name: "真丝 / silk" },
  ];

  // 从文件名识别面料关键字
  const detectedFabric = (() => {
    for (const f of files) {
      const name = f.name;
      for (const fab of HIGH_RISK_FABRICS) {
        if (fab.kw.test(name)) return fab.name;
      }
    }
    return null;
  })();

  if (detectedFabric) {
    return (
      <div
        className="mt-3 p-3 rounded-md border text-[12px] leading-relaxed"
        style={{
          background: "var(--danger-bg)",
          borderColor: "rgba(239, 68, 68, 0.4)",
          color: "var(--danger)",
        }}
      >
        <div className="font-semibold mb-1">
          ⚠️ 检测到这是「{detectedFabric}」面料
        </div>
        <div className="opacity-90">
          这类高难度面料如果不告诉 AI，**模型大概率会拒绝出图**（实测过 velvet
          连续重试 5 次都失败）。
          <br />
          强烈建议<strong> 上方点 "+ 添加材质" </strong>选对应面料，或先点 ② 解析款式自动识别。
        </div>
      </div>
    );
  }

  // 无 garment_attrs + 无 selected = 缺所有上下文
  if (!hasGarmentAttrs) {
    return (
      <div
        className="mt-3 p-3 rounded-md border text-[12px] leading-relaxed"
        style={{
          background: "var(--warn-bg)",
          borderColor: "rgba(245, 158, 11, 0.4)",
          color: "var(--warn)",
        }}
      >
        💡 建议<strong> 先点 ② 解析款式</strong>，或<strong>手动选材质</strong>。
        AI 知道是棉布 / 缎面 / 蕾丝 等才能正确渲染光泽和纹理；
        反差色 / 高难度面料没材质指引时模型可能拒绝出图。
        <span className="opacity-70 ml-1">（简单纯色款如棉布可跳过）</span>
      </div>
    );
  }

  // 已分析但还是没选材质（解析时没匹配到）
  return (
    <p className="mt-2 text-[11px] text-fg-tertiary">
      💡 解析没匹配到材质，可手动选。简单纯色款（如棉布）可跳过。
    </p>
  );
}

function GarmentAttrsEditor({
  attrs,
  onChange,
  onMaterialTextBlur,
}: {
  attrs: GarmentAttrs;
  onChange: (key: string, value: string) => void;
  onMaterialTextBlur: (value: string) => void;
}) {
  const entries = Object.entries(attrs).filter(([key]) => !key.startsWith("_"));
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {entries.map(([key, value]) => {
        const strValue = Array.isArray(value) ? value.join("、") : String(value);
        const isMaterial = key === "面料材质";
        return (
          <div
            key={key}
            className="p-2.5 bg-bg-tertiary border border-border-subtle rounded-md"
          >
            <div className="text-[11px] text-fg-tertiary mb-1">
              {key}
              {isMaterial && (
                <span className="ml-1 text-[10px] text-brand-400">
                  （失焦重匹配）
                </span>
              )}
            </div>
            <input
              type="text"
              value={strValue}
              onChange={(e) => onChange(key, e.target.value)}
              onBlur={
                isMaterial
                  ? (e) => onMaterialTextBlur(e.target.value)
                  : undefined
              }
              className="input text-[12px] h-8 px-2.5"
            />
          </div>
        );
      })}
    </div>
  );
}
