import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { saveUploadFile } from "@/lib/uploads";
import { optimizeImageToWebp } from "@/lib/image-webp";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const formData = await req.formData();
    const files = formData
      .getAll("files")
      .filter((item): item is File => item instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "请上传图片" }, { status: 400 });
    }
    if (files.length > 20) {
      return NextResponse.json(
        { error: "一次最多上传 20 张图片" },
        { status: 400 },
      );
    }

    const items = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json(
          { error: "只支持图片文件" },
          { status: 400 },
        );
      }
      if (file.size > 20 * 1024 * 1024) {
        return NextResponse.json(
          { error: "单张图片不能超过 20MB" },
          { status: 400 },
        );
      }
      const input = Buffer.from(await file.arrayBuffer());
      const optimized = await optimizeImageToWebp(input);
      const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
      const fileToSave = new File(
        [new Uint8Array(optimized.buffer)],
        `${baseName}.${optimized.ext}`,
        { type: optimized.mimeType },
      );

      const saved = await saveUploadFile(fileToSave, "product-media", user.id);
      items.push({
        url: saved.url,
        alt: file.name.replace(/\.[^.]+$/, "") || "商品图片",
        size: saved.size,
        mimeType: saved.mimeType,
      });
    }

    return NextResponse.json({ ok: true, items });
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status },
    );
  }
}
