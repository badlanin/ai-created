import sharp from "sharp";

const TARGET_MIN_BYTES = 100 * 1024;
const TARGET_MAX_BYTES = 180 * 1024;
const QUALITY_STEPS = [88, 84, 80, 76, 72, 68, 64, 60, 56, 52];
const MAX_SIDE_STEPS = [1600, 1400, 1200, 1000, 900, 800];

export interface OptimizedWebpImage {
  buffer: Buffer;
  mimeType: "image/webp";
  ext: "webp";
  size: number;
  quality: number;
}

export async function optimizeImageToWebp(
  input: Buffer,
): Promise<OptimizedWebpImage> {
  const metadata = await sharp(input).metadata();
  const longestSide = Math.max(metadata.width || 0, metadata.height || 0);
  const resizeSteps = [
    null,
    ...MAX_SIDE_STEPS.filter((side) => longestSide > side),
  ];

  let smallest: OptimizedWebpImage | null = null;

  for (const maxSide of resizeSteps) {
    for (const quality of QUALITY_STEPS) {
      let pipeline = sharp(input).rotate();
      if (maxSide) {
        pipeline = pipeline.resize({
          width: maxSide,
          height: maxSide,
          fit: "inside",
          withoutEnlargement: true,
        });
      }

      const buffer = await pipeline
        .webp({ quality, alphaQuality: 90, effort: 4 })
        .toBuffer();
      const result: OptimizedWebpImage = {
        buffer,
        mimeType: "image/webp",
        ext: "webp",
        size: buffer.length,
        quality,
      };

      if (!smallest || result.size < smallest.size) smallest = result;
      if (result.size <= TARGET_MAX_BYTES) return result;
      if (result.size >= TARGET_MIN_BYTES && result.size <= TARGET_MAX_BYTES) {
        return result;
      }
    }
  }

  return smallest || {
    buffer: input,
    mimeType: "image/webp",
    ext: "webp",
    size: input.length,
    quality: QUALITY_STEPS[QUALITY_STEPS.length - 1],
  };
}
