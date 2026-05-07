import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { DATA_DIR_PATH, getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { generateImage, type GenImageInput } from "@/lib/gemini-image";
import { resolveModelId } from "@/lib/ai-models";
import { recordUsage } from "@/lib/usage";
import { assertWithinBudget, getUserBudgetStatus } from "@/lib/pricing";
import { createJob } from "@/lib/jobs-db";
import { startJobWorker, type HandlerContext } from "@/lib/job-runner";
import { retryWithBackoff } from "@/lib/retry";
import {
  buildSceneShootText,
  buildSceneShootImage,
} from "@/lib/scene-prompt";

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

/**
 * POST /api/scene-tools
 *
 * 服饰场景图（统一工具）。N 张产品图 × M 个场景 → N×M 张成片。
 *
 * formData:
 *   - product_image_<i>: File（i = 0..N-1，N 张产品图，每张含模特+服装）
 *   - scenes: JSON Array<{ type: 'text', text: string } | { type: 'image', scene_id: number }>
 *   - aspect_ratio: '3:4' | '9:16' | '1:1' | '16:9' | '4:3' 等
 *   - user_hint?: string（≤ 200 字，给所有 item 共用的额外指令）
 *   - model?: string（默认 gemini-3-pro-image-preview）
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    assertWithinBudget(user.id, user.role);
    const db = getDb();

    const formData = await req.formData();

    // ─── 收集产品图 ───
    const productFiles: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (/^product_image_?\d+$/.test(key) && value instanceof File) {
        productFiles.push(value);
      }
    }
    if (productFiles.length === 0) {
      return NextResponse.json(
        { error: "请上传至少一张产品图" },
        { status: 400 },
      );
    }
    if (productFiles.length > 30) {
      return NextResponse.json(
        { error: "产品图最多 30 张（防止误操作出图爆量）" },
        { status: 400 },
      );
    }
    for (const f of productFiles) {
      if (f.size > 20 * 1024 * 1024) {
        return NextResponse.json(
          { error: `产品图 ${f.name} 太大（限 20MB）` },
          { status: 400 },
        );
      }
    }

    // ─── 解析 scenes 数组 ───
    const scenesRaw = formData.get("scenes");
    type SceneEntry =
      | { type: "text"; text: string }
      | { type: "image"; scene_id: number };
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
          if (obj.type === "text" && typeof obj.text === "string") {
            const text = obj.text.trim();
            if (text.length === 0) return null;
            if (text.length > 500) {
              throw new Error("文字场景描述太长（限 500 字）");
            }
            return { type: "text", text };
          }
          if (obj.type === "image" && Number.isFinite(obj.scene_id)) {
            return { type: "image", scene_id: Number(obj.scene_id) };
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

    // ─── 加载图片场景的元信息 ───
    type ImageSceneMeta = { id: number; name: string; image_path: string };
    const imageScenes: Map<number, ImageSceneMeta> = new Map();
    const imageSceneIds = scenes
      .filter((s): s is { type: "image"; scene_id: number } => s.type === "image")
      .map((s) => s.scene_id);
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

    // ─── 模型 ───
    const modelRaw = formData.get("model");
    const model = resolveModelId(
      "image_gen",
      typeof modelRaw === "string" ? modelRaw : undefined,
    );

    // ─── 构造 N×M 个 items（笛卡尔积）───
    const N = productFiles.length;
    const M = scenes.length;
    type ItemMeta = {
      product_idx: number;
      scene_idx: number;
      label: string;
    };
    const items: Array<ItemMeta & { label: string }> = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        const sceneEntry = scenes[j];
        const sceneLabel =
          sceneEntry.type === "image"
            ? imageScenes.get(sceneEntry.scene_id)?.name || `场景#${sceneEntry.scene_id}`
            : sceneEntry.text.slice(0, 14) +
              (sceneEntry.text.length > 14 ? "…" : "");
        items.push({
          product_idx: i,
          scene_idx: j,
          label: `产品 ${i + 1} · ${sceneLabel}`,
        });
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
        user_hint: userHint || null,
        product_count: N,
        scene_count: M,
        scenes: scenes.map((s, j) => {
          if (s.type === "image") {
            const meta = imageScenes.get(s.scene_id);
            return {
              type: "image",
              scene_id: s.scene_id,
              scene_name: meta?.name,
              scene_image_path: meta?.image_path,
            };
          }
          return { type: "text", text: s.text };
        }),
        items, // [{product_idx, scene_idx, label}, ...]
      },
    });

    // ─── 落盘产品图到 job 输入目录 ───
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
    // 把 product_paths / product_mime_types 补进 params
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
}> {
  const p = ctx.params as {
    aspect_ratio?: string;
    user_hint?: string | null;
    product_count: number;
    scene_count: number;
    scenes: Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          scene_id: number;
          scene_name?: string;
          scene_image_path?: string;
        }
    >;
    items: Array<{ product_idx: number; scene_idx: number; label: string }>;
    product_paths: string[];
    product_mime_types: string[];
  };

  const itemMeta = p.items[ctx.item.idx];
  if (!itemMeta) throw new Error(`item[${ctx.item.idx}] 丢失`);

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
  const productInput: GenImageInput = {
    buffer: productBuf,
    mimeType: productMime,
  };

  // 解析当前 item 的场景
  const scene = p.scenes[itemMeta.scene_idx];
  if (!scene) throw new Error(`scene[${itemMeta.scene_idx}] 丢失`);

  let prompt: string;
  const inputs: GenImageInput[] = [productInput];
  if (scene.type === "text") {
    prompt = buildSceneShootText(scene.text, p.user_hint || undefined);
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
    prompt = buildSceneShootImage(scene.scene_name, p.user_hint || undefined);
  }

  // 调 Gemini Pro Image 4K
  const gen = await retryWithBackoff(
    () =>
      generateImage(inputs, prompt, ctx.job.model, {
        aspectRatio: p.aspect_ratio,
        imageSize: "4K",
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

  recordUsage({
    userId: ctx.userId,
    model: ctx.job.model,
    feature: "other",
    usageMetadata: gen.usageMetadata,
    success: true,
    notes: {
      job_id: ctx.job.id,
      kind: "scene_tools",
      product_idx: itemMeta.product_idx,
      scene_idx: itemMeta.scene_idx,
      scene_type: scene.type,
      aspect_ratio: p.aspect_ratio,
    },
  });

  return {
    result_image_path: `outputs/${filename}`,
    result_image_url: `/assets/outputs/${filename}`,
    input_tokens: gen.usageMetadata?.promptTokenCount ?? undefined,
    output_tokens: gen.usageMetadata?.candidatesTokenCount ?? undefined,
  };
}
