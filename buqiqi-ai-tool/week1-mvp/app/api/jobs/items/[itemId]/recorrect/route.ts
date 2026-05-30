/**
 * POST /api/jobs/items/:itemId/recorrect
 *
 * 拿一个 recolor item 的"模型直出原图"（raw_image_path）重新跑色彩校正，
 * 用前端传来的 strength + maskThreshold 参数。返回新生成的校正图 URL +
 * 新的 ΔE 等元信息。
 *
 * 给"手动滑块校色"UI 用 —— 用户拖动滑块 → 这条 API 调用 → 立刻看到新效果。
 *
 * 行为：
 *   1. 校验 item 属于当前用户（admin 可跨用户）
 *   2. 读 raw_image_path 对应的图（一定存在；如果没有，说明是老 job 不支持重校）
 *   3. 调 correctImageColor 重做一次校正
 *   4. 写入 outputs/，**覆盖**当前 result_image_path（保留 raw 不动）
 *   5. 更新 correction_meta JSON
 *   6. 返回新的 result_image_url + 元信息
 */

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { getDb, DATA_DIR_PATH } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { correctImageColor } from "@/lib/color-correct";
import { updateJobItem } from "@/lib/jobs-db";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ itemId: string }> };

interface ExistingCorrectionMeta {
  applied?: boolean;
  before_rgb?: [number, number, number];
  before_delta_e?: number;
  multiplier?: [number, number, number];
  masked_pixel_ratio?: number;
  strength?: number;
  mask_threshold?: number;
  target_hex?: string;
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { itemId: itemIdRaw } = await params;
    const itemId = Number(itemIdRaw);
    if (!Number.isFinite(itemId)) {
      return NextResponse.json({ error: "itemId 不合法" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      strength?: number;
      maskThreshold?: number;
      mode?: "masked" | "global";
    };
    const strength = clamp(body.strength ?? 1.0, 0, 2);
    const maskThreshold = clamp(body.maskThreshold ?? 30, 5, 80);
    const mode = body.mode === "global" ? "global" : "masked";

    // ─── 取出 item + 校验权限 ───
    const db = getDb();
    const item = db
      .prepare(
        `SELECT i.*, j.user_id as job_user_id, j.feature, j.params as job_params
         FROM render_job_items i
         INNER JOIN render_jobs j ON i.job_id = j.id
         WHERE i.id = ?`,
      )
      .get(itemId) as
      | {
          id: number;
          job_id: string;
          idx: number;
          status: string;
          result_image_path: string | null;
          raw_image_path: string | null;
          correction_meta: string | null;
          job_user_id: number;
          feature: string;
          job_params: string | null;
        }
      | undefined;

    if (!item) {
      return NextResponse.json({ error: "item 不存在" }, { status: 404 });
    }
    if (item.job_user_id !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }
    if (item.feature !== "recolor") {
      return NextResponse.json(
        { error: "只有 recolor 任务支持手动校色" },
        { status: 400 },
      );
    }
    if (item.status !== "completed") {
      return NextResponse.json(
        { error: "item 还未完成，无法重新校色" },
        { status: 400 },
      );
    }
    if (!item.raw_image_path) {
      return NextResponse.json(
        { error: "此 item 没有保存原图（旧任务），无法重新校色" },
        { status: 400 },
      );
    }

    // ─── 解析目标 hex（从 job.params.item_details[idx]）───
    const jobParams = parseJson(item.job_params) as {
      item_details?: Array<{ idx: number; hex: string; colorName: string }>;
    } | null;
    const itemDetail = jobParams?.item_details?.find(
      (d) => d.idx === item.idx,
    );
    if (!itemDetail) {
      return NextResponse.json(
        { error: "找不到 item 对应的颜色信息" },
        { status: 500 },
      );
    }
    const targetHex = itemDetail.hex;

    // ─── 读 raw 图 ───
    const rawAbsPath = path.join(DATA_DIR_PATH, item.raw_image_path);
    let rawBuffer: Buffer;
    try {
      rawBuffer = await fs.readFile(rawAbsPath);
    } catch (e) {
      return NextResponse.json(
        {
          error: `原图文件丢失：${item.raw_image_path}（可能被清理）`,
        },
        { status: 500 },
      );
    }

    // ─── 跑校正 ───
    const correction = await correctImageColor(rawBuffer, targetHex, {
      strength,
      maskThreshold,
      mode,
      // strength=0 时也想强制写一份（让用户看到完全 "无校正" 的效果）
      threshold: strength === 0 ? Number.MAX_VALUE : 6,
    });

    // ─── 保存：覆盖当前 result_image_path（不动 raw）───
    const oldResult = item.result_image_path;
    const ext = rawAbsPath.endsWith(".png") ? "png" : "jpg";
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newFilename = `recolor_${user.id}_${stamp}_recorr.${ext}`;
    const outputsDir = path.join(DATA_DIR_PATH, "outputs");
    await fs.mkdir(outputsDir, { recursive: true });
    const newAbsPath = path.join(outputsDir, newFilename);
    await fs.writeFile(newAbsPath, correction.buffer);

    // 删旧 result（不动 raw）—— 失败不要紧
    if (oldResult) {
      try {
        await fs.unlink(path.join(DATA_DIR_PATH, oldResult));
      } catch {}
    }

    const newCorrectionMeta: ExistingCorrectionMeta = {
      applied: correction.applied,
      before_rgb: [
        Math.round(correction.before.r),
        Math.round(correction.before.g),
        Math.round(correction.before.b),
      ],
      before_delta_e: Number(correction.beforeDeltaE.toFixed(2)),
      multiplier: correction.multiplier
        ? [
            Number(correction.multiplier.r.toFixed(4)),
            Number(correction.multiplier.g.toFixed(4)),
            Number(correction.multiplier.b.toFixed(4)),
          ]
        : undefined,
      masked_pixel_ratio: correction.maskedPixelRatio,
      strength,
      mask_threshold: maskThreshold,
      target_hex: targetHex,
    };

    updateJobItem(itemId, {
      result_image_path: `outputs/${newFilename}`,
      result_image_url: `/assets/outputs/${newFilename}`,
      correction_meta: JSON.stringify(newCorrectionMeta),
    });

    return NextResponse.json({
      result_image_url: `/assets/outputs/${newFilename}`,
      result_image_path: `outputs/${newFilename}`,
      correction_meta: newCorrectionMeta,
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[recorrect] 失败:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function parseJson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
