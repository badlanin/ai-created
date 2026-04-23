"use client";

import { useEffect, useState } from "react";

type Color = { id: number; name: string; hex: string };
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

type RecolorResult = {
  color_id: number;
  color_name: string;
  hex: string;
  image_index: number;
  image_label: string;
  success: boolean;
  image_url?: string;
  error?: string;
};

/**
 * 客户端压缩：长边 2048，JPEG 质量 0.95（比之前更好的保留）
 * 比例选 3:4 / 2:3 等时，原图会保持原比例，模型会按目标比例输出
 */
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
      // 高质量缩放
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

const ASPECT_RATIOS = [
  { value: "3:4", label: "3:4 竖（推荐）" },
  { value: "2:3", label: "2:3 竖" },
  { value: "4:5", label: "4:5 竖" },
  { value: "1:1", label: "1:1 方" },
  { value: "4:3", label: "4:3 横" },
  { value: "16:9", label: "16:9 横" },
] as const;

export default function RecolorPage() {
  // Step 1: Images (多图)
  const [files, setFiles] = useState<File[]>([]);
  const [compressedBlobs, setCompressedBlobs] = useState<Blob[]>([]);

  // Step 2: Analysis（只对第一张做解析，节省成本和时间）
  const [analyzing, setAnalyzing] = useState(false);
  const [garmentAttrs, setGarmentAttrs] = useState<GarmentAttrs | null>(null);

  // 输出比例
  const [aspectRatio, setAspectRatio] = useState<string>("3:4");

  // Step 3: Materials
  const [allMaterials, setAllMaterials] = useState<Material[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<number[]>([]);
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);

  // Step 4: Realism
  const [realisms, setRealisms] = useState<Realism[]>([]);
  const [realismId, setRealismId] = useState<number | null>(null);

  // Step 5: Colors
  const [colors, setColors] = useState<Color[]>([]);
  const [selectedColorIds, setSelectedColorIds] = useState<Set<number>>(
    new Set(),
  );
  const [customName, setCustomName] = useState("");
  const [customHex, setCustomHex] = useState("#722F37");

  // Step 6: Model
  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  const [model, setModel] = useState<string>("");

  // Step 7: Seed
  const [userSeed, setUserSeed] = useState("");

  // Submission state
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RecolorResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  // 初始化加载：colors / models / materials / realism
  useEffect(() => {
    fetch("/api/colors")
      .then((r) => (r.ok ? r.json() : []))
      .then(setColors)
      .catch(() => setColors([]));

    fetch("/api/ai-models?category=image_gen")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: AiModel[]) => {
        setAiModels(list);
        const def =
          list.find((m) => m.is_default === 1)?.model_id || list[0]?.model_id;
        if (def) setModel(def);
      })
      .catch(() => setAiModels([]));

    fetch("/api/materials")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAllMaterials)
      .catch(() => setAllMaterials([]));

    fetch("/api/realism")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Realism[]) => {
        setRealisms(list);
        const def = list.find((r) => r.is_default === 1)?.id || list[0]?.id;
        if (def) setRealismId(def);
      })
      .catch(() => setRealisms([]));
  }, []);

  // 文件选中后：压缩所有 + 对第一张触发解析
  async function onPickFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      setFiles([]);
      setCompressedBlobs([]);
      setGarmentAttrs(null);
      setSelectedMaterialIds([]);
      setResults(null);
      setError(null);
      return;
    }

    const picked = Array.from(fileList).slice(0, 5); // 最多 5 张
    setFiles(picked);
    setCompressedBlobs([]);
    setGarmentAttrs(null);
    setSelectedMaterialIds([]);
    setResults(null);
    setError(null);

    try {
      const blobs = await Promise.all(picked.map((f) => resizeImage(f, 2048)));
      setCompressedBlobs(blobs);
      // 只对第一张做解析（同款不同角度，解析一次即可代表）
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
      if (!res.ok) {
        throw new Error((await res.json()).error || res.statusText);
      }
      const attrs = (await res.json()) as GarmentAttrs;
      setGarmentAttrs(attrs);

      // 自动匹配材质
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

  async function handleSubmit() {
    if (compressedBlobs.length === 0 || files.length === 0) {
      setError("请先上传产品图");
      return;
    }
    const useCustom = customName.trim().length > 0;
    const colorCount = selectedColorIds.size + (useCustom ? 1 : 0);
    if (colorCount === 0) {
      setError("请至少选择一个颜色，或填一个临时颜色");
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);
    setElapsed(null);
    const startedAt = Date.now();

    try {
      const formData = new FormData();
      // 多图：image0, image1, ...
      compressedBlobs.forEach((blob, i) => {
        formData.append(`image${i}`, blob, files[i].name);
      });
      if (selectedColorIds.size > 0) {
        formData.append("color_ids", JSON.stringify([...selectedColorIds]));
      }
      if (useCustom) {
        formData.append(
          "custom_colors",
          JSON.stringify([{ name: customName.trim(), hex: customHex }]),
        );
      }
      formData.append("model", model);
      if (aspectRatio) formData.append("aspect_ratio", aspectRatio);
      if (selectedMaterialIds.length > 0) {
        formData.append("material_ids", JSON.stringify(selectedMaterialIds));
      }
      if (realismId) {
        formData.append("realism_id", String(realismId));
      }
      if (garmentAttrs) {
        formData.append("garment_attrs", JSON.stringify(garmentAttrs));
      }
      if (userSeed.trim()) {
        formData.append("user_seed", userSeed.trim());
      }

      const res = await fetch("/api/recolor", {
        method: "POST",
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setResults(body.results as RecolorResult[]);
      setElapsed(Date.now() - startedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  /** 总任务数 = 图数 × 颜色数 */
  const totalCount = (() => {
    const useCustom = customName.trim().length > 0;
    const colors = selectedColorIds.size + (useCustom ? 1 : 0);
    return files.length * colors;
  })();

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">HEX 精准换色</h1>
        <p className="mt-1 text-sm text-gray-500">
          上传 → 自动解析款式 + 识别材质 → 选颜色批量生成
        </p>
      </header>

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        {/* Step 1: 上传（支持多图） */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            1. 上传产品图
            <span className="ml-2 text-xs text-gray-500 font-normal">
              可一次选多张同款不同角度（最多 5 张，有助于色差一致性）
            </span>
          </label>
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
            <div className="mt-3">
              <div className="flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={URL.createObjectURL(f)}
                      alt={`原图 ${i + 1}`}
                      className="w-28 h-28 object-cover rounded-md border border-gray-200"
                    />
                    <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1.5 rounded">
                      #{i + 1}
                    </div>
                    <div className="mt-1 text-[10px] text-gray-500 truncate w-28">
                      {f.name}
                    </div>
                  </div>
                ))}
              </div>
              {analyzing && (
                <div className="mt-2 flex items-center gap-2 text-xs text-blue-600">
                  <span className="inline-block w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  正在对第 1 张做款式解析（同款只需解析一次）...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Step 2: 款式解析结果 */}
        {garmentAttrs && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              2. 款式解析结果
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              {Object.entries(garmentAttrs)
                .filter(([key]) => !key.startsWith("_"))
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
          </div>
        )}

        {/* Step 3: 材质（自动匹配 + 可编辑） */}
        {(garmentAttrs || selectedMaterials.length > 0) && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              3. 服装材质
              <span className="ml-2 text-xs text-gray-500 font-normal">
                （系统自动匹配，如不准可手动增删）
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
                    title="移除"
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
                ⚠ 未匹配到任何材质。换色时 AI 可能误判面料质感，建议手动添加至少一个材质
              </p>
            )}
          </div>
        )}

        {/* Step 4: 真实感 */}
        {realisms.length > 0 && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              4. 真实感预设
              <span className="ml-2 text-xs text-gray-500 font-normal">
                （控制皮肤/发丝的真实度，避免 AI 塑料感）
              </span>
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

        {/* Step 5: 生成模型 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            5. 选择生成模型
          </label>
          {aiModels.length === 0 ? (
            <div className="text-xs text-gray-500 p-3 bg-gray-50 rounded border border-dashed border-gray-300">
              暂无可用模型，请让管理员在
              <a href="/admin/ai-models" className="text-blue-600 underline">
                AI 模型管理
              </a>
              中启用至少一个
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {aiModels.map((m) => {
                const active = model === m.model_id;
                return (
                  <button
                    key={m.model_id}
                    type="button"
                    onClick={() => setModel(m.model_id)}
                    className={`text-left p-3 rounded-md border transition ${
                      active
                        ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                        : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {m.label}
                      </span>
                      {m.badge && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600 text-white">
                          {m.badge}
                        </span>
                      )}
                    </div>
                    {m.description && (
                      <div className="text-xs text-gray-500 mt-1">
                        {m.description}
                      </div>
                    )}
                    <div className="text-[10px] text-gray-400 font-mono mt-1">
                      {m.model_id}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Step 6: 颜色 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            6. 选择目标颜色（可多选）
          </label>
          {colors.length === 0 ? (
            <div className="text-xs text-gray-500 p-3 bg-gray-50 rounded border border-dashed border-gray-300">
              颜色库还是空的，
              <a href="/admin/colors" className="text-blue-600 underline">
                去添加
              </a>
              ，或者使用下面的「临时颜色」
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {colors.map((c) => {
                const active = selectedColorIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleColor(c.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition ${
                      active
                        ? "border-blue-500 bg-blue-50 text-blue-800"
                        : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-gray-300 shrink-0"
                      style={{ backgroundColor: c.hex }}
                    />
                    <span>{c.name}</span>
                    <span className="text-xs text-gray-500 font-mono">
                      {c.hex}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex items-end gap-3 p-3 bg-gray-50 rounded border border-gray-200">
            <div className="flex-1">
              <label className="block text-xs text-gray-600 mb-1">
                临时颜色名（选填，不保存到库里）
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="如：酒红"
                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">HEX</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={customHex}
                  onChange={(e) => setCustomHex(e.target.value.toUpperCase())}
                  className="w-8 h-8 border border-gray-300 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={customHex}
                  onChange={(e) => setCustomHex(e.target.value.toUpperCase())}
                  className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Step 7: 输出比例 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            7. 输出比例
            <span className="ml-2 text-xs text-gray-500 font-normal">
              （伴娘服推荐 3:4 竖。原图不会被裁剪，模型按此比例输出新图）
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            {ASPECT_RATIOS.map((r) => {
              const active = aspectRatio === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setAspectRatio(r.value)}
                  className={`px-3 py-1.5 rounded-md border text-sm transition ${
                    active
                      ? "border-blue-500 bg-blue-50 text-blue-800"
                      : "border-gray-300 hover:border-gray-400"
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            注：Nano Banana 原生输出约 1024-2048 分辨率（非真 4K），需要 4K 级可再接 upscale 工具处理
          </p>
        </div>

        {/* Step 8: 自定义指令（可选） */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            8. 额外指令（可选）
          </label>
          <textarea
            value={userSeed}
            onChange={(e) => setUserSeed(e.target.value)}
            rows={2}
            placeholder="想让模型特别注意的地方，如：'背景保持纯白'、'强化下摆的飘逸感' 等"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || files.length === 0 || analyzing || totalCount === 0}
          className="inline-flex items-center px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <span className="inline-block w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
              生成中（每张 Flash 约 10-20 秒 / Pro 约 2-3 分钟）...
            </>
          ) : (
            `开始换色 · 共 ${totalCount} 张 (${files.length} 图 × ${
              selectedColorIds.size + (customName.trim() ? 1 : 0)
            } 色)`
          )}
        </button>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
            <div className="font-medium mb-1">失败</div>
            <div className="text-xs whitespace-pre-wrap break-all">{error}</div>
          </div>
        )}
      </section>

      {results && <ResultsView results={results} elapsed={elapsed} />}
    </main>
  );
}

function ResultsView({
  results,
  elapsed,
}: {
  results: RecolorResult[];
  elapsed: number | null;
}) {
  // 按颜色分组展示，每组内按图片 index 排序
  const groups = new Map<
    number,
    { color_name: string; hex: string; items: RecolorResult[] }
  >();
  for (const r of results) {
    if (!groups.has(r.color_id)) {
      groups.set(r.color_id, {
        color_name: r.color_name,
        hex: r.hex,
        items: [],
      });
    }
    groups.get(r.color_id)!.items.push(r);
  }
  for (const g of groups.values()) {
    g.items.sort((a, b) => a.image_index - b.image_index);
  }

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">生成结果</h2>
        {elapsed !== null && (
          <span className="text-xs text-gray-500">
            总耗时 {(elapsed / 1000).toFixed(1)}s · 共 {results.length} 张
          </span>
        )}
      </div>

      <div className="space-y-6">
        {Array.from(groups.values()).map((g) => (
          <div key={g.color_name} className="border-t border-gray-200 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <span
                className="w-5 h-5 rounded border border-gray-300"
                style={{ backgroundColor: g.hex }}
              />
              <span className="text-sm font-semibold text-gray-900">
                {g.color_name}
              </span>
              <span className="text-xs text-gray-500 font-mono">{g.hex}</span>
              <span className="text-xs text-gray-400">
                · {g.items.length} 张
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {g.items.map((r, i) => (
                <div
                  key={i}
                  className="border border-gray-200 rounded-md overflow-hidden"
                >
                  <div className="aspect-[3/4] bg-gray-100 flex items-center justify-center">
                    {r.success && r.image_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={r.image_url}
                        alt={r.image_label}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-xs text-red-600 p-4 text-center">
                        失败：{r.error || "未知错误"}
                      </div>
                    )}
                  </div>
                  <div className="p-2 flex items-center justify-between text-xs">
                    <span className="text-gray-500 truncate">
                      #{r.image_index + 1} {r.image_label}
                    </span>
                    {r.success && r.image_url && (
                      <a
                        href={r.image_url}
                        download={`recolor_${g.color_name}_${r.image_index + 1}.png`}
                        className="text-blue-600 hover:underline shrink-0 ml-2"
                      >
                        下载
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
