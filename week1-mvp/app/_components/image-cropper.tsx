"use client";

import { useCallback, useState } from "react";
import Cropper, { Area } from "react-easy-crop";
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
 * 裁剪模态。全屏遮罩 + 居中操作台 + 底部确认/取消
 */
export function ImageCropper({
  imageSrc,
  initialAspect = 0,
  onConfirm,
  onCancel,
}: ImageCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState<number>(initialAspect);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  const onCropComplete = useCallback(
    (_percent: Area, px: Area) => setCroppedArea(px),
    [],
  );

  async function handleConfirm() {
    if (!croppedArea) return;
    setProcessing(true);
    try {
      const blob = await getCroppedBlob(imageSrc, croppedArea);
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
      <div className="flex-1 relative">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspect > 0 ? aspect : undefined}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
          restrictPosition={false}
        />
      </div>

      <div className="bg-white border-t border-gray-300 px-4 py-3">
        <div className="max-w-4xl mx-auto space-y-3">
          {/* 比例切换 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 mr-1">比例</span>
            {ASPECT_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setAspect(p.value)}
                className={`px-3 py-1 rounded-md border text-xs ${
                  aspect === p.value
                    ? "border-blue-500 bg-blue-50 text-blue-800"
                    : "border-gray-300 hover:border-gray-400"
                }`}
              >
                {p.label}
              </button>
            ))}
            <span className="text-xs text-gray-500 ml-4 mr-1">缩放</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 max-w-xs"
            />
            <span className="text-xs text-gray-500 font-mono">
              {zoom.toFixed(2)}x
            </span>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              拖动图片选择要保留的区域。建议把原图上的人物 / 水印裁掉，只留服装部分。
            </p>
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm text-gray-600 rounded-md hover:bg-gray-100"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={!croppedArea || processing}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
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
