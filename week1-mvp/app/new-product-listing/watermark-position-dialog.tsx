"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Move } from "lucide-react";
import { Button, Dialog } from "@/app/_components/ui";
import type { ProductMediaWatermarkPlacement } from "@/lib/new-product-listing-draft";

export const DEFAULT_WATERMARK_PLACEMENT: ProductMediaWatermarkPlacement = {
  x: 0.78,
  y: 0.9,
  width: 0.4,
};

type Interaction =
  | {
      type: "move";
      startClientX: number;
      startClientY: number;
      startPlacement: ProductMediaWatermarkPlacement;
    }
  | { type: "resize" };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function WatermarkPositionDialog({
  open,
  imageUrl,
  watermarkUrl,
  watermarkName,
  initialPlacement,
  applying,
  applyToAll,
  onClose,
  onConfirm,
}: {
  open: boolean;
  imageUrl: string;
  watermarkUrl: string;
  watermarkName: string;
  initialPlacement: ProductMediaWatermarkPlacement;
  applying: boolean;
  applyToAll: boolean;
  onClose: () => void;
  onConfirm: (placement: ProductMediaWatermarkPlacement) => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const [placement, setPlacement] =
    useState<ProductMediaWatermarkPlacement>(initialPlacement);
  const [watermarkAspect, setWatermarkAspect] = useState(4);

  useEffect(() => {
    if (open) setPlacement(initialPlacement);
  }, [open, imageUrl, watermarkUrl, initialPlacement]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const interaction = interactionRef.current;
      const stage = stageRef.current;
      if (!interaction || !stage) return;
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      if (interaction.type === "move") {
        const nextX =
          interaction.startPlacement.x +
          (event.clientX - interaction.startClientX) / rect.width;
        const nextY =
          interaction.startPlacement.y +
          (event.clientY - interaction.startClientY) / rect.height;
        const halfWidth = interaction.startPlacement.width / 2;
        const halfHeight =
          ((interaction.startPlacement.width * rect.width) / watermarkAspect / rect.height) /
          2;
        setPlacement((current) => ({
          ...current,
          x: clamp(nextX, halfWidth, 1 - halfWidth),
          y: clamp(nextY, halfHeight, 1 - halfHeight),
        }));
        return;
      }

      const centerX = rect.left + placement.x * rect.width;
      const pointerDistance = Math.abs(event.clientX - centerX);
      const nextWidth = clamp((pointerDistance * 2) / rect.width, 0.08, 0.9);
      setPlacement((current) => ({ ...current, width: nextWidth }));
    }

    function handlePointerUp() {
      interactionRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [placement.x, placement.y, watermarkAspect]);

  function beginMove(event: React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = {
      type: "move",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPlacement: placement,
    };
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  }

  function beginResize(event: React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = { type: "resize" };
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
  }

  function applyPreset(x: number, y: number) {
    setPlacement((current) => ({ ...current, x, y }));
  }

  return (
    <Dialog
      open={open}
      onClose={applying ? () => undefined : onClose}
      title={applyToAll ? "统一调整水印" : "调整水印"}
      description={
        applyToAll
          ? "拖动水印调整位置，拖动右下角控制点缩放；完成后应用到全部媒体图片。"
          : "拖动水印调整位置，拖动右下角控制点缩放。"
      }
      width="2xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <Button
            variant="ghost"
            disabled={applying}
            onClick={() => setPlacement(DEFAULT_WATERMARK_PLACEMENT)}
          >
            恢复默认
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={applying} onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={applying}
              onClick={() => onConfirm(placement)}
            >
              完成调整
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex min-h-[360px] items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-[linear-gradient(45deg,#f2f3f5_25%,transparent_25%,transparent_75%,#f2f3f5_75%),linear-gradient(45deg,#f2f3f5_25%,#fff_25%,#fff_75%,#f2f3f5_75%)] bg-[length:20px_20px] bg-[position:0_0,10px_10px] p-3">
          <div ref={stageRef} className="relative inline-block max-w-full touch-none">
            <img
              src={imageUrl}
              alt="水印位置预览"
              draggable={false}
              className="block max-h-[58vh] max-w-full select-none object-contain"
            />
            <div
              role="button"
              tabIndex={0}
              aria-label={`拖动 ${watermarkName} 水印`}
              onPointerDown={beginMove}
              className="absolute cursor-grab touch-none border-2 border-brand-500 bg-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.9)] active:cursor-grabbing"
              style={{
                left: `${placement.x * 100}%`,
                top: `${placement.y * 100}%`,
                width: `${placement.width * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <img
                src={watermarkUrl}
                alt={watermarkName}
                draggable={false}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth && image.naturalHeight) {
                    setWatermarkAspect(image.naturalWidth / image.naturalHeight);
                  }
                }}
                className="block h-auto w-full select-none"
              />
              <span className="pointer-events-none absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white shadow">
                <Move size={13} />
              </span>
              <button
                type="button"
                aria-label="拖动缩放水印"
                onPointerDown={beginResize}
                className="absolute -bottom-3 -right-3 flex h-7 w-7 cursor-nwse-resize items-center justify-center rounded-full border-2 border-white bg-brand-600 text-white shadow-md"
              >
                <Maximize2 size={13} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-bg-tertiary px-3 py-2">
          <div className="text-xs text-fg-tertiary">
            当前大小：{Math.round(placement.width * 100)}% · {watermarkName}
          </div>
          <div className="flex flex-wrap gap-1">
            {[
              ["左上", 0.22, 0.12],
              ["右上", 0.78, 0.12],
              ["居中", 0.5, 0.5],
              ["左下", 0.22, 0.88],
              ["右下", 0.78, 0.88],
            ].map(([label, x, y]) => (
              <button
                key={String(label)}
                type="button"
                onClick={() => applyPreset(Number(x), Number(y))}
                className="rounded border border-border-default bg-white px-2 py-1 text-[11px] text-fg-secondary hover:border-brand-300 hover:text-brand-600"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
