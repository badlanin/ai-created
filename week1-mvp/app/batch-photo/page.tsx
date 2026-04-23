"use client";

import { useEffect, useMemo, useState } from "react";

// ============ Types ============
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
type BatchResult = {
  pose_id: number;
  pose_name: string;
  pose_type: string;
  success: boolean;
  image_url?: string;
  error?: string;
  duration_ms?: number;
};

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
  { value: "4k", label: "4K 超清", desc: "按 4K 重绘整张图（推荐）" },
  { value: "2k", label: "2K 高清", desc: "按 2K 重绘，稍快" },
  { value: "hd", label: "HD 清晰", desc: "保守，轻度锐化" },
];

// ============ Helpers ============
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

// ============ Page ============
export default function BatchPhotoPage() {
  // ---- Libraries ----
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [photoParams, setPhotoParams] = useState<Photography[]>([]);
  const [realisms, setRealisms] = useState<Realism[]>([]);
  const [poses, setPoses] = useState<Pose[]>([]);
  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  const [allMaterials, setAllMaterials] = useState<Material[]>([]);

  // ---- Selections ----
  const [files, setFiles] = useState<File[]>([]);
  const [compressedBlobs, setCompressedBlobs] = useState<Blob[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [garmentAttrs, setGarmentAttrs] = useState<GarmentAttrs | null>(null);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<number[]>([]);
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);

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
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>("4k");
  const [userSeed, setUserSeed] = useState("");

  // ---- Submission state ----
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  // ==== Init load all libraries ====
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
        ([ids, scs, tpls, photo, real, poses, models, materials]: [
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
          setPoses(poses);
          setAiModels(models);
          setAllMaterials(materials);

          // 默认选中
          if (tpls[0]) setTemplateId(tpls[0].id);
          const defPhoto =
            photo.find((p) => p.is_default === 1)?.id || photo[0]?.id;
          if (defPhoto) setPhotographyId(defPhoto);
          const defReal =
            real.find((r) => r.is_default === 1)?.id || real[0]?.id;
          if (defReal) setRealismId(defReal);
          const defModel =
            models.find((m) => m.is_default === 1)?.model_id ||
            models[0]?.model_id;
          if (defModel) setModelId(defModel);
        },
      )
      .catch(() => {});
  }, []);

  // ==== File upload + analyze ====
  async function onPickFiles(fl: FileList | null) {
    if (!fl || fl.length === 0) {
      setFiles([]);
      setCompressedBlobs([]);
      setGarmentAttrs(null);
      setSelectedMaterialIds([]);
      setResults(null);
      setError(null);
      return;
    }
    const picked = Array.from(fl).slice(0, 3);
    setFiles(picked);
    setCompressedBlobs([]);
    setGarmentAttrs(null);
    setSelectedMaterialIds([]);
    setResults(null);
    setError(null);

    try {
      const blobs = await Promise.all(picked.map((f) => resizeImage(f, 2048)));
      setCompressedBlobs(blobs);
      await runAnalyze(blobs[0], picked[0].name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runAnalyze(blob: Blob, filename: string) {
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("image0", blob, filename);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const attrs = (await res.json()) as GarmentAttrs;
      setGarmentAttrs(attrs);

      const materialText = String(attrs["面料材质"] || "");
      if (materialText) {
        const mRes = await fetch("/api/materials/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: materialText }),
        });
        if (mRes.ok) {
          const body = (await mRes.json()) as { matched: Material[] };
          setSelectedMaterialIds(body.matched.map((m) => m.id));
        }
      }
    } catch (e) {
      setError("款式解析失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAnalyzing(false);
    }
  }

  // ==== Derived ====
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

  function canSubmit() {
    return (
      !loading &&
      !analyzing &&
      files.length > 0 &&
      compressedBlobs.length === files.length &&
      identityId !== null &&
      sceneId !== null &&
      templateId !== null &&
      selectedPoseIds.size > 0 &&
      modelId
    );
  }

  async function handleSubmit() {
    if (!canSubmit()) {
      setError("请完成所有必填项");
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    setElapsed(null);
    const startedAt = Date.now();

    try {
      const fd = new FormData();
      compressedBlobs.forEach((blob, i) => {
        fd.append(`product_image${i}`, blob, files[i].name);
      });
      fd.append("identity_id", String(identityId));
      fd.append("scene_id", String(sceneId));
      fd.append("template_id", String(templateId));
      if (photographyId) fd.append("photography_id", String(photographyId));
      if (realismId) fd.append("realism_id", String(realismId));
      fd.append(
        "pose_ids",
        JSON.stringify(Array.from(selectedPoseIds)),
      );
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

      const res = await fetch("/api/batch-photo", {
        method: "POST",
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setResults(body.results as BatchResult[]);
      setElapsed(Date.now() - startedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // ==== Render ====
  return (
    <main className="max-w-6xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">批量摄影图</h1>
        <p className="mt-1 text-sm text-gray-500">
          产品图 → 自动解析款式 → 匹配材质 → 选模特/场景/姿势 → 批量生成模特摄影图
        </p>
      </header>

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6 space-y-6">
        {/* === Step 1: 产品图 === */}
        <StepBlock step={1} title="上传产品图（1-3 张，正面 / 背面 / 细节）">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => onPickFiles(e.target.files)}
            className="block w-full text-sm text-gray-600
              file:mr-4 file:py-2 file:px-4
              file:rounded-md file:border-0
              file:text-sm file:font-medium
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100"
          />
          {files.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={URL.createObjectURL(f)}
                    alt={`产品 ${i + 1}`}
                    className="w-24 h-24 object-cover rounded-md border border-gray-200"
                  />
                  <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1.5 rounded">
                    #{i + 1}
                  </div>
                </div>
              ))}
            </div>
          )}
          {analyzing && (
            <div className="mt-2 flex items-center gap-2 text-xs text-blue-600">
              <span className="inline-block w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              正在解析款式...
            </div>
          )}
        </StepBlock>

        {/* === Step 2: 解析结果 + 材质 === */}
        {garmentAttrs && (
          <StepBlock step={2} title="款式解析 + 服装材质">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
              {Object.entries(garmentAttrs)
                .filter(([k]) => !k.startsWith("_"))
                .map(([key, value]) => (
                  <div
                    key={key}
                    className="p-2 bg-gray-50 border border-gray-200 rounded"
                  >
                    <div className="text-gray-500">{key}</div>
                    <div className="text-gray-900 mt-0.5">
                      {Array.isArray(value) ? value.join("、") : String(value)}
                    </div>
                  </div>
                ))}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
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
          </StepBlock>
        )}

        {/* === Step 3: 模特形象 === */}
        <StepBlock step={3} title="选择模特形象">
          {identities.length === 0 ? (
            <EmptyHint href="/admin/models" label="去添加模特形象（需 PNG 透明底）" />
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-2">
              {identities.map((m) => {
                const active = identityId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setIdentityId(m.id)}
                    className={`text-left border rounded-md overflow-hidden transition ${
                      active
                        ? "border-blue-500 ring-2 ring-blue-500"
                        : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    <div className="aspect-square bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2220%22 height=%2220%22><rect width=%2210%22 height=%2210%22 fill=%22%23eee%22/><rect x=%2210%22 y=%2210%22 width=%2210%22 height=%2210%22 fill=%22%23eee%22/></svg>')]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.image_url}
                        alt={m.name}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div className="p-1.5 text-xs text-gray-700 truncate">
                      {m.name}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </StepBlock>

        {/* === Step 4: 场景 === */}
        <StepBlock step={4} title="选择场景">
          {scenes.length === 0 ? (
            <EmptyHint href="/admin/scenes" label="去添加场景" />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {scenes.map((s) => {
                const active = sceneId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSceneId(s.id)}
                    className={`text-left border rounded-md overflow-hidden transition ${
                      active
                        ? "border-blue-500 ring-2 ring-blue-500"
                        : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    <div className="aspect-video bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.image_url}
                        alt={s.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-1.5 text-xs text-gray-700 truncate">
                      {s.name}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </StepBlock>

        {/* === Step 5: 姿势（多选） === */}
        <StepBlock
          step={5}
          title={`选择姿势（已选 ${selectedPoseIds.size}，将生成 ${selectedPoseIds.size} 张图）`}
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

        {/* === Step 6: 风格组（Prompt 模板 + 摄影 + 真实感） === */}
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

        {/* === Step 7: 输出配置 === */}
        <StepBlock step={7} title="输出配置">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-gray-500 mb-1">生成模型</div>
              <div className="grid gap-1">
                {aiModels.map((m) => {
                  const active = modelId === m.model_id;
                  return (
                    <button
                      key={m.model_id}
                      type="button"
                      onClick={() => setModelId(m.model_id)}
                      className={`text-left p-2 rounded-md border text-xs transition ${
                        active
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-300 hover:border-gray-400"
                      }`}
                    >
                      <div className="font-medium text-gray-900">
                        {m.label}
                        {m.badge && (
                          <span className="ml-1 text-[10px] px-1 rounded bg-blue-600 text-white">
                            {m.badge}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">比例</div>
              <div className="flex flex-wrap gap-1">
                {ASPECT_RATIOS.map((r) => {
                  const active = aspectRatio === r.value;
                  return (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setAspectRatio(r.value)}
                      className={`px-2.5 py-1 rounded-md border text-xs ${
                        active
                          ? "border-blue-500 bg-blue-50 text-blue-800"
                          : "border-gray-300"
                      }`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">清晰度</div>
              <div className="grid gap-1">
                {QUALITY_LEVELS.map((q) => {
                  const active = qualityLevel === q.value;
                  return (
                    <button
                      key={q.value}
                      type="button"
                      onClick={() => setQualityLevel(q.value)}
                      className={`text-left p-2 rounded-md border text-xs ${
                        active
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-300 hover:border-gray-400"
                      }`}
                    >
                      <div className="font-medium text-gray-900">{q.label}</div>
                      <div className="text-gray-500">{q.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </StepBlock>

        {/* === Step 8: 额外指令 === */}
        <StepBlock step={8} title="额外指令（可选）">
          <textarea
            value={userSeed}
            onChange={(e) => setUserSeed(e.target.value)}
            rows={2}
            placeholder="如：'强化温馨感'、'保留原图腰带'、'头发微风吹动'..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </StepBlock>

        {/* === Submit === */}
        <div className="border-t border-gray-200 pt-4">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit()}
            className="inline-flex items-center px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <span className="inline-block w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                生成中（每张 Flash 约 15-30 秒 / Pro 约 2-3 分钟）...
              </>
            ) : (
              `开始生成 · 共 ${selectedPoseIds.size} 张`
            )}
          </button>
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
              <div className="font-medium mb-1">失败</div>
              <div className="text-xs whitespace-pre-wrap break-all">
                {error}
              </div>
            </div>
          )}
        </div>
      </section>

      {results && <ResultsView results={results} elapsed={elapsed} />}
    </main>
  );
}

// ============ Sub components ============

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

function ResultsView({
  results,
  elapsed,
}: {
  results: BatchResult[];
  elapsed: number | null;
}) {
  const successCount = results.filter((r) => r.success).length;
  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">生成结果</h2>
        {elapsed !== null && (
          <span className="text-xs text-gray-500">
            总耗时 {(elapsed / 1000).toFixed(1)}s · 成功 {successCount}/
            {results.length}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {results.map((r, i) => (
          <div
            key={i}
            className="border border-gray-200 rounded-md overflow-hidden"
          >
            <div className="aspect-[3/4] bg-gray-100 flex items-center justify-center">
              {r.success && r.image_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={r.image_url}
                  alt={r.pose_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-xs text-red-600 p-4 text-center">
                  失败：{r.error || "未知错误"}
                </div>
              )}
            </div>
            <div className="p-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-900 truncate">{r.pose_name}</span>
                {r.success && r.image_url && (
                  <a
                    href={r.image_url}
                    download={`batch_${r.pose_name}.png`}
                    className="text-blue-600 hover:underline shrink-0 ml-2"
                  >
                    下载
                  </a>
                )}
              </div>
              {r.duration_ms && (
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {(r.duration_ms / 1000).toFixed(1)}s
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
