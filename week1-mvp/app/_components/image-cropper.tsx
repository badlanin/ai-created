"use client";

import { useRef, useState } from "react";
import ReactCrop, {
  type Crop,
  type PixelCrop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";
// 注意：ReactCrop.css 在 app/globals.css 里统一引入，这里不要重复 import
import { getCroppedBlob } from "@/lib/crop";

export interface ImageCropperProps {
  /** 原图 URL（blob URL 或普通 URL） */
  imageSrc: string;
  /** 建议初始比例。0 = 自由比例（默认） */
  initialAspect?: number;
  /** 确认裁剪后返回 Blob */
  onConfirm: (blob: Blob) => void;
  /** 取消 */
  onCancel: () => void;
}

const ASPECT_PRESETS: Array<{ label: string; value: number }> = [
  { label: "自由", value: 0 },
  { label: "3:4", value: 3 / 4 },
  { label: "2:3", value: 2 / 3 },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "16:9", value: 16 / 9 },
];

/**
 * 裁剪模态
 *
 * 使用 react-image-crop：PS 风格的交互
 * - 4 个角 + 4 条边，共 8 个拖拽锚点
 * - 自由比例下可任意拉伸裁剪框
 * - 选中比例后，拖拽锚点时会锁定该比例
 */
export function ImageCropper({
  imageSrc,
  initialAspect = 0,
  onConfirm,
  onCancel,
}: ImageCropperProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [aspect, setAspect] = useState<number>(initialAspect);
  const [processing, setProcessing] = useState(false);
  const [imgNaturalSize, setImgNaturalSize] = useState<{
    w: number;
    h: number;
  } | null>(null);

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth, naturalHeight, width, height } = e.currentTarget;
    setImgNaturalSize({ w: naturalWidth, h: naturalHeight });

    // 初始默认选中 80% 区域居中
    const initial = aspect > 0
      ? centerCrop(
          makeAspectCrop(
            {
              unit: "%",
              width: 80,
            },
            aspect,
            width,
            height,
          ),
          width,
          height,
        )
      : centerCrop(
          {
            unit: "%" as const,
            x: 10,
            y: 10,
            width: 80,
            height: 80,
          },
          width,
          height,
        );
    setCrop(initial);
  }

  function handleAspectChange(next: number) {
    setAspect(next);
    if (imgRef.current) {
      const { width, height } = imgRef.current;
      const nextCrop = next > 0
        ? centerCrop(
            makeAspectCrop(
              {
                unit: "%",
                width: 80,
              },
              next,
              width,
              height,
            ),
            width,
            height,
          )
        : centerCrop(
            {
              unit: "%" as const,
              x: 10,
              y: 10,
              width: 80,
              height: 80,
            },
            width,
            height,
          );
      setCrop(nextCrop);
    }
  }

  async function handleConfirm() {
    if (!completedCrop || !imgRef.current || !imgNaturalSize) return;

    // react-image-crop 的 completedCrop 是「显示尺寸下的像素」
    // 需要换算到原图像素
    const scaleX = imgNaturalSize.w / imgRef.current.width;
    const scaleY = imgNaturalSize.h / imgRef.current.height;
    const area = {
      x: Math.round(completedCrop.x * scaleX),
      y: Math.round(completedCrop.y * scaleY),
      width: Math.round(completedCrop.width * scaleX),
      height: Math.round(completedCrop.height * scaleY),
    };

    if (area.width < 8 || area.height < 8) {
      alert("裁剪区域太小");
      return;
    }

    setProcessing(true);
    try {
      const blob = await getCroppedBlob(imageSrc, area);
      onConfirm(blob);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex flex-col"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      {/* 图片 + 裁剪区域 */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        <ReactCrop
          crop={crop}
          onChange={(_pixelCrop, percentCrop) => setCrop(percentCrop)}
          onComplete={(c) => setCompletedCrop(c)}
          aspect={aspect > 0 ? aspect : undefined}
          ruleOfThirds
          minWidth={20}
          minHeight={20}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageSrc}
            alt="待裁剪"
            onLoad={onImageLoad}
            style={{ maxHeight: "calc(100vh - 180px)", maxWidth: "100%" }}
          />
        </ReactCrop>
      </div>

      {/* 底部操作台 */}
      <div className="bg-bg-secondary border-t border-border-default px-4 py-3">
        <div className="max-w-4xl mx-auto space-y-3">
          {/* 比例切换 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-fg-tertiary mr-1">比例</span>
            {ASPECT_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => handleAspectChange(p.value)}
                className={`px-3 py-1.5 rounded-md border text-xs transition-colors ${
                  aspect === p.value
                    ? "border-transparent text-brand-400 font-medium"
                    : "border-border-default text-fg-secondary hover:border-border-strong hover:text-fg-primary"
                }`}
                style={
                  aspect === p.value
                    ? {
                        background: "var(--brand-50-bg)",
                        borderColor: "rgba(59, 130, 246, 0.4)",
                      }
                    : undefined
                }
              >
                {p.label}
              </button>
            ))}
            {completedCrop && imgNaturalSize ? (
              <span className="ml-auto text-xs text-fg-tertiary font-mono">
                {Math.round(
                  (completedCrop.width * imgNaturalSize.w) /
                    (imgRef.current?.width || 1),
                )}
                {" × "}
                {Math.round(
                  (completedCrop.height * imgNaturalSize.h) /
                    (imgRef.current?.height || 1),
                )}
                {" px"}
              </span>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-fg-tertiary flex-1">
              拖拽裁剪框四角或四边的锚点调整大小；拖动中间移动位置。建议把原图上的人物 / 水印裁掉，只留服装部分。
            </p>
            <div className="flex gap-2 shrink-0">
              <button onClick={onCancel} className="btn btn-ghost btn-md">
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={!completedCrop || processing}
                className="btn btn-primary btn-md"
              >
                {processing ? "处理中..." : "确认裁剪"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
