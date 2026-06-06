import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { DATA_DIR_PATH, getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { generateImage, estimateImageCostUSD } from "@/lib/image-gen";
import { resolveModelId } from "@/lib/ai-models";
import { recordUsage } from "@/lib/usage";
import { assertWithinBudget, getUserBudgetStatus } from "@/lib/pricing";
import { createJob } from "@/lib/jobs-db";
import { startJobWorker, type HandlerContext } from "@/lib/job-runner";
import { retryWithBackoff } from "@/lib/retry";
import {
  buildSceneShootText,
  buildSceneShootTextWithImage,
  buildSceneShootImage,
} from "@/lib/scene-prompt";
import {
  CLOSEUP_PRESETS,
  isBackCloseupKey,
  type CloseupKey,
  type FocusMode,
  type PoseMode,
} from "@/lib/scene-tools-prompt";
import {
  formatMaterialDetails,
  getMaterialsByIds,
} from "@/lib/materials";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_RATIOS = [
  "1:1",
  "3:2",
  "2:3",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
];

function assetUrlToDataRelPath(url?: string | null): string | null {
  const raw = String(url || "").trim();
  if (!raw.startsWith("/assets/")) return null;
  try {
    const cleanPath = decodeURIComponent(
      raw.split("?")[0].slice("/assets/".length),
    );
    const absPath = path.resolve(DATA_DIR_PATH, cleanPath);
    const dataRoot = path.resolve(DATA_DIR_PATH);
    if (!absPath.startsWith(dataRoot + path.sep)) return null;
    return cleanPath;
  } catch {
    return null;
  }
}

/**
 * POST /api/scene-tools
 *
 * 服饰场景图（统一工具）v5 — 加焦点开关 + 特写镜头 + 材质词库。
 *
 *   单场景输出 = count（常规变体）+ closeup_presets.length（特写多选）
 *   总输出 = N 产品图 × Σ(scene_i 单场景输出)
 *
 * formData:
 *   - product_image_<i>: File（i = 0..N-1，N 张产品图）
 *   - scenes: JSON Array<{
 *        type: 'text' | 'image',
 *        text?: string, scene_id?: number,
 *        count: number,                     // 常规变体张数 0-5
 *        closeup_presets: CloseupKey[]      // 特写多选（back / side_waist / ...）
 *     }>
 *   - aspect_ratio: '3:4' | '9:16' | '1:1' | ...
 *   - image_size: '1K' | '2K' | '4K'
 *   - focus_mode: 'model_first' | 'balanced' | 'environmental'
 *   - material_ids: JSON Array<number>     // 材质词库 ID 列表（autoMatch 后传过来）
 *   - user_hint?: string（≤ 200 字）
 *   - model?: string
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    assertWithinBudget(user.id, user.role);
    const db = getDb();

    const formData = await req.formData();

    // ─── 收集产品图 + 背部参考图 ───
    // 产品图按 product_image_<i> 收集（i 从 0 起）
    // 背部参考图按 back_reference_image_<i> 收集（i 对应产品 idx，可选）
    const productFiles: File[] = [];
    const backRefFiles: Map<number, File> = new Map(); // product_idx -> back ref file
    for (const [key, value] of formData.entries()) {
      const productMatch = key.match(/^product_image_?(\d+)$/);
      if (productMatch && value instanceof File) {
        const idx = Number(productMatch[1]);
        productFiles[idx] = value;
        continue;
      }
      const backMatch = key.match(/^back_reference_image_?(\d+)$/);
      if (backMatch && value instanceof File) {
        const idx = Number(backMatch[1]);
        if (value.size > 20 * 1024 * 1024) {
          return NextResponse.json(
            { error: `背部参考图 ${value.name} 太大（限 20MB）` },
            { status: 400 },
          );
        }
        backRefFiles.set(idx, value);
        continue;
      }
    }
    // 去掉 productFiles 数组里的稀疏 hole（用户上传顺序不连续时）
    const compactProductFiles = productFiles.filter((f) => f instanceof File);
    if (compactProductFiles.length === 0) {
      return NextResponse.json(
        { error: "请上传至少一张产品图" },
        { status: 400 },
      );
    }
    if (compactProductFiles.length > 30) {
      return NextResponse.json(
        { error: "产品图最多 30 张（防止误操作出图爆量）" },
        { status: 400 },
      );
    }
    for (const f of compactProductFiles) {
      if (f.size > 20 * 1024 * 1024) {
        return NextResponse.json(
          { error: `产品图 ${f.name} 太大（限 20MB）` },
          { status: 400 },
        );
      }
    }
    // 用 compact 后的数组替换
    productFiles.length = 0;
    productFiles.push(...compactProductFiles);

    // ─── 解析 scenes 数组 ───
    // 每个 scene 包含：
    //   - count       : 常规变体张数（1-5）
    //   - closeup_presets: 特写镜头多选（5 个 key 的子集）
    //
    // 单个场景输出 = count + closeup_presets.length，最大 10
    const scenesRaw = formData.get("scenes");
    const VALID_CLOSEUP_KEYS = new Set<string>(
      CLOSEUP_PRESETS.map((p) => p.key),
    );
    type SceneEntry =
      | {
          type: "text";
          text: string;
          scene_id?: number | null;
          scene_name?: string | null;
          scene_thumb?: string | null;
          count: number;
          closeup_presets: CloseupKey[];
        }
      | {
          type: "image";
          scene_id: number;
          count: number;
          closeup_presets: CloseupKey[];
        };
    let scenes: SceneEntry[];
    try {
      const parsed = JSON.parse(String(scenesRaw || "[]"));
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("scenes 为空");
      }
      scenes = parsed
        .map((s: unknown): SceneEntry | null => {
          if (typeof s !== "object" || s === null) return null;
          const obj = s as Record<string, unknown>;
          const rawCount = Number(obj.count);
          const count =
            Number.isFinite(rawCount) && rawCount >= 0
              ? Math.min(5, Math.floor(rawCount))
              : 1;
          // 特写预设多选（最多 5 个，去重）
          let closeup_presets: CloseupKey[] = [];
          if (Array.isArray(obj.closeup_presets)) {
            const seen = new Set<string>();
            for (const k of obj.closeup_presets) {
              if (typeof k !== "string") continue;
              if (!VALID_CLOSEUP_KEYS.has(k)) continue;
              if (seen.has(k)) continue;
              seen.add(k);
              closeup_presets.push(k as CloseupKey);
            }
          }
          const totalForScene = count + closeup_presets.length;
          if (totalForScene <= 0) return null; // 全部为 0 视为空场景
          if (totalForScene > 10) {
            throw new Error("单场景输出最多 10 张（常规 + 特写之和）");
          }
          if (obj.type === "text" && typeof obj.text === "string") {
            const text = obj.text.trim();
            if (text.length === 0) return null;
            if (text.length > 500) {
              throw new Error("文字场景描述太长（限 500 字）");
            }
            const rawSceneId = Number(obj.scene_id);
            return {
              type: "text",
              text,
              scene_id:
                Number.isFinite(rawSceneId) && rawSceneId > 0
                  ? rawSceneId
                  : null,
              scene_name:
                typeof obj.scene_name === "string" ? obj.scene_name : null,
              scene_thumb:
                typeof obj.scene_thumb === "string" ? obj.scene_thumb : null,
              count,
              closeup_presets,
            };
          }
          if (obj.type === "image" && Number.isFinite(obj.scene_id)) {
            return {
              type: "image",
              scene_id: Number(obj.scene_id),
              count,
              closeup_presets,
            };
          }
          return null;
        })
        .filter((s: SceneEntry | null): s is SceneEntry => s !== null);
      if (scenes.length === 0) {
        throw new Error("scenes 解析后为空");
      }
      if (scenes.length > 30) {
        throw new Error("场景最多 30 个（防止误操作出图爆量）");
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "scenes 不合法" },
        { status: 400 },
      );
    }

    // ─── focus_mode ───
    const focusModeRaw = formData.get("focus_mode");
    const focusMode: FocusMode =
      focusModeRaw === "balanced" || focusModeRaw === "environmental"
        ? (focusModeRaw as FocusMode)
        : "model_first";

    // ─── pose_mode（v7：杂志大片 / 场景互动） ───
    const poseModeRaw = formData.get("pose_mode");
    const poseMode: PoseMode =
      poseModeRaw === "interactive" ? "interactive" : "editorial";

    // ─── material_ids（材质词库，跟 batch-photo 一样的接入方式） ───
    let materialIds: number[] = [];
    const materialIdsRaw = formData.get("material_ids");
    if (typeof materialIdsRaw === "string" && materialIdsRaw.trim()) {
      try {
        const parsedIds = JSON.parse(materialIdsRaw);
        if (Array.isArray(parsedIds)) {
          materialIds = parsedIds
            .map((x) => Number(x))
            .filter((x) => Number.isFinite(x) && x > 0)
            .slice(0, 20);
        }
      } catch {
        // 忽略，走空数组
      }
    }
    const materials =
      materialIds.length > 0 ? getMaterialsByIds(materialIds) : [];
    const materialDetailsText = materials.length
      ? formatMaterialDetails(materials)
      : undefined;

    // ─── 加载图片场景的元信息 ───
    type ImageSceneMeta = { id: number; name: string; image_path: string };
    const imageScenes: Map<number, ImageSceneMeta> = new Map();
    const imageSceneIds = Array.from(
      new Set(
        scenes
          .map((s) => ("scene_id" in s ? s.scene_id : null))
          .filter(
            (id): id is number =>
              typeof id === "number" && Number.isFinite(id),
          ),
      ),
    );
    if (imageSceneIds.length > 0) {
      const ph = imageSceneIds.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT id, name, image_path FROM scenes WHERE id IN (${ph})`,
        )
        .all(...imageSceneIds) as Array<ImageSceneMeta>;
      if (rows.length !== new Set(imageSceneIds).size) {
        return NextResponse.json(
          { error: "部分图片场景不存在" },
          { status: 404 },
        );
      }
      for (const r of rows) imageScenes.set(r.id, r);
    }

    // ─── 比例 ───
    const arRaw = formData.get("aspect_ratio");
    const aspectRatio =
      typeof arRaw === "string" && ALLOWED_RATIOS.includes(arRaw) ? arRaw : "3:4";

    // ─── user_hint ───
    const hintRaw = formData.get("user_hint");
    let userHint: string | undefined;
    if (typeof hintRaw === "string") {
      const t = hintRaw.trim();
      if (t.length > 0) {
        if (t.length > 200) {
          return NextResponse.json(
            { error: "user_hint 太长（限 200 字）" },
            { status: 400 },
          );
        }
        userHint = t;
      }
    }

    // ─── 模型 + 画质 ───
    const modelRaw = formData.get("model");
    const model = resolveModelId(
      "image_gen",
      typeof modelRaw === "string" ? modelRaw : undefined,
    );
    // 画质：'1K' | '2K' | '4K'，默认 1K（最便宜）
    // Gemini 用 imageSize（'1K' | '2K' | '4K'）
    // OpenAI 用 quality（low / medium / high）+ size（具体像素）—— image-gen dispatcher 会自动映射
    const qualityRaw = formData.get("image_size");
    const imageSize: "1K" | "2K" | "4K" =
      qualityRaw === "1K" || qualityRaw === "2K" || qualityRaw === "4K"
        ? qualityRaw
        : "1K";

    // ─── 构造 items：N 产品 × 每个场景按 (常规变体 + 特写多选) 展开 ───
    // 每个场景产出 = count 张常规 + closeup_presets.length 张特写
    // 单个 item 的 kind 区分 "regular" vs "closeup"
    const N = productFiles.length;
    const M = scenes.length;
    type ItemMeta = {
      product_idx: number;
      scene_idx: number;
      kind: "regular" | "closeup";
      // regular 时：第几张/总数（用于 variant 镜头预设循环）
      variant_idx?: number;
      variant_total?: number;
      // closeup 时：对应预设 key
      closeup_key?: CloseupKey;
      // 同场景在该次提交里总共出几张图（常规 + 特写之和），用于"背景一致性"约束
      scene_total_items: number;
      label: string;
    };
    const items: ItemMeta[] = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        const sceneEntry = scenes[j];
        const sceneLabel =
          sceneEntry.type === "image"
            ? imageScenes.get(sceneEntry.scene_id)?.name || `场景#${sceneEntry.scene_id}`
            : sceneEntry.text.slice(0, 14) +
              (sceneEntry.text.length > 14 ? "…" : "");
        const regularTotal = sceneEntry.count;
        const closeupTotal = sceneEntry.closeup_presets.length;
        const sceneTotal = regularTotal + closeupTotal;
        // 常规变体
        for (let v = 1; v <= regularTotal; v++) {
          items.push({
            product_idx: i,
            scene_idx: j,
            kind: "regular",
            variant_idx: v,
            variant_total: regularTotal,
            scene_total_items: sceneTotal,
            label:
              regularTotal > 1
                ? `产品 ${i + 1} · ${sceneLabel} · 变体 ${v}/${regularTotal}`
                : `产品 ${i + 1} · ${sceneLabel}`,
          });
        }
        // 特写镜头
        for (const closeupKey of sceneEntry.closeup_presets) {
          const presetLabel =
            CLOSEUP_PRESETS.find((p) => p.key === closeupKey)?.label ||
            String(closeupKey);
          items.push({
            product_idx: i,
            scene_idx: j,
            kind: "closeup",
            closeup_key: closeupKey,
            scene_total_items: sceneTotal,
            label: `产品 ${i + 1} · ${sceneLabel} · ${presetLabel}`,
          });
        }
      }
    }

    // ─── 创建 job ───
    const job = createJob({
      user_id: user.id,
      feature: "scene_tools",
      model,
      items: items.map((it) => ({ label: it.label })),
      params: {
        aspect_ratio: aspectRatio,
        image_size: imageSize,
        user_hint: userHint || null,
        focus_mode: focusMode,
        pose_mode: poseMode,
        material_ids: materialIds,
        material_details_text: materialDetailsText || null,
        product_count: N,
        scene_count: M,
        scenes: scenes.map((s) => {
          if (s.type === "image") {
            const meta = imageScenes.get(s.scene_id);
            return {
              type: "image" as const,
              scene_id: s.scene_id,
              scene_name: meta?.name,
              scene_image_path: meta?.image_path,
              count: s.count,
              closeup_presets: s.closeup_presets,
            };
          }
          return {
            type: "text" as const,
            text: s.text,
            scene_id: s.scene_id ?? null,
            scene_name: s.scene_id ? imageScenes.get(s.scene_id)?.name : null,
            scene_image_path: s.scene_id
              ? imageScenes.get(s.scene_id)?.image_path
              : assetUrlToDataRelPath(s.scene_thumb),
            scene_thumb: s.scene_thumb ?? null,
            count: s.count,
            closeup_presets: s.closeup_presets,
          };
        }),
        items, // [{product_idx, scene_idx, kind, variant_idx?, closeup_key?, ...}]
      },
    });

    // ─── 落盘产品图 + 背部参考图到 job 输入目录 ───
    const inputsDir = path.join(DATA_DIR_PATH, "job-inputs", job.id);
    await fs.mkdir(inputsDir, { recursive: true });
    const productPaths: string[] = [];
    const productMimes: string[] = [];
    for (let i = 0; i < productFiles.length; i++) {
      const f = productFiles[i];
      const ext =
        f.type === "image/png"
          ? "png"
          : f.type === "image/webp"
            ? "webp"
            : "jpg";
      const filename = `product_${i}.${ext}`;
      const abs = path.join(inputsDir, filename);
      await fs.writeFile(abs, Buffer.from(await f.arrayBuffer()));
      productPaths.push(abs);
      productMimes.push(f.type || "image/jpeg");
    }
    // 背部参考图（可选，跟产品 idx 对齐，缺失则为 null）
    const backRefPaths: Array<string | null> = [];
    const backRefMimes: Array<string | null> = [];
    for (let i = 0; i < productFiles.length; i++) {
      const f = backRefFiles.get(i);
      if (!f) {
        backRefPaths.push(null);
        backRefMimes.push(null);
        continue;
      }
      const ext =
        f.type === "image/png"
          ? "png"
          : f.type === "image/webp"
            ? "webp"
            : "jpg";
      const filename = `back_${i}.${ext}`;
      const abs = path.join(inputsDir, filename);
      await fs.writeFile(abs, Buffer.from(await f.arrayBuffer()));
      backRefPaths.push(abs);
      backRefMimes.push(f.type || "image/jpeg");
    }
    // 把 product_paths / back_ref_paths 补进 params
    const existingParams = (() => {
      try {
        return JSON.parse(job.params || "{}") as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    db.prepare(`UPDATE render_jobs SET params = ? WHERE id = ?`).run(
      JSON.stringify({
        ...existingParams,
        product_paths: productPaths,
        product_mime_types: productMimes,
        back_ref_paths: backRefPaths,
        back_ref_mime_types: backRefMimes,
      }),
      job.id,
    );

    const outputsDir = path.join(DATA_DIR_PATH, "outputs");
    await fs.mkdir(outputsDir, { recursive: true });

    // ─── 启动后台 worker ───
    startJobWorker(
      job.id,
      async (ctx: HandlerContext) => {
        return sceneToolsItemHandler(ctx, outputsDir);
      },
      {
        onJobEnd: async () => {
          try {
            await fs.rm(inputsDir, { recursive: true, force: true });
          } catch {}
        },
      },
    );

    return NextResponse.json({
      job_id: job.id,
      total_count: job.total_count,
      product_count: N,
      scene_count: M,
      model,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/scene-tools] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}

/* ─────────── worker 处理单条 item ─────────── */

async function sceneToolsItemHandler(
  ctx: HandlerContext,
  outputsDir: string,
): Promise<{
  result_image_path: string;
  result_image_url: string;
  input_tokens: number | undefined;
  output_tokens: number | undefined;
  cost_cny: number | undefined;
}> {
  const p = ctx.params as {
    aspect_ratio?: string;
    image_size?: "1K" | "2K" | "4K";
    user_hint?: string | null;
    focus_mode?: FocusMode;
    pose_mode?: PoseMode;
    material_details_text?: string | null;
    product_count: number;
    scene_count: number;
    scenes: Array<
      | {
          type: "text";
          text: string;
          scene_id?: number | null;
          scene_name?: string | null;
          scene_image_path?: string | null;
          scene_thumb?: string | null;
          count?: number;
          closeup_presets?: string[];
        }
      | {
          type: "image";
          scene_id: number;
          scene_name?: string;
          scene_image_path?: string;
          count?: number;
          closeup_presets?: string[];
        }
    >;
    items: Array<{
      product_idx: number;
      scene_idx: number;
      // v3：常规变体场景的字段
      variant_idx?: number;
      variant_total?: number;
      // v5：每个 item 的"是常规还是特写"
      kind?: "regular" | "closeup";
      closeup_key?: CloseupKey;
      scene_total_items?: number;
      label: string;
    }>;
    product_paths: string[];
    product_mime_types: string[];
    // v6 新增
    back_ref_paths?: Array<string | null>;
    back_ref_mime_types?: Array<string | null>;
  };

  const itemMeta = p.items[ctx.item.idx];
  if (!itemMeta) throw new Error(`item[${ctx.item.idx}] 丢失`);

  // 兼容老 job（没 kind / variant_idx 字段，按"常规变体"处理）
  const kind: "regular" | "closeup" = itemMeta.kind ?? "regular";
  const variantIdx = itemMeta.variant_idx ?? 1;
  const variantTotal = itemMeta.variant_total ?? 1;
  const sceneTotalItems = itemMeta.scene_total_items ?? variantTotal;
  const closeupKey = itemMeta.closeup_key;
  const focusMode: FocusMode = p.focus_mode ?? "model_first";
  const poseMode: PoseMode = p.pose_mode ?? "editorial";
  const materialDetailsText = p.material_details_text || undefined;
  // v7：杂志大片随机组合的种子（job.id + variant_idx）
  const variantSeed = `${ctx.job.id}:${variantIdx}`;

  // 当前 item 是否需要背部参考图（特写 + isBack 预设 + 该产品上传过背图）
  const needsBackRef =
    kind === "closeup" && isBackCloseupKey(closeupKey);
  const backRefPath = needsBackRef
    ? p.back_ref_paths?.[itemMeta.product_idx] || null
    : null;
  const backRefMime = needsBackRef
    ? p.back_ref_mime_types?.[itemMeta.product_idx] || null
    : null;
  const hasBackReference = !!backRefPath;

  // 预算兜底
  const status = getUserBudgetStatus(ctx.userId);
  if (!status.is_unlimited && status.remaining_cny <= 0) {
    throw new Error(
      `本月预算已用完（¥${status.used_this_month_cny.toFixed(2)}），剩余任务已跳过`,
    );
  }

  // 读产品图
  const productPath = p.product_paths[itemMeta.product_idx];
  const productMime = p.product_mime_types[itemMeta.product_idx] || "image/jpeg";
  if (!productPath) throw new Error(`product[${itemMeta.product_idx}] 丢失`);
  const productBuf = await fs.readFile(productPath);
  const productInput = {
    buffer: productBuf,
    mimeType: productMime,
  };

  // 解析当前 item 的场景
  const scene = p.scenes[itemMeta.scene_idx];
  if (!scene) throw new Error(`scene[${itemMeta.scene_idx}] 丢失`);

  // 现在 prompt 自己处理 framing block（包含镜头/特写/材质），user_hint 简单透传即可
  const promptOpts = {
    focusMode,
    poseMode,
    variantSeed,
    kind,
    variantIdx,
    variantTotal,
    closeupKey,
    materialDetailsText,
    sceneTotalItems,
    hasBackReference,
  };

  let prompt: string;
  const inputs: Array<{ buffer: Buffer; mimeType: string }> = [productInput];
  if (scene.type === "text") {
    if (scene.scene_image_path) {
      const sceneAbs = path.join(DATA_DIR_PATH, scene.scene_image_path);
      const sceneBuf = await fs.readFile(sceneAbs);
      inputs.push({
        buffer: sceneBuf,
        mimeType: sceneAbs.toLowerCase().endsWith(".png")
          ? "image/png"
          : sceneAbs.toLowerCase().endsWith(".webp")
            ? "image/webp"
            : "image/jpeg",
      });
      prompt = buildSceneShootTextWithImage(
        scene.text,
        scene.scene_name || undefined,
        p.user_hint || undefined,
        promptOpts,
      );
    } else {
      prompt = buildSceneShootText(
        scene.text,
        p.user_hint || undefined,
        promptOpts,
      );
    }
  } else {
    if (!scene.scene_image_path) {
      throw new Error(`图片场景 ${scene.scene_id} 文件路径丢失`);
    }
    const sceneAbs = path.join(DATA_DIR_PATH, scene.scene_image_path);
    const sceneBuf = await fs.readFile(sceneAbs);
    inputs.push({
      buffer: sceneBuf,
      mimeType: sceneAbs.toLowerCase().endsWith(".png")
        ? "image/png"
        : sceneAbs.toLowerCase().endsWith(".webp")
          ? "image/webp"
          : "image/jpeg",
    });
    prompt = buildSceneShootImage(
      scene.scene_name,
      p.user_hint || undefined,
      promptOpts,
    );
  }
  // 背部参考图（IMAGE 3）—— 仅在需要时附上，跟产品图配对
  if (hasBackReference && backRefPath) {
    const backBuf = await fs.readFile(backRefPath);
    inputs.push({
      buffer: backBuf,
      mimeType: backRefMime || "image/jpeg",
    });
  }

  // 调出图（gemini-image / openai-image 自动分发）
  const gen = await retryWithBackoff(
    () =>
      generateImage({
        inputs,
        prompt,
        modelId: ctx.job.model,
        aspectRatio: p.aspect_ratio,
        imageSize: p.image_size || "1K",
        temperature: 0.4,
      }),
    {
      onRetry: (e, attempt, delay) => {
        console.warn(
          `[scene-tools retry] job=${ctx.job.id} item=${ctx.item.idx} attempt=${attempt} delay=${Math.round(delay)}ms: ${
            e instanceof Error ? e.message.slice(0, 100) : String(e)
          }`,
        );
      },
    },
  );

  const ext = gen.mimeType.includes("png") ? "png" : "jpg";
  const filename = `scene_${ctx.userId}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;
  const filePath = path.join(outputsDir, filename);
  await fs.writeFile(filePath, gen.data);

  // OpenAI 是固定单价（按 size×quality），不是 token 计费 —— 算好直接覆盖
  const costOverrideUsd =
    gen.provider === "openai"
      ? estimateImageCostUSD({
          modelId: ctx.job.model,
          aspectRatio: p.aspect_ratio,
          imageSize: p.image_size || "1K",
        })
      : undefined;

  const usageRecord = recordUsage({
    userId: ctx.userId,
    model: ctx.job.model,
    feature: "other",
    usageMetadata: {
      promptTokenCount: gen.usage?.inputTokens,
      candidatesTokenCount: gen.usage?.outputTokens,
      totalTokenCount: gen.usage?.totalTokens,
    },
    success: true,
    costOverrideUsd,
    notes: {
      job_id: ctx.job.id,
      kind: "scene_tools",
      provider: gen.provider,
      product_idx: itemMeta.product_idx,
      scene_idx: itemMeta.scene_idx,
      item_kind: kind,
      variant_idx: variantIdx,
      variant_total: variantTotal,
      closeup_key: closeupKey,
      has_back_reference: hasBackReference,
      scene_type: scene.type,
      focus_mode: focusMode,
      pose_mode: poseMode,
      aspect_ratio: p.aspect_ratio,
      image_size: p.image_size,
    },
  });

  return {
    result_image_path: `outputs/${filename}`,
    result_image_url: `/assets/outputs/${filename}`,
    input_tokens: gen.usage?.inputTokens ?? undefined,
    output_tokens: gen.usage?.outputTokens ?? undefined,
    cost_cny: usageRecord?.cost_cny ?? undefined,
  };
}
