"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
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
  ChevronDown, ChevronRight, Upload, X, Crop, ImagePlus, Clipboard,
  Package, Shirt, Users, MapPin, RotateCw, Sparkles, Camera,
  Search, Layers, Eye, Maximize2
} from "lucide-react";

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
  category?: string | null;
  category_label?: string | null;
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

/** 单个槽位的状态（空 = null） */
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

export default function BatchPhotoPage() {
  const user = useCurrentUser();
  const slotStore = useSlotStore("batchPhoto");
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
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState<number | null>(null);

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
  const [selectedPoseIds, setSelectedPoseIds] = useState<Set<number>>(new Set());
  const [modelId, setModelId] = useState<string>("");
  const [aspectRatio, setAspectRatio] = useState<string>("3:4");
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>("2k");
  const [userSeed, setUserSeed] = useState("");

  // ─── 折叠状态 ───
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    upload: false,
    analyze: false,
    model: false,
    scene: false,
    pose: true, // 姿势默认折叠
    style: true, // 风格默认折叠
  });

  // ─── 模特分类折叠 ───
  const [collapsedModelCategories, setCollapsedModelCategories] = useState<Record<string, boolean>>({});

  // ─── 场景分类折叠 ───
  const [collapsedSceneCategories, setCollapsedSceneCategories] = useState<Record<string, boolean>>({});

  // ─── 姿势分类折叠 ───
  const [collapsedPoseTypes, setCollapsedPoseTypes] = useState<Record<PoseType, boolean>>({
    full: false,
    half: false,
    closeup: false,
  });

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

  /* ─── 折叠控制 ─── */
  function toggleSection(key: string) {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }
  function toggleModelCategory(cat: string) {
    setCollapsedModelCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  }
  function toggleSceneCategory(cat: string) {
    setCollapsedSceneCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  }
  function togglePoseType(type: PoseType) {
    setCollapsedPoseTypes(prev => ({ ...prev, [type]: !prev[type] }));
  }

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
          Identity[], Scene[], PromptTemplate[], Photography[],
          Realism[], Pose[], AiModel[], Material[],
        ]) => {
          setIdentities(ids);
          setScenes(scs);
          setTemplates(tpls);
          setPhotoParams(photo);
          setRealisms(real);
          setPoses(pos);
          setAiModels(models);
          setAllMaterials(mats);

          // 初始化所有模特分类为折叠
          const CATEGORY_ORDER = ["通用", "大码", "孕妇", "青少年"];
          const groups = new Map<string, Identity[]>();
          for (const m of ids) {
            const key = m.category_label || "未分类";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(m);
          }
          const allCats = [
            ...CATEGORY_ORDER.filter((k) => groups.has(k)),
            ...Array.from(groups.keys()).filter((k) => !CATEGORY_ORDER.includes(k)),
          ];
          const initCats: Record<string, boolean> = {};
          allCats.forEach(cat => { initCats[cat] = cat !== "通用"; }); // 默认只展开"通用"
          setCollapsedModelCategories(initCats);

          // 初始化场景分类折叠
          const sceneGroups = new Map<string, Scene[]>();
          for (const s of scs) {
            const key = s.category_label || "默认";
            if (!sceneGroups.has(key)) sceneGroups.set(key, []);
            sceneGroups.get(key)!.push(s);
          }
          const initSceneCats: Record<string, boolean> = {};
          sceneGroups.forEach((_, cat) => { initSceneCats[cat] = true; }); // 默认全折叠
          setCollapsedSceneCategories(initSceneCats);

          const savedTpl = slotStore.get<number>("templateId");
          if (savedTpl && tpls.find((t) => t.id === savedTpl)) setTemplateId(savedTpl);
          else if (tpls[0]) setTemplateId(tpls[0].id);
          const savedPhoto = slotStore.get<number>("photographyId");
          const defPhoto = photo.find((p) => p.is_default === 1)?.id || photo[0]?.id;
          setPhotographyId(savedPhoto ?? defPhoto ?? null);
          const savedReal = slotStore.get<number>("realismId");
          const defReal = real.find((r) => r.is_default === 1)?.id || real[0]?.id;
          setRealismId(savedReal ?? defReal ?? null);
          const savedModel = slotStore.get<string>("modelId");
          const defModel = models.find((m) => m.is_default === 1)?.model_id || models[0]?.model_id;
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
  }, []);

  /* ─── 持久化 ─── */
  useEffect(() => {
    slotStore.merge({
      identityId, sceneId, templateId, photographyId, realismId, modelId,
      aspectRatio, qualityLevel, userSeed, garmentAttrs, selectedMaterialIds,
      selectedPoseIds: Array.from(selectedPoseIds),
    });
  }, [identityId, sceneId, templateId, photographyId, realismId, modelId,
    aspectRatio, qualityLevel, userSeed, garmentAttrs, selectedMaterialIds, selectedPoseIds]);

  /* ─── 估价 ─── */
  useEffect(() => {
    const count = selectedPoseIds.size;
    if (count === 0 || !modelId) { setEstimate(null); return; }
    const t = setTimeout(() => {
      fetch("/api/billing/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, quality_level: qualityLevel, image_count: count }),
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
        notifyHelpers.success(push, `批量摄影图完成 · ${job.completed_count}/${job.total_count}`,
          job.failed_count > 0 ? `${job.failed_count} 张失败，其余已完成。` : undefined);
      } else if (job.status === "canceled") {
        notifyHelpers.info(push, `任务已停止`, `已完成 ${job.completed_count} / 共 ${job.total_count}`);
      } else if (job.status === "failed") {
        notifyHelpers.error(push, `任务失败`, job.error_message || "请查看详细日志");
      }
    },
  });

  useEffect(() => {
    if (polling.error && polling.error.includes("不存在")) {
      setActiveJobId(null);
      slotStore.setActiveJob(null);
      setViewMode("form");
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
            // 找到第一个空槽位
            const emptyIdx = slots.findIndex(s => s === null);
            if (emptyIdx !== -1) {
              void setSlotFromFile(emptyIdx, file);
            } else {
              notifyHelpers.info(push, "所有槽位已满", "请删除已有图片后再粘贴");
            }
            break;
          }
        }
      }
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [slots, push]);

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

  function onSlotPick(slotIdx: number, fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    if (files.length === 1) {
      void setSlotFromFile(slotIdx, files[0]);
      return;
    }
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
      if (cur) next[slotIdx] = { ...cur, blob, cropped: true };
      return next;
    });
    setCroppingSlot(null);
  }

  /* ─── 解析 ─── */
  async function handleAnalyze() {
    const slot = slots[0];
    if (!slot) { notifyHelpers.warn(push, "请先上传正面图"); return; }
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
      notifyHelpers.error(push, "款式解析失败", e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function rematchMaterials(materialText: string) {
    if (!materialText) { setSelectedMaterialIds([]); return; }
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

  function togglePose(id: number) {
    setSelectedPoseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canSubmit =
    !submitting && !analyzing && hasProductImages &&
    identityId !== null && sceneId !== null &&
    templateId !== null && selectedPoseIds.size > 0 && Boolean(modelId);

  /* ─── 提交 ─── */
  async function handleSubmit() {
    if (!canSubmit) {
      notifyHelpers.warn(push, "请完成所有必填项（至少正面图 + 模特/场景/Prompt/姿势）");
      return;
    }
    if (estimate && !estimate.affordable && !estimate.is_unlimited) {
      const ok = confirm(
        `预估花费 ¥${estimate.total_cost_cny.toFixed(2)}，超过余额 ¥${estimate.remaining_cny.toFixed(2)}。\n\n` +
        `建议把姿势减到 ${estimate.can_afford_count} 个以内。\n\n仍要提交吗？`);
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      let productIdx = 0;
      slots.forEach((s) => {
        if (s) { fd.append(`product_image${productIdx}`, s.blob, s.file.name); productIdx += 1; }
      });
      fd.append("identity_id", String(identityId));
      fd.append("scene_id", String(sceneId));
      fd.append("template_id", String(templateId));
      if (photographyId) fd.append("photography_id", String(photographyId));
      if (realismId) fd.append("realism_id", String(realismId));
      fd.append("pose_ids", JSON.stringify(Array.from(selectedPoseIds)));
      if (selectedMaterialIds.length > 0) fd.append("material_ids", JSON.stringify(selectedMaterialIds));
      if (garmentAttrs) fd.append("garment_attrs", JSON.stringify(garmentAttrs));
      fd.append("model", modelId);
      fd.append("aspect_ratio", aspectRatio);
      fd.append("quality_level", qualityLevel);
      if (userSeed.trim()) fd.append("user_seed", userSeed.trim());

      const res = await fetch("/api/jobs/batch-photo", { method: "POST", body: fd });
      const body = (await res.json()) as { job_id?: string; error?: string };
      if (!res.ok || !body.job_id) throw new Error(body.error || res.statusText);
      setActiveJobId(body.job_id);
      slotStore.setActiveJob(body.job_id);
      setActiveJobCount((v) => v + 1);
      setViewMode("task");
      notifyHelpers.info(push, `任务已提交`, `共 ${selectedPoseIds.size} 张 · 预计 ${Math.ceil(selectedPoseIds.size / 2)}+ 分钟`);
    } catch (e) {
      notifyHelpers.error(push, "提交失败", e instanceof Error ? e.message : String(e));
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

  if (!user) return <div className="p-8 text-center" style={{ color: 'var(--text-tertiary)' }}>正在加载…</div>;

  const showTaskViewport = viewMode === "task" && polling.data;

  /* ═══════════════════ 渲染 ═══════════════════ */

  return (
    <AppShell
      leftNav={{ user, activeJobCount }}
      rightPanel={
        <RightPanelDark
          aiModels={aiModels} modelId={modelId} onModelChange={setModelId}
          aspectRatio={aspectRatio} onAspectChange={setAspectRatio}
          qualityLevel={qualityLevel} onQualityChange={setQualityLevel}
          userSeed={userSeed} onUserSeedChange={setUserSeed}
          totalCount={selectedPoseIds.size} estimate={estimate}
          submitting={submitting} canSubmit={canSubmit}
          onSubmit={handleSubmit} onReset={resetAll}
          poll={polling.data} pollError={polling.error}
          onDismissJob={dismissCurrentJob}
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
          zipPrefix="batch_photo"
        />
      ) : (
      <div className="p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>批量摄影图</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-tertiary)' }}>
            产品图 → 解析款式 → 选模特/场景/姿势 → 批量生成
          </p>
        </header>

        {/* Step 1: 上传产品图 - 可折叠 */}
        <CollapsibleSection
          icon={<Package size={16} />}
          title="1. 上传产品图"
          subtitle={hasProductImages ? `已上传 ${filledSlots.length}/3 张` : "必需"}
          isOpen={!collapsedSections.upload}
          onToggle={() => toggleSection("upload")}
          badge={hasProductImages ? "success" : undefined}
        >
          <div className="grid grid-cols-3 gap-3">
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
                isHovered={hoveredSlotIndex === i}
                onHover={(h) => setHoveredSlotIndex(h ? i : null)}
              />
            ))}
          </div>
          {hasProductImages && (
            <p className="mt-2 text-xs flex items-center gap-2" style={{ color: 'var(--text-tertiary)' }}>
              <Clipboard size={12} />
              支持 Ctrl+V 粘贴图片到空槽位 · 一次选多张会自动填入后续空槽
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

        {/* Step 2: 款式解析 - 可折叠 */}
        {hasProductImages && (
          <CollapsibleSection
            icon={<Shirt size={16} />}
            title="2. 款式解析"
            subtitle={garmentAttrs ? "已解析" : "可选"}
            isOpen={!collapsedSections.analyze}
            onToggle={() => toggleSection("analyze")}
            badge={garmentAttrs ? "success" : undefined}
          >
            <div className="mb-3">
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={analyzing || !slots[0]}
                className="btn btn-md btn-primary"
              >
                {analyzing ? <span className="spinner" /> : null}
                {analyzing ? "解析中..." : garmentAttrs ? "重新解析" : "解析款式"}
              </button>
            </div>
            {garmentAttrs && (
              <GarmentAttrsEditor attrs={garmentAttrs} onChange={updateGarmentAttr} onMaterialTextBlur={rematchMaterials} />
            )}
            {garmentAttrs && (
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>匹配材质：</span>
                {selectedMaterials.map((m) => (
                  <span key={m.id} className="chip chip-brand flex items-center gap-1">
                    {m.name}
                    <button type="button" onClick={() => setSelectedMaterialIds((p) => p.filter((x) => x !== m.id))}
                      className="ml-1 hover:text-red-400">×</button>
                  </span>
                ))}
                <div className="relative">
                  <button type="button" onClick={() => setShowMaterialPicker((v) => !v)}
                    className="btn btn-sm btn-outline">
                    + 添加材质
                  </button>
                  {showMaterialPicker && (
                    <div className="absolute top-full mt-1 left-0 z-10 rounded-lg border p-2 max-h-64 overflow-y-auto w-64"
                      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-base)' }}>
                      {unselectedMaterials.length === 0 ? (
                        <div className="text-xs p-2" style={{ color: 'var(--text-tertiary)' }}>全部已添加</div>
                      ) : unselectedMaterials.map((m) => (
                        <button key={m.id} onClick={() => { setSelectedMaterialIds((p) => [...p, m.id]); setShowMaterialPicker(false); }}
                          className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-white/5"
                          style={{ color: 'var(--text-primary)' }}>
                          {m.name} {m.english_name && <span className="text-xs ml-1" style={{ color: 'var(--text-tertiary)' }}>{m.english_name}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* Step 3: 模特形象 - 可折叠 */}
        <CollapsibleSection
          icon={<Users size={16} />}
          title="3. 选择模特形象"
          subtitle={identityId ? "已选择" : "必需"}
          isOpen={!collapsedSections.model}
          onToggle={() => toggleSection("model")}
          badge={identityId ? "success" : undefined}
        >
          {identities.length === 0 ? (
            <EmptyHint href="/admin/models" label="去添加模特形象（需 PNG 透明底）" />
          ) : (
            (() => {
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
              return (
                <div className="space-y-3">
                  {orderedKeys.map((cat) => (
                    <div key={cat}>
                      <button
                        type="button"
                        onClick={() => toggleModelCategory(cat)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                        style={{
                          background: collapsedModelCategories[cat] ? 'var(--bg-card)' : 'var(--bg-card-hover)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {collapsedModelCategories[cat] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        <span>{cat}</span>
                        <span className="text-xs ml-auto" style={{ color: 'var(--text-tertiary)' }}>
                          {groups.get(cat)!.length} 个
                        </span>
                      </button>
                      {!collapsedModelCategories[cat] && (
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mt-2">
                          {groups.get(cat)!.map((m) => (
                            <Thumbnail
                              key={m.id}
                              src={m.image_url}
                              alt={m.name}
                              ratio="3/4"
                              fit="contain"
                              selected={identityId === m.id}
                              onClick={() => setIdentityId(m.id)}
                              badge={identityId === m.id ? <ThumbnailBadge tone="blue">已选</ThumbnailBadge> : undefined}
                              className="cursor-pointer"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </CollapsibleSection>

        {/* Step 4: 场景 - 可折叠 */}
        <CollapsibleSection
          icon={<MapPin size={16} />}
          title="4. 选择场景"
          subtitle={sceneId ? "已选择" : "必需"}
          isOpen={!collapsedSections.scene}
          onToggle={() => toggleSection("scene")}
          badge={sceneId ? "success" : undefined}
        >
          {scenes.length === 0 ? (
            <EmptyHint href="/admin/scenes" label="去添加场景" />
          ) : (
            (() => {
              // 按分类分组
              const groups = new Map<string, Scene[]>();
              for (const s of scenes) {
                const key = s.category_label || "默认场景";
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(s);
              }
              const orderedKeys = Array.from(groups.keys());
              return (
                <div className="space-y-3">
                  {orderedKeys.map((cat) => (
                    <div key={cat}>
                      <button
                        type="button"
                        onClick={() => toggleSceneCategory(cat)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                        style={{
                          background: collapsedSceneCategories[cat] ? 'var(--bg-card)' : 'var(--bg-card-hover)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {collapsedSceneCategories[cat] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        <span>{cat}</span>
                        <span className="text-xs ml-auto" style={{ color: 'var(--text-tertiary)' }}>
                          {groups.get(cat)!.length} 个
                        </span>
                      </button>
                      {!collapsedSceneCategories[cat] && (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
                          {groups.get(cat)!.map((s) => (
                            <Thumbnail
                              key={s.id}
                              src={s.image_url}
                              alt={s.name}
                              ratio="3/4"
                              fit="contain"
                              selected={sceneId === s.id}
                              onClick={() => setSceneId(s.id)}
                              badge={sceneId === s.id ? <ThumbnailBadge tone="blue">已选</ThumbnailBadge> : undefined}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </CollapsibleSection>

        {/* Step 5: 姿势 - 可折叠 */}
        <CollapsibleSection
          icon={<RotateCw size={16} />}
          title="5. 选择姿势"
          subtitle={`已选 ${selectedPoseIds.size} 个`}
          isOpen={!collapsedSections.pose}
          onToggle={() => toggleSection("pose")}
          badge={selectedPoseIds.size > 0 ? "success" : undefined}
        >
          {poses.length === 0 ? (
            <EmptyHint href="/admin/poses" label="去添加姿势" />
          ) : (
            <div className="space-y-3">
              {(["full", "half", "closeup"] as PoseType[]).map((type) => (
                <div key={type}>
                  <button
                    type="button"
                    onClick={() => togglePoseType(type)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                    style={{
                      background: collapsedPoseTypes[type] ? 'var(--bg-card)' : 'var(--bg-card-hover)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {collapsedPoseTypes[type] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <span>{POSE_TYPE_LABEL[type]}</span>
                    <span className="text-xs ml-auto" style={{ color: 'var(--text-tertiary)' }}>
                      {posesByType[type].length} 个 · 已选 {posesByType[type].filter(p => selectedPoseIds.has(p.id)).length}
                    </span>
                  </button>
                  {!collapsedPoseTypes[type] && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {posesByType[type].map((p) => {
                        const active = selectedPoseIds.has(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => togglePose(p.id)}
                            title={p.text}
                            className={`px-3 py-1.5 rounded-full border text-xs transition-all ${
                              active ? "selected chip-brand" : "btn-outline"
                            }`}
                          >
                            {p.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* Step 6: 风格组合 - 可折叠 */}
        <CollapsibleSection
          icon={<Layers size={16} />}
          title="6. 风格组合"
          subtitle="可选配置"
          isOpen={!collapsedSections.style}
          onToggle={() => toggleSection("style")}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ChoiceGroup
              label="Prompt 模板" icon={<Sparkles size={14} />}
              items={templates.map((t) => ({ id: t.id, label: t.name, desc: t.notes || null }))}
              selectedId={templateId} onChange={setTemplateId}
              emptyHint={{ href: "/admin/prompts", label: "Prompt 模板为空" }}
            />
            <ChoiceGroup
              label="摄影参数" icon={<Camera size={14} />}
              items={photoParams.map((p) => ({ id: p.id, label: p.name, desc: p.description, isDefault: p.is_default === 1 }))}
              selectedId={photographyId} onChange={setPhotographyId}
              emptyHint={{ href: "/admin/photography", label: "摄影参数为空" }}
            />
            <ChoiceGroup
              label="真实感" icon={<Eye size={14} />}
              items={realisms.map((r) => ({ id: r.id, label: r.name, desc: r.description, isDefault: r.is_default === 1 }))}
              selectedId={realismId} onChange={setRealismId}
              emptyHint={{ href: "/admin/realism", label: "真实感为空" }}
            />
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
  const badgeColors = {
    success: "chip-success",
    warning: "chip-warn",
  };
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${isOpen ? "section-dark" : ""}`}
        style={{
          background: isOpen ? 'var(--bg-card)' : 'var(--bg-secondary)',
          border: `1px solid ${isOpen ? 'var(--border-glow)' : 'var(--border-subtle)'}`,
          color: 'var(--text-primary)',
          boxShadow: isOpen ? 'var(--shadow-glow)' : 'none',
        }}
      >
        <span style={{ color: 'var(--primary)' }}>{icon}</span>
        <span className="flex-1 text-left">{title}</span>
        {subtitle && (
          <span className="text-xs mr-2" style={{ color: 'var(--text-tertiary)' }}>{subtitle}</span>
        )}
        {badge && <span className={`chip ${badgeColors[badge]}`}>{badge === 'success' ? '✓' : ''}</span>}
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

/* ═══════════════════ 3 槽位组件 - 支持粘贴 ═══════════════════ */
function ProductSlot({
  label, hint, slot, slotIndex, onPick, onRemove, onStartCrop, isHovered, onHover
}: {
  label: string; hint: string; slot: SlotFile | null; slotIndex: number;
  onPick: (slotIdx: number, files: FileList | null) => void;
  onRemove: () => void; onStartCrop: () => void;
  isHovered: boolean; onHover: (h: boolean) => void;
}) {
  const inputId = `product-slot-${slotIndex}`;
  
  // 槽位悬浮时监听粘贴
  useEffect(() => {
    if (!isHovered || slot !== null) return;
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); onPick(slotIndex, null); /* 直接处理 */ }
        }
      }
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [isHovered, slot, slotIndex, onPick]);

  if (!slot) {
    return (
      <label
        htmlFor={inputId}
        className="upload-zone relative flex flex-col items-center justify-center"
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        style={{ minHeight: '180px' }}
      >
        <input id={inputId} type="file" accept="image/*" multiple={slotIndex === 0}
          onChange={(e) => onPick(slotIndex, e.target.files)} className="hidden" />
        <Upload size={24} style={{ color: 'var(--text-tertiary)' }} />
        <div className="mt-2 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</div>
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{hint}</div>
        {isHovered && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl"
            style={{ background: 'rgba(59, 130, 246, 0.1)', border: '2px dashed var(--primary)' }}>
            <div className="text-center">
              <Clipboard size={24} style={{ color: 'var(--primary)' }} />
              <div className="mt-1 text-xs" style={{ color: 'var(--primary)' }}>Ctrl+V 粘贴</div>
            </div>
          </div>
        )}
      </label>
    );
  }

  return (
    <div
      className="relative rounded-xl overflow-hidden group"
      style={{
        aspectRatio: '3/4',
        border: '2px solid var(--border-base)',
        background: 'var(--bg-input)',
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <img src={URL.createObjectURL(slot.blob)} alt={label}
        className="w-full h-full object-contain" />
      {/* 左上角：槽位名 */}
      <div className="absolute top-2 left-2 px-2 py-1 rounded text-xs font-medium"
        style={{ background: 'rgba(0,0,0,0.7)', color: '#fff' }}>{label}</div>
      {/* 右上角：状态 */}
      {slot.cropped && (
        <div className="absolute top-2 right-2 px-2 py-1 rounded text-xs"
          style={{ background: 'var(--success-500)', color: '#fff' }}>已裁</div>
      )}
      {/* 悬浮层 */}
      <div className={`hover-overlay ${isHovered ? 'show' : ''}`}>
        <label htmlFor={inputId} className="btn btn-sm btn-secondary mx-1">
          替换
          <input id={inputId} type="file" accept="image/*"
            onChange={(e) => onPick(slotIndex, e.target.files)} className="hidden" />
        </label>
        <button type="button" onClick={onStartCrop} className="btn btn-sm btn-secondary mx-1">裁剪</button>
        <button type="button" onClick={onRemove} className="btn btn-sm btn-danger mx-1">删除</button>
      </div>
    </div>
  );
}

/* ═══════════════════ 右栏 - 深色主题 ═══════════════════ */
function RightPanelDark({
  aiModels, modelId, onModelChange, aspectRatio, onAspectChange,
  qualityLevel, onQualityChange, userSeed, onUserSeedChange, totalCount,
  estimate, submitting, canSubmit, onSubmit, onReset, poll, pollError,
  onDismissJob, hasActiveTask, viewMode, onSwitchView
}: {
  aiModels: AiModel[]; modelId: string; onModelChange: (m: string) => void;
  aspectRatio: string; onAspectChange: (a: string) => void;
  qualityLevel: QualityLevel; onQualityChange: (q: QualityLevel) => void;
  userSeed: string; onUserSeedChange: (s: string) => void;
  totalCount: number; estimate: CostEstimate | null;
  submitting: boolean; canSubmit: boolean; onSubmit: () => void; onReset: () => void;
  poll: import("@/lib/hooks/use-job-polling").PollResult | null;
  pollError: string | null; onDismissJob: () => void;
  hasActiveTask: boolean; viewMode: "form" | "task"; onSwitchView: () => void;
}) {
  return (
    <div className="p-4 space-y-4">
      <NotificationStack />

      {/* 任务切换提示条 */}
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

      {pollError ? (
        <div className="p-2 rounded text-xs" style={{ background: 'var(--danger-50)', border: '1px solid var(--danger-500)', color: 'var(--danger-500)' }}>
          轮询失败：{pollError}
        </div>
      ) : null}

      {/* 参数面板 */}
      <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>生成参数</div>

        {/* 模型 */}
        <div>
          <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>AI 模型</div>
          {aiModels.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>暂无模型</div>
          ) : (
            <select value={modelId} onChange={(e) => onModelChange(e.target.value)}
              className="input">
              {aiModels.map((m) => (
                <option key={m.model_id} value={m.model_id}>
                  {m.label}{m.badge ? ` (${m.badge})` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* 输出比例 */}
        <div>
          <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>输出比例</div>
          <select value={aspectRatio} onChange={(e) => onAspectChange(e.target.value)} className="input">
            {ASPECT_RATIOS.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </div>

        {/* 质量 */}
        <div>
          <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>清晰度</div>
          <select value={qualityLevel} onChange={(e) => onQualityChange(e.target.value as QualityLevel)} className="input">
            {QUALITY_LEVELS.map((q) => (
              <option key={q.value} value={q.value}>{q.label}</option>
            ))}
          </select>
          <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {QUALITY_LEVELS.find((q) => q.value === qualityLevel)?.desc}
          </div>
        </div>

        {/* 追加指令 */}
        <div>
          <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
            追加指令 <span className="font-normal" style={{ color: 'var(--text-tertiary)' }}>（可选）</span>
          </div>
          <textarea value={userSeed} onChange={(e) => onUserSeedChange(e.target.value)}
            rows={2} placeholder="如：强化温馨感、保留原腰带"
            className="input" />
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
            ¥{estimate.per_image_cny.toFixed(3)} × {totalCount} 张
          </div>
          <div className="mt-2 pt-2 text-xs" style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}>
            {estimate.is_unlimited ? "无限额度" : (
              <>余额 ¥{estimate.remaining_cny.toFixed(2)}{estimate.affordable ? " · 充足" : ` · 仅 ${estimate.can_afford_count} 张`}</>
            )}
          </div>
        </div>
      )}

      {/* 提交按钮 */}
      <div className="space-y-2">
        <button onClick={onSubmit} disabled={!canSubmit || submitting}
          className="btn btn-lg btn-primary w-full">
          {submitting ? (
            <><span className="spinner" /> 提交中…</>
          ) : (
            <>开始生成 <span className="text-xs opacity-80">· {totalCount} 张</span></>
          )}
        </button>
        <ResetButton label="清空" size="sm" variant="outline" onConfirm={onReset}
          confirmDetail="将清除已上传的产品图、解析结果、选择的模特/场景/姿势/风格组合。当前正在进行的任务不受影响。" />
      </div>

      <div className="text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
        受 Google quota 限制，每分钟最多 2 张
      </div>
    </div>
  );
}

/* ═══════════════════ 子组件 ═══════════════════ */
function EmptyHint({ href, label }: { href: string; label: string }) {
  return (
    <div className="empty-state rounded-lg text-xs"
      style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-base)' }}>
      <a href={href} style={{ color: 'var(--primary)' }} className="underline">{label}</a>
    </div>
  );
}

function ChoiceGroup({
  label, icon, items, selectedId, onChange, emptyHint
}: {
  label: string; icon: React.ReactNode;
  items: Array<{ id: number; label: string; desc?: string | null; isDefault?: boolean }>;
  selectedId: number | null; onChange: (id: number) => void; emptyHint: { href: string; label: string };
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
        {icon} {label}
      </div>
      {items.length === 0 ? (
        <EmptyHint href={emptyHint.href} label={emptyHint.label} />
      ) : (
        <div className="grid gap-1">
          {items.map((it) => {
            const active = selectedId === it.id;
            return (
              <button key={it.id} type="button" onClick={() => onChange(it.id)}
                className={`text-left p-3 rounded-lg border text-xs transition-all ${active ? "selected" : ""}`}
                style={{
                  background: active ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-card)',
                  borderColor: active ? 'var(--primary)' : 'var(--border-subtle)',
                }}>
                <div className="font-medium flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                  {it.label}
                  {it.isDefault && <span className="chip chip-success text-[10px]">默认</span>}
                </div>
                {it.desc && <div className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{it.desc}</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GarmentAttrsEditor({
  attrs, onChange, onMaterialTextBlur
}: {
  attrs: GarmentAttrs; onChange: (key: string, value: string) => void;
  onMaterialTextBlur: (value: string) => void;
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
