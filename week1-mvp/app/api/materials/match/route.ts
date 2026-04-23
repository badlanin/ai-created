import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { autoMatchMaterials, getAllMaterials } from "@/lib/materials";

export const runtime = "nodejs";

/**
 * POST /api/materials/match
 * body: { text: string }  -- 通常是款式解析输出里的"面料材质"字段
 * 返回: { matched: Material[], all: Material[] }
 *
 * 用途：前端在解析完款式后调这个接口，拿到"自动匹配到的材质"列表展示；
 * 同时拿到全部材质列表方便用户手动增删（从全部里再勾一些）
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = (await req.json()) as { text?: string };
    const text = (body.text || "").trim();
    const all = getAllMaterials();
    const matched = text ? autoMatchMaterials(text, all) : [];
    return NextResponse.json({ matched, all });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
