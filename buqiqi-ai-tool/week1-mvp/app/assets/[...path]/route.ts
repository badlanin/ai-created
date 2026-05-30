import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { DATA_DIR_PATH } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /assets/* - 服务 data 目录下的文件
 *
 * 路径映射：
 *   /assets/outputs/xxx.png  → /app/data/outputs/xxx.png
 *   /assets/models/xxx.jpg   → /app/data/models/xxx.jpg
 *   /assets/scenes/xxx.jpg   → /app/data/scenes/xxx.jpg
 *
 * 所有文件访问都需要登录（在 middleware 已拦截，这里再要求一次防御性校验）。
 * 防穿越：解析后的绝对路径必须还在 DATA_DIR 里。
 */

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  try {
    await requireUser();
    const { path: segments } = await ctx.params;
    if (!segments || segments.length === 0) {
      return NextResponse.json({ error: "无效路径" }, { status: 400 });
    }

    const relPath = segments.join("/");
    const absPath = path.resolve(DATA_DIR_PATH, relPath);

    // 路径穿越防御
    if (!absPath.startsWith(path.resolve(DATA_DIR_PATH) + path.sep)) {
      return NextResponse.json({ error: "非法路径" }, { status: 400 });
    }

    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    const ext = path.extname(absPath).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";
    const data = fs.readFileSync(absPath);

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
