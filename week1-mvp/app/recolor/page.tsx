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
  {
    value: "2k",
    label: "2K 高清（推荐）",
    desc: "约 1792×2400 · 速度/成本/清晰度平衡最佳",
  },
  {
    value: "4k",
    label: "4K 超清",
    desc: "约 3584×4800 · 最大清晰度，成本 ~15x",
  },
  {
    value: "hd",
    label: "HD 清晰",
    desc: "约 896×1200 · 最快最省",
  },
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
  /** 临时颜色列表（点"添加"后入栈）。提交时会作为 custom_colors 发送 */
  const [customColors, setCustomColors] = useState<
    Array<{ name: string; hex: string }>
  >([]);
  const [customName, setCustomName] = useState("");
  const [customHex, setCustomHex] = useState("#722F37");

  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  const [model, setModel] = useState<string>("");

  // ─── 提交 / 任务 ───
  const [submitting, setSubmitting] = useState(false);
  /** 初始化：如果 slotStore 里有活跃 job_id，恢复；否则 null */
  const [activeJobId, setActiveJobId] = useState<string | null>(
    () => slotStore.get<string>("activeJobId") ?? null,
  );
  const [activeJobCount, setActiveJobCount] = useState(0);
  /**
   * 中栏显示模式：
   *   - 有 activeJobId 时初始 = "task"（让用户回来直接看到进度）
   *   - 没有时初始 = "form"（正常编辑）
   */
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

    // 恢复 slot 里存着的其他状态
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

    // 活跃任务数
    fetch("/api/jobs/active")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => setActiveJobCount(d.count || 0))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── 持久化状态到 slotStore ─── */
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

  /* ─── 估价（参数变化时 debounce 查询） ─── */
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
        (c) => c.name === name || c.hex.toLowerCase() === customHex.toLowerCase(),
      )
    ) {
      notifyHelpers.warn(push, "已有同名或同色号的临时色");
      return;
    }
    setCustomColors((prev) => [...prev, { name, hex: customHex }]);
    setCustomName(""); // 加完清空名字，色号保留方便下一个微调
  }

  function removeCustomColor(i: number) {
    setCustomColors((prev) => prev.filter((_, idx) => idx !== i));
  }

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

  /* ─── 轮询当前 job ─── */
  const handleJobFinished = useCallback(() => {
    // 成功完成 / 取消 / 失败时，跳一条通知，不自动清 activeJobId
    // 保留状态让用户看结果 + 手动点"收起"才清掉
    fetch("/api/jobs/active")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => setActiveJobCount(d.count || 0))
      .catch(() => {});
  }, []);

  const polling = useJobPolling(activeJobId, {
    intervalMs: 1500,
    onFinished: (result) => {
      handleJobFinished();
      // 注意：onFinished 由 useJobPolling 在 job 进入终态时调用一次
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

  // 轮询错误自恢复：如果轮询报"任务不存在"（被删了或后台清理了），
  // 清掉 activeJobId 并切回表单，避免用户卡在空视窗
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
  async function onPickFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      setFiles([]);
      setCompressedBlobs([]);
      setGarmentAttrs(null);
      setSelectedMaterialIds([]);
      return;
    }
    const picked = Array.from(fileList).slice(0, 5);
    setFiles(picked);
    setCompressedBlobs([]);
    setCroppedFlags(new Array(picked.length).fill(false));
    setGarmentAttrs(null);
    setSelectedMaterialIds([]);
    try {
      const blobs = await Promise.all(picked.map((f) => resizeImage(f, 2048)));
      setCompressedBlobs(blobs);
    } catch (e) {
      notifyHelpers.error(push, "图片读取失败", e instanceof Error ? e.message : String(e));
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
    setSelectedMaterialIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
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

  /* ─── 提交（走异步 API） ─── */
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
      setViewMode("task"); // 自动切到任务视窗，消除黑盒感
      notifyHelpers.info(
        push,
        `任务已提交`,
        `共 ${totalCount} 张 · Google quota 2/分钟，预计耗时 ${Math.ceil(totalCount / 2)}+ 分钟`,
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
    setActiveJobId(null);
    slotStore.reset();
    notifyHelpers.info(push, "已清空当前任务");
  }

  function dismissCurrentJob() {
    setActiveJobId(null);
    slotStore.setActiveJob(null);
  }

  if (!user) {
    return (
      <div className="p-8 text-gray-500 text-sm">正在加载…</div>
    );
  }

  /* ─────────── 渲染 ─────────── */

  // 动态中栏：有活跃任务且 viewMode='task' 时，中栏整个换成 TaskViewport
  const showTaskViewport = viewMode === "task" && polling.data;

  return (
    <AppShell
      leftNav={{
        user,
        activeJobCount,
      }}
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
          onSwitchView={() => setViewMode((m) => (m === "task" ? "form" : "task"))}
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
          zipPrefix="recolor"
          makeFilename={(it) => {
            const safe = (it.label || `item_${it.idx + 1}`).replace(
              /[/\\?%*:|"<>]/g,
              "_",
            );
            return `${safe}.png`;
          }}
        />
      ) : (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">HEX 精准换色</h1>
          <p className="mt-1 text-sm text-gray-500">
            上传 → 解析款式 + 识别材质 → 选颜色批量生成
          </p>
        </header>

        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-6">
          {/* Step 1: 上传 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              1. 上传产品图
              <span className="ml-2 text-xs text-gray-500 font-normal">
                最多 5 张同款不同角度
              </span>
            </label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onPickFiles(e.target.files)}
              className="block w-full text-sm text-gray-600
                file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0
                file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700
                hover:file:bg-blue-100"
            />
            {files.length > 0 && (
              <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
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
                      <span className="w-5 h-5 rounded bg-black/60 text-white text-[10px] flex items-center justify-center">
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
                          className="px-3 py-1 bg-white/90 text-gray-800 text-xs rounded hover:bg-white"
                        >
                          裁剪
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(i);
                          }}
                          className="px-3 py-1 bg-red-600/90 text-white text-xs rounded hover:bg-red-700"
                        >
                          删除
                        </button>
                      </div>
                    }
                  />
                ))}
              </div>
            )}
          </div>

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
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  2. 款式解析
                  <span className="ml-2 text-xs text-gray-500 font-normal">
                    （可选，解析结果可编辑）
                  </span>
                </label>
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={analyzing || compressedBlobs.length === 0}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {analyzing ? "解析中..." : garmentAttrs ? "重新解析" : "解析款式"}
                </button>
              </div>
              {garmentAttrs && (
                <GarmentAttrsEditor
                  attrs={garmentAttrs}
                  onChange={updateGarmentAttr}
                  onMaterialTextBlur={rematchMaterials}
                />
              )}
            </div>
          )}

          {/* Step 3: 材质 */}
          {(garmentAttrs || selectedMaterials.length > 0) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                3. 服装材质
                <span className="ml-2 text-xs text-gray-500 font-normal">
                  （自动匹配，可手动增删）
                </span>
              </label>
              <div className="flex flex-wrap gap-2 items-center">
                {selectedMaterials.map((m) => (
                  <span
                    key={m.id}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-sm text-blue-800"
                  >
                    <span>{m.name}</span>
                    {m.english_name && (
                      <span className="text-xs text-blue-500 font-mono">
                        {m.english_name}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeMaterial(m.id)}
                      className="ml-1 text-blue-400 hover:text-red-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowMaterialPicker((v) => !v)}
                    className="px-3 py-1.5 rounded-full border border-dashed border-gray-400 text-sm text-gray-600 hover:border-blue-500 hover:text-blue-600"
                  >
                    + 添加材质
                  </button>
                  {showMaterialPicker && (
                    <div className="absolute top-full mt-1 left-0 z-10 bg-white border border-gray-200 rounded-md shadow-lg p-2 max-h-64 overflow-y-auto w-64">
                      {unselectedMaterials.length === 0 ? (
                        <div className="text-xs text-gray-500 p-2">
                          所有材质都已添加
                        </div>
                      ) : (
                        unselectedMaterials.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => addMaterial(m.id)}
                            className="w-full text-left px-2 py-1.5 text-sm hover:bg-blue-50 rounded"
                          >
                            <div className="font-medium text-gray-900">
                              {m.name}
                              {m.english_name && (
                                <span className="ml-1 text-xs text-gray-500 font-mono">
                                  {m.english_name}
                                </span>
                              )}
                            </div>
                            {m.description && (
                              <div className="text-xs text-gray-500 mt-0.5 truncate">
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
              {selectedMaterials.length === 0 && (
                <p className="mt-2 text-xs text-amber-600">
                  ⚠ 未匹配到任何材质，AI 可能误判面料
                </p>
              )}
            </div>
          )}

          {/* Step 4: 真实感 */}
          {realisms.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                4. 真实感预设
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {realisms.map((r) => {
                  const active = realismId === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRealismId(r.id)}
                      className={`text-left p-3 rounded-md border transition ${
                        active
                          ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                          : "border-gray-300 hover:border-gray-400"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {r.name}
                        </span>
                        {r.is_default === 1 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                            默认
                          </span>
                        )}
                      </div>
                      {r.description && (
                        <div className="text-xs text-gray-500 mt-1">
                          {r.description}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 5: 颜色 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              5. 选择目标颜色（可多选）
            </label>
            {colors.length === 0 ? (
              <div className="text-xs text-gray-500 p-3 bg-gray-50 rounded border border-dashed border-gray-300">
                颜色库是空的，
                <a href="/admin/colors" className="text-blue-600 underline">
                  去添加
                </a>
                ，或使用下面的「临时颜色」
              </div>
            ) : (
              <div className="space-y-3">
                {(() => {
                  // 按色系分组（保持后端 sort_order 顺序），无分组的归到「未分类」
                  const GROUP_ORDER = [
                    "蓝色系",
                    "绿色系",
                    "中性色系",
                    "粉/红色系",
                    "紫色系",
                    "黄色系",
                    "深色系",
                  ];
                  const groups = new Map<string, Color[]>();
                  for (const c of colors) {
                    const key = c.color_group_label || "未分类";
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key)!.push(c);
                  }
                  // 已知色系按预设顺序，未知色系追加到末尾
                  const orderedKeys = [
                    ...GROUP_ORDER.filter((k) => groups.has(k)),
                    ...Array.from(groups.keys()).filter(
                      (k) => !GROUP_ORDER.includes(k),
                    ),
                  ];
                  return orderedKeys.map((groupLabel) => (
                    <div key={groupLabel}>
                      <div className="text-xs text-gray-500 mb-1.5 flex items-center gap-1.5">
                        <span>{groupLabel}</span>
                        <span className="text-gray-400">
                          · {groups.get(groupLabel)!.length}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                        {groups.get(groupLabel)!.map((c) => {
                          const active = selectedColorIds.has(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => toggleColor(c.id)}
                              className={`relative p-2 rounded-md border text-left transition ${
                                active
                                  ? "border-blue-500 ring-1 ring-blue-500 bg-blue-50"
                                  : "border-gray-300 hover:border-gray-400"
                              }`}
                            >
                              {c.is_popular ? (
                                <span className="absolute top-1 right-1 px-1 py-px rounded text-[9px] font-medium leading-none bg-amber-100 text-amber-700 border border-amber-200">
                                  流行
                                </span>
                              ) : null}
                              <div
                                className="w-full h-10 rounded border border-gray-200"
                                style={{ backgroundColor: c.hex }}
                              />
                              <div className="text-xs mt-1 truncate">
                                {c.name}
                              </div>
                              <div className="text-[10px] text-gray-400 font-mono truncate">
                                {c.hex}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
            {/* 临时颜色 */}
            <div className="mt-3 p-3 bg-gray-50 rounded-md border border-gray-200">
              <div className="text-xs text-gray-500 mb-2">
                临时颜色（可选） · 不保存到颜色库，但本次任务会参与生成
              </div>

              {/* 已添加的临时色 chip 列表 */}
              {customColors.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {customColors.map((c, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-white border border-blue-300 text-xs text-gray-700"
                    >
                      <span
                        className="w-4 h-4 rounded-full border border-gray-300"
                        style={{ backgroundColor: c.hex }}
                      />
                      <span>{c.name}</span>
                      <span className="text-[10px] text-gray-400 font-mono">
                        {c.hex}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeCustomColor(i)}
                        className="ml-0.5 text-gray-400 hover:text-red-600"
                        aria-label="移除"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* 输入行 */}
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="color"
                  value={customHex}
                  onChange={(e) => setCustomHex(e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer border-0"
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
                  className="flex-1 min-w-[140px] px-2 py-1.5 text-sm border border-gray-300 rounded"
                />
                <input
                  type="text"
                  value={customHex}
                  onChange={(e) => setCustomHex(e.target.value)}
                  className="w-24 px-2 py-1.5 text-sm font-mono border border-gray-300 rounded"
                />
                <button
                  type="button"
                  onClick={addCustomColor}
                  disabled={!customName.trim()}
                  className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  + 添加
                </button>
              </div>
            </div>
          </div>
        </section>
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
    <div className="p-3 space-y-3 text-sm">
      <NotificationStack />

      {/* 任务切换提示条 */}
      {hasActiveTask ? (
        <button
          type="button"
          onClick={onSwitchView}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-xs text-blue-900 transition-colors"
        >
          <span className="flex items-center gap-2">
            {poll && (poll.job.status === "running" || poll.job.status === "canceling") ? (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            ) : null}
            {viewMode === "task" ? "切到「表单」编辑" : "切到「任务视窗」看进度"}
          </span>
          <span className="text-[11px] font-mono text-blue-600">
            {poll ? `${poll.job.completed_count}/${poll.job.total_count}` : ""}
          </span>
        </button>
      ) : null}

      {pollError ? (
        <div className="p-2 rounded border border-red-200 bg-red-50 text-xs text-red-700">
          轮询失败：{pollError}
        </div>
      ) : null}

      {/* 生成参数 */}
      <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3">
        <div className="text-xs font-medium text-gray-500">生成参数</div>

        {/* 模型 */}
        <div>
          <div className="text-xs text-gray-500 mb-1">模型</div>
          {aiModels.length === 0 ? (
            <div className="text-xs text-gray-500">暂无模型</div>
          ) : (
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded bg-white"
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

        {/* 输出比例 */}
        <div>
          <div className="text-xs text-gray-500 mb-1">输出比例</div>
          <select
            value={aspectRatio}
            onChange={(e) => onAspectChange(e.target.value)}
            className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded bg-white"
          >
            {ASPECT_RATIOS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        {/* 质量 */}
        <div>
          <div className="text-xs text-gray-500 mb-1">清晰度</div>
          <select
            value={qualityLevel}
            onChange={(e) => onQualityChange(e.target.value as QualityLevel)}
            className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded bg-white"
          >
            {QUALITY_LEVELS.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {QUALITY_LEVELS.find((q) => q.value === qualityLevel)?.desc}
          </div>
        </div>

        {/* Seed */}
        <div>
          <div className="text-xs text-gray-500 mb-1">
            追加指令{" "}
            <span className="text-gray-400 font-normal">（可选）</span>
          </div>
          <textarea
            value={userSeed}
            onChange={(e) => onUserSeedChange(e.target.value)}
            rows={2}
            placeholder="例：保留蕾丝立体感，背景留白"
            className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded resize-none"
          />
        </div>
      </div>

      {/* 预估 + 余额 */}
      {estimate && (
        <div
          className={`rounded-md border p-3 text-xs ${
            estimate.is_unlimited || estimate.affordable
              ? "border-blue-200 bg-blue-50 text-blue-900"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
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
                {estimate.affordable ? " · 充足" : ` · 仅能做 ${estimate.can_afford_count} 张`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 提交按钮 */}
      <div className="space-y-2">
        <button
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
          className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {submitting ? (
            <>
              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
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
          <div className="text-[10px] text-gray-400 flex-1 self-center">
            刷新浏览器会清空所有状态（除 GC 中的任务）
          </div>
        </div>
      </div>

      <div className="text-[10px] text-gray-400 text-center pt-2">
        受 Google quota 限制，每分钟最多 2 张
      </div>
    </div>
  );
}

/* ─────────── 子组件 ─────────── */

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
          <div key={key} className="p-2 bg-gray-50 border border-gray-200 rounded">
            <div className="text-xs text-gray-500 mb-1">
              {key}
              {isMaterial && (
                <span className="ml-1 text-[10px] text-blue-500">
                  （失焦重匹配）
                </span>
              )}
            </div>
            <input
              type="text"
              value={strValue}
              onChange={(e) => onChange(key, e.target.value)}
              onBlur={
                isMaterial ? (e) => onMaterialTextBlur(e.target.value) : undefined
              }
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded bg-white focus:border-blue-500 focus:outline-none"
            />
          </div>
        );
      })}
    </div>
  );
}
