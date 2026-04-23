import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getEnabledModels, type AiModelCategory } from "@/lib/ai-models";

export const runtime = "nodejs";

/**
 * GET /api/ai-models?category=vision|image_gen
 *
 * 面向所有登录用户。返回 enabled 的模型列表（不含 disabled、不含其他 category）。
 * 用于前端 /recolor、/analyze、/on-model 页面动态拉模型选择项。
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const url = new URL(req.url);
    const category = url.searchParams.get("category") as AiModelCategory | null;
    if (category !== "vision" && category !== "image_gen") {
      return NextResponse.json(
        { error: "category 必须是 vision 或 image_gen" },
        { status: 400 },
      );
    }
    const rows = getEnabledModels(category);
    return NextResponse.json(rows);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
