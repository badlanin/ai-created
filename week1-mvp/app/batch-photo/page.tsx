"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, Sparkles, Upload, ImageIcon, Crop as CropIcon, X } from "lucide-react";
import { ImageCropper } from "@/app/_components/image-cropper";
import { AppShell } from "@/app/_components/app-shell";
import { NotificationStack, useNotifications, notifyHelpers } from "@/app/_components/notification-stack";
import { TaskViewport } from "@/app/_components/task-viewport";
import { TaskDock } from "@/app/_components/task-dock";
import { Thumbnail, ThumbnailBadge } from "@/app/_components/thumbnail";
import { ResetButton } from "@/app/_components/reset-button";
import {
  CollapsibleSection,
  Dropzone,
} from "@/app/_components/ui";
import {
  TaskTabBar,
  inferTabStatus,
} from "@/app/_components/task-tab-bar";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useJobPolling } from "@/lib/hooks/use-job-polling";
import {
  useSlotStore,
  useTabs,
  useEnsureFirstTab,
  useTaskStore,
  type TabsApi,
} from "@/lib/stores/task-store";

/* ─────────── 类型 ─────────── */
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
};
type Realism = {
  id: number;
  name: string;
  description: string | null;
  is_default: 0 | 1;
};
type Photography = {
  id: number;
  name: string;
  description: string | null;
  is_default: 0 | 1;
};
type PromptTemplate = {
  id: number;
  name: string;
  kind: string;
  notes: string | null;
};
type Identity = {
  id: number;
  name: string;
  image_url: string;
  tags: string | null;
  category: string | null;
  category_label: string | null;
};
type Scene = {
  id: number;
  name: string;
  image_url: string;
  tags: string | null;
  category: string | null;
  category_label: string | null;
};
type PoseType = "full" | "half" | "closeup";
type Pose = {
  id: number;
  name: string;
  text: string;
  type: PoseType;
  tags: string | null;
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

const POSE_TYPE_LABEL: Record<PoseType, string> = {
  full: "全身",
  half: "半身",
  closeup: "特写",
};

const ASPECT_RATIOS = [
  { value: "3:4", label: "3:4 竖（推荐）" },
  { value: "2:3", label: "2:3 竖" },
  { value: "4:5", label: "4:5 竖" },
  { value: "1:1", label: "1:1 方" },
] as const;

type QualityLevel = "hd" | "2k" | "4k";
const QUALITY_LEVELS: Array<{
  value: QualityLevel;
  label: string;
  desc: string;
}> = [
  { value: "2k", label: "2K 高清（推荐）", desc: "~1792×2400 · 性价比最佳" },
  { value: "4k", label: "4K 超清", desc: "~3584×4800 · 贵 15x" },
  { value: "hd", label: "HD 清晰", desc: "~896×1200 · 最省" },
];

/* ─────────── 3 槽位配置 ─────────── */

const PRODUCT_SLOTS = [
  { key: "front", label: "正面", hint: "必需" },
  { key: "back", label: "背面", hint: "建议" },
  { key: "detail", label: "细节", hint: "可选" },
] as const;

interface SlotFile {
  file: File;
  blob: Blob;
  cropped: boolean;
}

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

/* ─────────── 页面主体 ─────────── */

/**
 * 单个任务 tab 的内容（form / 任务视窗 / 右栏）
 *
 * 每个 tab 是独立的 React 树（在父级 BatchPhotoPage 用 key={tabId} 触发 remount），
 * 拥有自己的 useState、useEffect、polling、slotStore。
 *
 * Slot key 命名约定：`batchPhoto:${tabId}`
 *   - tab 数据（产品图、模特、场景、姿势、prompt 等）独立持久化
 *   - 切换 tab 后再切回来，从 slotStore 恢复表单
 *   - 关闭 tab 调用 store.reset(`batchPhoto:${tabId}`) 清掉
 */
function BatchPhotoTab({
  tabId,
  tabs,
}: {
  tabId: string;
  tabs: TabsApi;
}) {
  const user = useCurrentUser();
  const slotStore = useSlotStore(`batchPhoto:${tabId}`);
  const { push } = useNotifications();

  // ─── 素材库 ───
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [photoParams, setPhotoParams] = useState<Photography[]>([]);
  const [realisms, setRealisms] = useState<Realism[]>([]);
  const [poses, setPoses] = useState<Pose[]>([]);
  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  const [allMaterials, setAllMaterials] = useState<Material[]>([]);

  // ─── 产品图（3 固定槽位）───
  const [slots, setSlots] = useState<(SlotFile | null)[]>([null, null, null]);
  const [croppingSlot, setCroppingSlot] = useState<number | null>(null);

  // ─── 解析 ───
  const [analyzing, setAnalyzing] = useState(false);
  const [garmentAttrs, setGarmentAttrs] = useState<GarmentAttrs | null>(null);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<number[]>([]);
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);

  // ─── 选择 ───
  const [identityId, setIdentityId] = useState<number | null>(null);
  const [sceneId, setSceneId] = useState<number | null>(null);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [photographyId, setPhotographyId] = useState<number | null>(null);
  const [realismId, setRealismId] = useState<number | null>(null);
  const [selectedPoseIds, setSelectedPoseIds] = useState<Set<number>>(
    new Set(),
  );
  const [modelId, setModelId] = useState<string>("");
  const [aspectRatio, setAspectRatio] = useState<string>("3:4");
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>("2k");
  const [userSeed, setUserSeed] = useState("");

  // ─── 估价 + 提交 ───
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(
    () => slotStore.get<string>("activeJobId") ?? null,
  );
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [viewMode, setViewMode] = useState<"form" | "task">(
    () => (slotStore.get<string>("activeJobId") ? "task" : "form"),
  );

  /* ─── 初始加载 + slot 恢复 ─── */
  useEffect(() => {
    const load = async (url: string) =>
      fetch(url).then((r) => (r.ok ? r.json() : []));

    Promise.all([
      load("/api/identities"),
      load("/api/scenes"),
      load("/api/prompts?kind=on_model"),
      load("/api/photography"),
      load("/api/realism"),
      load("/api/poses"),
      load("/api/ai-models?category=image_gen"),
      load("/api/materials"),
    ])
      .then(
        ([ids, scs, tpls, photo, real, pos, models, mats]: [
          Identity[],
          Scene[],
          PromptTemplate[],
          Photography[],
          Realism[],
          Pose[],
          AiModel[],
          Material[],
        ]) => {
          setIdentities(ids);
          setScenes(scs);
          setTemplates(tpls);
          setPhotoParams(photo);
          setRealisms(real);
          setPoses(pos);
          setAiModels(models);
          setAllMaterials(mats);

          const savedTpl = slotStore.get<number>("templateId");
          if (savedTpl && tpls.find((t) => t.id === savedTpl)) {
            setTemplateId(savedTpl);
          } else if (tpls[0]) {
            setTemplateId(tpls[0].id);
          }
          const savedPhoto = slotStore.get<number>("photographyId");
          const defPhoto =
            photo.find((p) => p.is_default === 1)?.id || photo[0]?.id;
          setPhotographyId(savedPhoto ?? defPhoto ?? null);
          const savedReal = slotStore.get<number>("realismId");
          const defReal =
            real.find((r) => r.is_default === 1)?.id || real[0]?.id;
          setRealismId(savedReal ?? defReal ?? null);
          const savedModel = slotStore.get<string>("modelId");
          const defModel =
            models.find((m) => m.is_default === 1)?.model_id ||
            models[0]?.model_id;
          setModelId(savedModel ?? defModel ?? "");
        },
      )
      .catch(() => {});

    const savedIdentity = slotStore.get<number>("identityId");
    if (savedIdentity) setIdentityId(savedIdentity);
    const savedScene = slotStore.get<number>("sceneId");
    if (savedScene) setSceneId(savedScene);
    const savedPoses = slotStore.get<number[]>("selectedPoseIds");
    if (savedPoses) setSelectedPoseIds(new Set(savedPoses));
    const savedAspect = slotStore.get<string>("aspectRatio");
    if (savedAspect) setAspectRatio(savedAspect);
    const savedQuality = slotStore.get<QualityLevel>("qualityLevel");
    if (savedQuality) setQualityLevel(savedQuality);
    const savedSeed = slotStore.get<string>("userSeed");
    if (savedSeed) setUserSeed(savedSeed);
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
      identityId,
      sceneId,
      templateId,
      photographyId,
      realismId,
      modelId,
      aspectRatio,
      qualityLevel,
      userSeed,
      garmentAttrs,
      selectedMaterialIds,
      selectedPoseIds: Array.from(selectedPoseIds),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    identityId,
    sceneId,
    templateId,
    photographyId,
    realismId,
    modelId,
    aspectRatio,
    qualityLevel,
    userSeed,
    garmentAttrs,
    selectedMaterialIds,
    selectedPoseIds,
  ]);

  /* ─── 估价 ─── */
  useEffect(() => {
    const count = selectedPoseIds.size;
    if (count === 0 || !modelId) {
      setEstimate(null);
      return;
    }
    const t = setTimeout(() => {
      fetch("/api/billing/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          quality_level: qualityLevel,
          image_count: count,
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
  }, [selectedPoseIds.size, modelId, qualityLevel]);

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
          `批量摄影图完成 · ${job.completed_count}/${job.total_count}`,
          job.failed_count > 0
            ? `${job.failed_count} 张失败，其余已完成。`
            : undefined,
        );
      } else if (job.status === "canceled") {
        notifyHelpers.info(
          push,
          `任务已停止`,
          `已完成 ${job.completed_count} / 共 ${job.total_count}`,
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

  /* ─── 槽位操作 ─── */

  async function setSlotFromFile(slotIdx: number, file: File) {
    try {
      const blob = await resizeImage(file, 2048);
      setSlots((prev) => {
        const next = [...prev];
        next[slotIdx] = { file, blob, cropped: false };
        return next;
      });
    } catch (e) {
      notifyHelpers.error(push, "图片读取失败", e instanceof Error ? e.message : String(e));
    }
  }

  function onSlotPick(slotIdx: number, files: File[]) {
    if (!files || files.length === 0) return;
    if (files.length === 1) {
      void setSlotFromFile(slotIdx, files[0]);
      return;
    }
    // 一次拖入多张：依次填充后续空槽位
    let pointer = slotIdx;
    for (const f of files) {
      if (pointer >= slots.length) break;
      void setSlotFromFile(pointer, f);
      pointer += 1;
    }
  }

  function onSlotRemove(slotIdx: number) {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = null;
      return next;
    });
    if (slotIdx === 0) {
      setGarmentAttrs(null);
      setSelectedMaterialIds([]);
    }
  }

  function onCropConfirm(slotIdx: number, blob: Blob) {
    setSlots((prev) => {
      const next = [...prev];
      const cur = next[slotIdx];
      if (cur) {
        next[slotIdx] = { ...cur, blob, cropped: true };
      }
      return next;
    });
    setCroppingSlot(null);
  }

  /* ─── 解析 ─── */
  async function handleAnalyze() {
    const slot = slots[0];
    if (!slot) {
      notifyHelpers.warn(push, "请先上传正面图");
      return;
    }
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("image0", slot.blob, slot.file.name);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
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

  /* ─── 派生 ─── */
  const filledSlots = slots.filter((s): s is SlotFile => s !== null);
  const hasProductImages = filledSlots.length > 0;

  const selectedMaterials = selectedMaterialIds
    .map((id) => allMaterials.find((m) => m.id === id))
    .filter(Boolean) as Material[];
  const unselectedMaterials = allMaterials.filter(
    (m) => !selectedMaterialIds.includes(m.id),
  );

  const posesByType = useMemo(() => {
    const map: Record<PoseType, Pose[]> = { full: [], half: [], closeup: [] };
    for (const p of poses) map[p.type].push(p);
    return map;
  }, [poses]);

  // 模特按 category 分组（保持稳定排序）
  const identityGroups = useMemo(() => {
    const CATEGORY_ORDER = ["通用", "大码", "孕妇", "青少年"];
    const groups = new Map<string, Identity[]>();
    for (const m of identities) {
      const key = m.category_label || "未分类";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    const orderedKeys = [
      ...CATEGORY_ORDER.filter((k) => groups.has(k)),
      ...Array.from(groups.keys()).filter((k) => !CATEGORY_ORDER.includes(k)),
    ];
    return orderedKeys.map((key) => ({ key, items: groups.get(key)! }));
  }, [identities]);

  // 场景按 category 分组（与 admin/scenes 顺序一致）
  const sceneGroups = useMemo(() => {
    const SCENE_ORDER = ["婚礼", "户外", "影棚", "街拍", "室内", "花园"];
    const groups = new Map<string, Scene[]>();
    for (const s of scenes) {
      const key = s.category_label || "未分类";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    const orderedKeys = [
      ...SCENE_ORDER.filter((k) => groups.has(k)),
      ...Array.from(groups.keys()).filter((k) => !SCENE_ORDER.includes(k)),
    ];
    return orderedKeys.map((key) => ({ key, items: groups.get(key)! }));
  }, [scenes]);

  function togglePose(id: number) {
    setSelectedPoseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canSubmit =
    !submitting &&
    !analyzing &&
    hasProductImages &&
    identityId !== null &&
    sceneId !== null &&
    templateId !== null &&
    selectedPoseIds.size > 0 &&
    Boolean(modelId);

  /* ─── 提交 ─── */
  async function handleSubmit() {
    if (!canSubmit) {
      notifyHelpers.warn(push, "请完成所有必填项（至少正面图 + 模特/场景/Prompt/姿势）");
      return;
    }
    if (estimate && !estimate.affordable && !estimate.is_unlimited) {
      const ok = confirm(
        `预估花费 ¥${estimate.total_cost_cny.toFixed(2)}，` +
          `超过余额 ¥${estimate.remaining_cny.toFixed(2)}。\n\n` +
          `建议把姿势减到 ${estimate.can_afford_count} 个以内。\n\n` +
          `仍要提交吗？（服务端可能会拒绝或只完成一部分）`,
      );
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      let productIdx = 0;
      slots.forEach((s) => {
        if (s) {
          fd.append(`product_image${productIdx}`, s.blob, s.file.name);
          productIdx += 1;
        }
      });
      fd.append("identity_id", String(identityId));
      fd.append("scene_id", String(sceneId));
      fd.append("template_id", String(templateId));
      if (photographyId) fd.append("photography_id", String(photographyId));
      if (realismId) fd.append("realism_id", String(realismId));
      fd.append("pose_ids", JSON.stringify(Array.from(selectedPoseIds)));
      if (selectedMaterialIds.length > 0) {
        fd.append("material_ids", JSON.stringify(selectedMaterialIds));
      }
      if (garmentAttrs) {
        fd.append("garment_attrs", JSON.stringify(garmentAttrs));
      }
      fd.append("model", modelId);
      fd.append("aspect_ratio", aspectRatio);
      fd.append("quality_level", qualityLevel);
      if (userSeed.trim()) fd.append("user_seed", userSeed.trim());

      const res = await fetch("/api/jobs/batch-photo", {
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
      const poseCount = selectedPoseIds.size;
      notifyHelpers.info(
        push,
        `任务已提交`,
        `共 ${poseCount} 张 · 受 Google quota 限制，预计 ${Math.ceil(poseCount / 2)}+ 分钟`,
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
    setSlots([null, null, null]);
    setGarmentAttrs(null);
    setSelectedMaterialIds([]);
    setSelectedPoseIds(new Set());
    setUserSeed("");
    setActiveJobId(null);
    slotStore.reset();
    notifyHelpers.info(push, "已清空当前任务");
  }

  function dismissCurrentJob() {
    setActiveJobId(null);
    slotStore.setActiveJob(null);
  }

  // tab 状态（给 TabBar 显示 spinner / ✓ / ! 用）
  // ⚠️ 必须在所有早期 return 之前，避免 hook 顺序变化触发
  // "Rendered more hooks than during the previous render" 错误
  const tabStatus = inferTabStatus({
    activeJobId,
    jobStatus: polling.data?.job.status ?? null,
  });
  useEffect(() => {
    slotStore.set("_tabStatus", tabStatus);
  }, [tabStatus, slotStore]);

  if (!user)
    return <div className="p-8 text-fg-tertiary text-sm">正在加载…</div>;

  /* ─────────── 渲染 ─────────── */

  const showTaskViewport = viewMode === "task" && polling.data;

  return (
    <AppShell
      leftNav={{ user, activeJobCount }}
      rightPanel={
        <RightPanel
          aiModels={aiModels}
          modelId={modelId}
          onModelChange={setModelId}
          aspectRatio={aspectRatio}
          onAspectChange={setAspectRatio}
          qualityLevel={qualityLevel}
          onQualityChange={setQualityLevel}
          userSeed={userSeed}
          onUserSeedChange={setUserSeed}
          totalCount={selectedPoseIds.size}
          estimate={estimate}
          submitting={submitting}
          canSubmit={canSubmit}
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
      <BatchPhotoTabBarWrapper tabs={tabs} />
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
          zipPrefix="batch_photo"
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
              <Camera size={18} strokeWidth={2.2} />
            </span>
            <div>
              <h1 className="text-[22px] font-bold text-fg-primary tracking-tight">
                批量摄影
              </h1>
              <p className="mt-0.5 text-[13px] text-fg-tertiary">
                产品图 → 解析款式 → 选模特/场景/姿势 → 批量生成模特穿着图
              </p>
            </div>
          </header>

          {/* 任务看板 —— 持久化展示我的最近任务 */}
          <TaskDock feature="batch_photo" />

          <div className="space-y-4">
            {/* Step 1: 产品图上传 */}
            <CollapsibleSection
              title="① 上传产品图"
              description="拖拽 / 点击 / Ctrl+V 粘贴；一张图也能开始"
              defaultOpen
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PRODUCT_SLOTS.map((cfg, i) => (
                  <ProductSlot
                    key={cfg.key}
                    label={cfg.label}
                    hint={cfg.hint}
                    slot={slots[i]}
                    slotIndex={i}
                    onPick={onSlotPick}
                    onRemove={() => onSlotRemove(i)}
                    onStartCrop={() => setCroppingSlot(i)}
                  />
                ))}
              </div>
              {hasProductImages && (
                <p className="mt-3 text-[11px] text-fg-tertiary">
                  支持 Ctrl+V 粘贴：鼠标移到任意槽位上即可粘贴。一次拖多张会自动分配到后续空槽位。
                </p>
              )}
            </CollapsibleSection>

            {/* 裁剪模态 */}
            {croppingSlot !== null && slots[croppingSlot] && (
              <ImageCropper
                imageSrc={URL.createObjectURL(slots[croppingSlot]!.blob)}
                initialAspect={0}
                onConfirm={(blob) => onCropConfirm(croppingSlot, blob)}
                onCancel={() => setCroppingSlot(null)}
              />
            )}

            {/* Step 2: 款式解析 */}
            {hasProductImages && (
              <CollapsibleSection
                title="② 款式解析 + 服装材质"
                description="可选 · AI 自动识别款式属性，提升出图准确度"
                defaultOpen={!!garmentAttrs}
              >
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={handleAnalyze}
                    disabled={analyzing || !slots[0]}
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
                {garmentAttrs && (
                  <div className="mt-3 flex flex-wrap gap-2 items-center">
                    <span className="text-xs text-fg-tertiary">匹配材质：</span>
                    {selectedMaterials.map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1 chip chip-brand"
                      >
                        {m.name}
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedMaterialIds((p) =>
                              p.filter((x) => x !== m.id),
                            )
                          }
                          className="ml-1 opacity-60 hover:opacity-100 hover:text-danger"
                        >
                          <X size={10} strokeWidth={2.5} />
                        </button>
                      </span>
                    ))}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowMaterialPicker((v) => !v)}
                        className="px-2.5 py-0.5 h-[22px] rounded-full border border-dashed border-border-default text-[11px] text-fg-tertiary hover:border-brand-500 hover:text-brand-400 inline-flex items-center"
                      >
                        + 添加
                      </button>
                      {showMaterialPicker && (
                        <div
                          className="absolute top-full mt-1 left-0 z-20 bg-bg-elevated border border-border-default rounded-md shadow-lg p-2 max-h-64 overflow-y-auto w-64 animate-fade-in"
                        >
                          {unselectedMaterials.length === 0 ? (
                            <div className="text-xs text-fg-tertiary p-2">
                              全部已添加
                            </div>
                          ) : (
                            unselectedMaterials.map((m) => (
                              <button
                                key={m.id}
                                onClick={() => {
                                  setSelectedMaterialIds((p) => [...p, m.id]);
                                  setShowMaterialPicker(false);
                                }}
                                className="w-full text-left px-2 py-1.5 text-sm hover:bg-bg-hover rounded text-fg-primary"
                              >
                                {m.name}
                                {m.english_name && (
                                  <span className="ml-1 text-xs text-fg-tertiary font-mono">
                                    {m.english_name}
                                  </span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CollapsibleSection>
            )}

            {/* Step 3: 模特（按分类折叠）*/}
            <CollapsibleSection
              title="③ 选择模特形象"
              description={
                identityId
                  ? `已选择`
                  : `${identities.length} 个模特，按体型分类`
              }
              badge={identityId ? "✓" : undefined}
              defaultOpen={!identityId}
            >
              {identities.length === 0 ? (
                <EmptyHint
                  href="/admin/models"
                  label="去添加模特形象（需 PNG 透明底）"
                />
              ) : (
                <div className="space-y-2">
                  {identityGroups.map((g, idx) => (
                    <CollapsibleSection
                      key={g.key}
                      variant="minimal"
                      title={g.key}
                      badge={g.items.length}
                      defaultOpen={
                        // 默认展开第一组 + 当前选中所属组
                        idx === 0 ||
                        (identityId !== null &&
                          g.items.some((m) => m.id === identityId))
                      }
                    >
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5 mt-2">
                        {g.items.map((m) => (
                          <Thumbnail
                            key={m.id}
                            src={m.image_url}
                            alt={m.name}
                            ratio="3/4"
                            fit="contain"
                            selected={identityId === m.id}
                            onClick={() => setIdentityId(m.id)}
                            badge={
                              identityId === m.id ? (
                                <ThumbnailBadge tone="blue">已选</ThumbnailBadge>
                              ) : undefined
                            }
                          />
                        ))}
                      </div>
                    </CollapsibleSection>
                  ))}
                </div>
              )}
            </CollapsibleSection>

            {/* Step 4: 场景（按分类折叠） */}
            <CollapsibleSection
              title="④ 选择场景"
              description={
                sceneId
                  ? `已选择`
                  : `${scenes.length} 个场景背景，按分类折叠`
              }
              badge={sceneId ? "✓" : undefined}
              defaultOpen={!sceneId}
            >
              {scenes.length === 0 ? (
                <EmptyHint href="/admin/scenes" label="去添加场景" />
              ) : (
                <div className="space-y-2">
                  {sceneGroups.map((g, idx) => (
                    <CollapsibleSection
                      key={g.key}
                      variant="minimal"
                      title={g.key}
                      badge={g.items.length}
                      defaultOpen={
                        idx === 0 ||
                        (sceneId !== null &&
                          g.items.some((s) => s.id === sceneId))
                      }
                    >
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5 mt-2">
                        {g.items.map((s) => (
                          <Thumbnail
                            key={s.id}
                            src={s.image_url}
                            alt={s.name}
                            ratio="3/4"
                            fit="contain"
                            selected={sceneId === s.id}
                            onClick={() => setSceneId(s.id)}
                            badge={
                              sceneId === s.id ? (
                                <ThumbnailBadge tone="blue">已选</ThumbnailBadge>
                              ) : undefined
                            }
                          />
                        ))}
                      </div>
                    </CollapsibleSection>
                  ))}
                </div>
              )}
            </CollapsibleSection>

            {/* Step 5: 姿势（按类型折叠） */}
            <CollapsibleSection
              title="⑤ 选择姿势"
              description={
                selectedPoseIds.size > 0
                  ? `已选 ${selectedPoseIds.size}，将生成 ${selectedPoseIds.size} 张图`
                  : `按拍摄类型分组，可多选`
              }
              badge={
                selectedPoseIds.size > 0 ? selectedPoseIds.size : undefined
              }
              defaultOpen={selectedPoseIds.size === 0}
            >
              {poses.length === 0 ? (
                <EmptyHint href="/admin/poses" label="去添加姿势" />
              ) : (
                <div className="space-y-2">
                  {(["full", "half", "closeup"] as PoseType[]).map((type) => {
                    const list = posesByType[type];
                    if (list.length === 0) return null;
                    const selectedInGroup = list.filter((p) =>
                      selectedPoseIds.has(p.id),
                    ).length;
                    return (
                      <CollapsibleSection
                        key={type}
                        variant="minimal"
                        title={POSE_TYPE_LABEL[type]}
                        badge={
                          selectedInGroup > 0
                            ? `${selectedInGroup}/${list.length}`
                            : list.length
                        }
                        defaultOpen
                      >
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {list.map((p) => {
                            const active = selectedPoseIds.has(p.id);
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => togglePose(p.id)}
                                title={p.text}
                                className={`px-3 py-1.5 rounded-md border text-[12px] transition-colors ${
                                  active
                                    ? "border-transparent text-brand-400 font-medium"
                                    : "border-border-default text-fg-secondary hover:border-border-strong hover:text-fg-primary"
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
                                {p.name}
                              </button>
                            );
                          })}
                        </div>
                      </CollapsibleSection>
                    );
                  })}
                </div>
              )}
            </CollapsibleSection>

            {/* Step 6: 风格组合（默认折叠） */}
            <CollapsibleSection
              title="⑥ 风格组合"
              description="Prompt 模板 / 摄影参数 / 真实感预设（已自动选默认值）"
              defaultOpen={false}
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ChoiceGroup
                  label="Prompt 模板"
                  items={templates.map((t) => ({
                    id: t.id,
                    label: t.name,
                    desc: t.notes || null,
                  }))}
                  selectedId={templateId}
                  onChange={setTemplateId}
                  emptyHint={{
                    href: "/admin/prompts",
                    label: "Prompt 模板为空",
                  }}
                />
                <ChoiceGroup
                  label="摄影参数"
                  items={photoParams.map((p) => ({
                    id: p.id,
                    label: p.name,
                    desc: p.description,
                    isDefault: p.is_default === 1,
                  }))}
                  selectedId={photographyId}
                  onChange={setPhotographyId}
                  emptyHint={{
                    href: "/admin/photography",
                    label: "摄影参数为空",
                  }}
                />
                <ChoiceGroup
                  label="真实感"
                  items={realisms.map((r) => ({
                    id: r.id,
                    label: r.name,
                    desc: r.description,
                    isDefault: r.is_default === 1,
                  }))}
                  selectedId={realismId}
                  onChange={setRealismId}
                  emptyHint={{ href: "/admin/realism", label: "真实感为空" }}
                />
              </div>
            </CollapsibleSection>
          </div>
        </div>
      )}
    </AppShell>
  );
}

/* ─────────── 多任务 Page（Tab Bar 容器 + 当前 tab 渲染）─────────── */

/**
 * 默认导出：管理多 tab 的状态，挂载当前激活 tab。
 *
 * 渲染策略：
 *   - 同时只渲染 1 个 tab（active 的那个）
 *   - 切换 tab 时通过 key={tabId} 触发 React 完整 remount，旧 tab 状态被卸载
 *   - tab 数据持久化在 slotStore 里，新 tab mount 时自动恢复
 *
 * 这意味着：
 *   - 切换离开的 tab 上的"实时进度轮询"会暂停
 *   - 切回来时轮询自动恢复（useJobPolling 看 activeJobId 不为空就重启）
 *   - 整个 Tab 的设计目标是"开多个工作区，按需切换"，不是"5 个 tab 同时盯进度"
 */
export default function BatchPhotoPage() {
  const activeTabId = useEnsureFirstTab("batchPhoto");
  const tabs = useTabs("batchPhoto");

  if (!activeTabId) {
    // 第一次渲染时 useEnsureFirstTab 还没 effect，给个 loading
    return (
      <div className="p-8 text-fg-tertiary text-sm">正在加载…</div>
    );
  }

  return <BatchPhotoTab key={activeTabId} tabId={activeTabId} tabs={tabs} />;
}

/**
 * BatchPhotoTab 内嵌的 TabBar wrapper：从 task store 读各 tab 的状态徽标
 *
 * 单独抽出来是因为：每个 tab 把自己当前状态写进 `_tabStatus` 字段，
 * TabBar 这里反过来读所有 tab 的 `_tabStatus`，组合成完整的 tab 栏视图。
 */
function BatchPhotoTabBarWrapper({ tabs }: { tabs: TabsApi }) {
  const store = useTaskStore();
  return (
    <div className="px-5 md:px-8 lg:px-10 pt-3">
      <TaskTabBar
        feature="batchPhoto"
        tabs={tabs}
        statusOf={(tabId) => {
          const slot = store.snapshot(`batchPhoto:${tabId}`);
          const ts = slot.data._tabStatus as
            | "running"
            | "completed"
            | "failed"
            | "idle"
            | undefined;
          return ts ?? (slot.activeJobId ? "running" : "idle");
        }}
      />
    </div>
  );
}

/* ─────────── 单产品图槽位（Dropzone + Ctrl+V） ─────────── */

function ProductSlot({
  label,
  hint,
  slot,
  slotIndex,
  onPick,
  onRemove,
  onStartCrop,
}: {
  label: string;
  hint: string;
  slot: SlotFile | null;
  slotIndex: number;
  onPick: (slotIdx: number, files: File[]) => void;
  onRemove: () => void;
  onStartCrop: () => void;
}) {
  if (!slot) {
    return (
      <Dropzone
        compact
        accept="image/*"
        multiple={slotIndex === 0}
        onFiles={(files) => onPick(slotIndex, files)}
        className="aspect-[3/4] flex items-center justify-center"
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-3 pointer-events-none">
          <Upload size={24} strokeWidth={1.6} className="text-fg-tertiary mb-2" />
          <div className="text-[13px] font-medium text-fg-primary">{label}</div>
          <div className="mt-0.5 text-[10px] text-fg-tertiary">{hint}</div>
          <div className="mt-2 text-[10px] text-fg-muted">
            拖拽 / 点击 / Ctrl+V
          </div>
        </div>
      </Dropzone>
    );
  }

  return (
    <SlotFilled
      label={label}
      slot={slot}
      slotIndex={slotIndex}
      onPick={onPick}
      onRemove={onRemove}
      onStartCrop={onStartCrop}
    />
  );
}

/**
 * 已上传槽位 —— 仍然支持 hover 后 Ctrl+V 替换图片
 */
function SlotFilled({
  label,
  slot,
  slotIndex,
  onPick,
  onRemove,
  onStartCrop,
}: {
  label: string;
  slot: SlotFile;
  slotIndex: number;
  onPick: (slotIdx: number, files: File[]) => void;
  onRemove: () => void;
  onStartCrop: () => void;
}) {
  const inputId = `slot-replace-${slotIndex}`;
  const [hover, setHover] = useState(false);

  // hover 时也允许 Ctrl+V 替换
  useEffect(() => {
    if (!hover) return;
    function onPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items || []);
      const fileItems = items
        .filter((it) => it.kind === "file")
        .map((it) => it.getAsFile())
        .filter((f): f is File => f !== null && f.type.startsWith("image/"));
      if (fileItems.length === 0) return;
      e.preventDefault();
      onPick(slotIndex, fileItems.slice(0, 1));
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [hover, onPick, slotIndex]);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative aspect-[3/4] rounded-md border border-border-default bg-bg-tertiary overflow-hidden group"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={URL.createObjectURL(slot.blob)}
        alt={label}
        className="w-full h-full object-contain"
      />
      <div
        className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-white text-[10px] font-medium"
        style={{ background: "rgba(0, 0, 0, 0.6)" }}
      >
        {label}
      </div>
      {slot.cropped ? (
        <div
          className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-white text-[10px] font-medium"
          style={{ background: "var(--success)" }}
        >
          已裁
        </div>
      ) : null}
      {/* hover 提示：可粘贴 */}
      {hover ? (
        <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] text-white opacity-80"
          style={{ background: "rgba(0, 0, 0, 0.6)" }}
        >
          Ctrl+V 替换
        </div>
      ) : null}
      <div
        className="absolute inset-0 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 gap-1.5"
        style={{ background: hover ? "rgba(0, 0, 0, 0.55)" : "transparent" }}
      >
        <label
          htmlFor={inputId}
          className="px-2.5 py-1 bg-white/95 hover:bg-white text-[11px] text-gray-900 rounded cursor-pointer flex items-center gap-1"
        >
          <ImageIcon size={11} strokeWidth={2.2} />
          替换
          <input
            id={inputId}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0) onPick(slotIndex, files);
              e.target.value = "";
            }}
            className="hidden"
          />
        </label>
        <button
          type="button"
          onClick={onStartCrop}
          className="px-2.5 py-1 bg-white/95 hover:bg-white text-[11px] text-gray-900 rounded flex items-center gap-1"
        >
          <CropIcon size={11} strokeWidth={2.2} />
          裁剪
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="px-2.5 py-1 text-[11px] text-white rounded flex items-center gap-1"
          style={{ background: "var(--danger)" }}
        >
          <X size={11} strokeWidth={2.2} />
          删除
        </button>
      </div>
    </div>
  );
}

/* ─────────── 右栏 ─────────── */

function RightPanel({
  aiModels,
  modelId,
  onModelChange,
  aspectRatio,
  onAspectChange,
  qualityLevel,
  onQualityChange,
  userSeed,
  onUserSeedChange,
  totalCount,
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
  modelId: string;
  onModelChange: (m: string) => void;
  aspectRatio: string;
  onAspectChange: (a: string) => void;
  qualityLevel: QualityLevel;
  onQualityChange: (q: QualityLevel) => void;
  userSeed: string;
  onUserSeedChange: (s: string) => void;
  totalCount: number;
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

      {/* 参数 */}
      <div className="card p-4 space-y-3">
        <div className="section-label">生成参数</div>

        <div>
          <div className="text-[11px] text-fg-tertiary mb-1.5">模型</div>
          {aiModels.length === 0 ? (
            <div className="text-xs text-fg-tertiary">暂无模型</div>
          ) : (
            <select
              value={modelId}
              onChange={(e) => onModelChange(e.target.value)}
              className="input select text-[12px] h-9 select"
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
            placeholder="如：强化温馨感、保留原腰带、头发微动"
            className="input text-[12px] resize-none"
          />
        </div>
      </div>

      {/* 估价 */}
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
                  : ` · 仅 ${estimate.can_afford_count} 张`}
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
          className="btn btn-primary btn-lg w-full"
        >
          {submitting ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              提交中…
            </>
          ) : (
            <>
              开始生成
              <span className="text-xs opacity-80">· {totalCount} 张</span>
            </>
          )}
        </button>
        <div className="flex gap-2">
          <ResetButton
            label="清空"
            size="sm"
            variant="outline"
            onConfirm={onReset}
            confirmDetail="将清除已上传的产品图、解析结果、选择的模特/场景/姿势/风格组合。当前正在进行的任务不受影响。"
          />
          <div className="text-[10px] text-fg-muted flex-1 self-center">
            F5 刷新会清空所有状态
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

function EmptyHint({ href, label }: { href: string; label: string }) {
  return (
    <div className="text-xs text-fg-tertiary p-3 bg-bg-tertiary rounded-md border border-dashed border-border-default">
      <a href={href} className="text-brand-400 hover:underline">
        {label}
      </a>
    </div>
  );
}

function ChoiceGroup({
  label,
  items,
  selectedId,
  onChange,
  emptyHint,
}: {
  label: string;
  items: Array<{
    id: number;
    label: string;
    desc?: string | null;
    isDefault?: boolean;
  }>;
  selectedId: number | null;
  onChange: (id: number) => void;
  emptyHint: { href: string; label: string };
}) {
  return (
    <div>
      <div className="text-[11px] text-fg-tertiary mb-1.5">{label}</div>
      {items.length === 0 ? (
        <EmptyHint href={emptyHint.href} label={emptyHint.label} />
      ) : (
        <div className="grid gap-1.5">
          {items.map((it) => {
            const active = selectedId === it.id;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onChange(it.id)}
                className={`text-left p-2.5 rounded-md border text-[12px] transition-colors ${
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
                <div className="font-medium flex items-center gap-1.5">
                  {it.label}
                  {it.isDefault && (
                    <span className="chip chip-success text-[10px]">默认</span>
                  )}
                </div>
                {it.desc && (
                  <div className="text-fg-tertiary mt-0.5 line-clamp-2 text-[11px]">
                    {it.desc}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
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
