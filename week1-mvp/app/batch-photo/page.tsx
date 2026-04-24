"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageCropper } from "@/app/_components/image-cropper";
import { AppShell } from "@/app/_components/app-shell";
import { NotificationStack, useNotifications, notifyHelpers } from "@/app/_components/notification-stack";
import { JobProgressPanel } from "@/app/_components/job-progress-panel";
import { JobResultsGrid } from "@/app/_components/job-results-grid";
import { Thumbnail, ThumbnailBadge } from "@/app/_components/thumbnail";
import { ResetButton } from "@/app/_components/reset-button";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useJobPolling } from "@/lib/hooks/use-job-polling";
import { useSlotStore } from "@/lib/stores/task-store";

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
};
type Scene = {
  id: number;
  name: string;
  image_url: string;
  tags: string | null;
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
    slotStore.get<string>("activeJobId") ?? null,
  );
  const [activeJobCount, setActiveJobCount] = useState(0);

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

          // 默认选中（slot 有值优先）
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

    // 恢复 slot 其他状态
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

    // 活跃任务数
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
    // 如果用户一次选了多张，自动分到后续空槽位
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
    // 清掉解析（原图变了）
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
      // 产品图按 slot 顺序依次 append（空槽跳过）
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

  if (!user) return <div className="p-8 text-gray-500 text-sm">正在加载…</div>;

  /* ─────────── 渲染 ─────────── */

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
        />
      }
    >
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">批量摄影图</h1>
          <p className="mt-1 text-sm text-gray-500">
            产品图 → 解析款式 → 选模特/场景/姿势 → 批量生成模特穿着图
          </p>
        </header>

        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-6">
          {/* Step 1: 3 固定槽位产品图 */}
          <StepBlock step={1} title="上传产品图（3 槽位）">
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
                />
              ))}
            </div>
            {hasProductImages && (
              <p className="mt-2 text-[11px] text-gray-500">
                一次选多张时会自动填入后续空槽位。点"删除"清空，点"替换"重传，点"裁剪"手动调整。
              </p>
            )}
          </StepBlock>

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
            <StepBlock
              step={2}
              title="款式解析 + 服装材质（可选）"
            >
              <div className="mb-3">
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={analyzing || !slots[0]}
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
              {garmentAttrs && (
                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-gray-500">匹配材质：</span>
                  {selectedMaterials.map((m) => (
                    <span
                      key={m.id}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-50 border border-blue-200 text-xs text-blue-800"
                    >
                      {m.name}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedMaterialIds((p) =>
                            p.filter((x) => x !== m.id),
                          )
                        }
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
                      className="px-2 py-1 rounded-full border border-dashed border-gray-400 text-xs text-gray-600 hover:border-blue-500"
                    >
                      + 添加
                    </button>
                    {showMaterialPicker && (
                      <div className="absolute top-full mt-1 left-0 z-10 bg-white border border-gray-200 rounded-md shadow-lg p-2 max-h-64 overflow-y-auto w-64">
                        {unselectedMaterials.length === 0 ? (
                          <div className="text-xs text-gray-500 p-2">
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
                              className="w-full text-left px-2 py-1.5 text-sm hover:bg-blue-50 rounded"
                            >
                              {m.name}
                              {m.english_name && (
                                <span className="ml-1 text-xs text-gray-500 font-mono">
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
            </StepBlock>
          )}

          {/* Step 3: 模特 */}
          <StepBlock step={3} title="选择模特形象">
            {identities.length === 0 ? (
              <EmptyHint
                href="/admin/models"
                label="去添加模特形象（需 PNG 透明底）"
              />
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {identities.map((m) => (
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
                    className="cursor-pointer"
                  />
                ))}
              </div>
            )}
          </StepBlock>

          {/* Step 4: 场景 */}
          <StepBlock step={4} title="选择场景">
            {scenes.length === 0 ? (
              <EmptyHint href="/admin/scenes" label="去添加场景" />
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {scenes.map((s) => (
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
            )}
          </StepBlock>

          {/* Step 5: 姿势 */}
          <StepBlock
            step={5}
            title={`选择姿势（已选 ${selectedPoseIds.size}，生成 ${selectedPoseIds.size} 张）`}
          >
            {poses.length === 0 ? (
              <EmptyHint href="/admin/poses" label="去添加姿势" />
            ) : (
              <div className="space-y-3">
                {(["full", "half", "closeup"] as PoseType[]).map((type) => (
                  <div key={type}>
                    <div className="text-xs text-gray-500 mb-1">
                      {POSE_TYPE_LABEL[type]}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {posesByType[type].map((p) => {
                        const active = selectedPoseIds.has(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => togglePose(p.id)}
                            title={p.text}
                            className={`px-2.5 py-1 rounded-full border text-xs transition ${
                              active
                                ? "border-blue-500 bg-blue-50 text-blue-800"
                                : "border-gray-300 hover:border-gray-400"
                            }`}
                          >
                            {p.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </StepBlock>

          {/* Step 6: 风格组合 */}
          <StepBlock step={6} title="风格组合">
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
                emptyHint={{ href: "/admin/prompts", label: "Prompt 模板为空" }}
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
          </StepBlock>
        </section>

        {/* 结果区 */}
        {polling.data && polling.data.items.length > 0 && (
          <section className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">生成结果</h2>
            <JobResultsGrid
              items={polling.data.items}
              groupBy={null}
              zipFilenamePrefix="batch_photo"
              subtitle={
                polling.data.job.status === "completed"
                  ? `完成 ${polling.data.job.completed_count}/${polling.data.job.total_count}`
                  : undefined
              }
            />
          </section>
        )}
      </div>
    </AppShell>
  );
}

/* ─────────── 3 槽位组件 ─────────── */

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
  onPick: (slotIdx: number, files: FileList | null) => void;
  onRemove: () => void;
  onStartCrop: () => void;
}) {
  const inputId = `product-slot-${slotIndex}`;
  if (!slot) {
    return (
      <label
        htmlFor={inputId}
        className="relative aspect-[3/4] rounded-md border-2 border-dashed border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/50 cursor-pointer flex flex-col items-center justify-center text-center p-3"
      >
        <input
          id={inputId}
          type="file"
          accept="image/*"
          multiple={slotIndex === 0 /* 只有第一个支持一次选多张自动分配 */}
          onChange={(e) => onPick(slotIndex, e.target.files)}
          className="hidden"
        />
        <div className="text-2xl text-gray-400">+</div>
        <div className="mt-1 text-sm font-medium text-gray-700">{label}</div>
        <div className="mt-0.5 text-[10px] text-gray-400">{hint}</div>
      </label>
    );
  }

  return (
    <div className="relative aspect-[3/4] rounded-md border-2 border-gray-200 bg-gray-100 overflow-hidden group">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={URL.createObjectURL(slot.blob)}
        alt={label}
        className="w-full h-full object-contain"
      />
      {/* 左上角：槽位名 */}
      <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">
        {label}
      </div>
      {/* 右上角：状态 */}
      {slot.cropped ? (
        <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-green-600 text-white text-[10px]">
          已裁
        </div>
      ) : null}
      {/* 悬浮层：替换 / 裁剪 / 删除 */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 gap-1">
        <label
          htmlFor={inputId}
          className="px-2 py-1 bg-white/90 hover:bg-white text-[11px] text-gray-800 rounded cursor-pointer"
        >
          替换
          <input
            id={inputId}
            type="file"
            accept="image/*"
            onChange={(e) => onPick(slotIndex, e.target.files)}
            className="hidden"
          />
        </label>
        <button
          type="button"
          onClick={onStartCrop}
          className="px-2 py-1 bg-white/90 hover:bg-white text-[11px] text-gray-800 rounded"
        >
          裁剪
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="px-2 py-1 bg-red-600/90 hover:bg-red-700 text-[11px] text-white rounded"
        >
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
  onDismissJob,
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
}) {
  return (
    <div className="p-3 space-y-3 text-sm">
      <NotificationStack />

      {poll ? (
        <JobProgressPanel
          job={poll.job}
          items={poll.items}
          nextTokenReadyAtMs={poll.next_token_ready_at_ms}
          serverTimeMs={poll.server_time_ms}
          onCancelDone={
            poll.job.status === "completed" ||
            poll.job.status === "canceled" ||
            poll.job.status === "failed"
              ? onDismissJob
              : undefined
          }
        />
      ) : null}
      {pollError ? (
        <div className="p-2 rounded border border-red-200 bg-red-50 text-xs text-red-700">
          轮询失败：{pollError}
        </div>
      ) : null}

      {/* 参数 */}
      <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3">
        <div className="text-xs font-medium text-gray-500">生成参数</div>

        <div>
          <div className="text-xs text-gray-500 mb-1">模型</div>
          {aiModels.length === 0 ? (
            <div className="text-xs text-gray-500">暂无模型</div>
          ) : (
            <select
              value={modelId}
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

        <div>
          <div className="text-xs text-gray-500 mb-1">
            追加指令{" "}
            <span className="text-gray-400 font-normal">（可选）</span>
          </div>
          <textarea
            value={userSeed}
            onChange={(e) => onUserSeedChange(e.target.value)}
            rows={2}
            placeholder="如：强化温馨感、保留原腰带、头发微动"
            className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded resize-none"
          />
        </div>
      </div>

      {/* 估价 */}
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
                {estimate.affordable ? " · 充足" : ` · 仅 ${estimate.can_afford_count} 张`}
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
            <>开始生成 <span className="text-xs opacity-80">· {totalCount} 张</span></>
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
          <div className="text-[10px] text-gray-400 flex-1 self-center">
            F5 刷新会清空所有状态
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

function StepBlock({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        {step}. {title}
      </h3>
      {children}
    </div>
  );
}

function EmptyHint({ href, label }: { href: string; label: string }) {
  return (
    <div className="text-xs text-gray-500 p-3 bg-gray-50 rounded border border-dashed border-gray-300">
      <a href={href} className="text-blue-600 underline">
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
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      {items.length === 0 ? (
        <EmptyHint href={emptyHint.href} label={emptyHint.label} />
      ) : (
        <div className="grid gap-1">
          {items.map((it) => {
            const active = selectedId === it.id;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onChange(it.id)}
                className={`text-left p-2 rounded-md border text-xs transition ${
                  active
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-300 hover:border-gray-400"
                }`}
              >
                <div className="font-medium text-gray-900 flex items-center gap-1">
                  {it.label}
                  {it.isDefault && (
                    <span className="text-[10px] px-1 rounded bg-green-100 text-green-700">
                      默认
                    </span>
                  )}
                </div>
                {it.desc && (
                  <div className="text-gray-500 mt-0.5 line-clamp-2">
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
