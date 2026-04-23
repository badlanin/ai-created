import { GoogleGenAI } from "@google/genai";
import { resolveImageModel } from "./image-models";

/**
 * Nano Banana (Gemini * Image) 调用封装
 *
 * 能力：
 * - 输入若干张参考图 + 文本提示，生成新图
 * - 适合：换色、风格迁移、模特穿着合成
 *
 * 鉴权：Vertex AI + ADC（沿用 lib/gemini.ts 的配置）
 *
 * 可选模型见 lib/image-models.ts。默认走 gemini-3-pro-image-preview
 * （Nano Banana Pro）。也可以：
 *   1) 在 .env 中配 GEMINI_IMAGE_MODEL 改全局默认
 *   2) 调用时传 modelOverride，按次指定（前端表单选的那种）
 */

export interface GenImageInput {
  buffer: Buffer;
  mimeType: string;
}

export interface GenImageResult {
  mimeType: string;
  data: Buffer; // 生成图的原始字节
  textResponse?: string; // 模型附带的文本（通常有一段描述）
  model: string; // 实际用到的模型 ID（记录到 generations 表）
}

/**
 * 调用 Nano Banana 生成一张新图。
 *
 * @param images 参考图列表（如产品正面/背面、模特图、场景图）
 * @param prompt 文本指令
 * @param modelOverride 单次调用的模型 ID（会经 resolveImageModel 白名单校验）
 */
export async function generateImage(
  images: GenImageInput[],
  prompt: string,
  modelOverride?: string,
): Promise<GenImageResult> {
  const MODEL = resolveImageModel(modelOverride);
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || "asia-southeast1";

  if (!project) {
    throw new Error(
      "缺少环境变量 GCP_PROJECT_ID，请在 .env 文件中配置",
    );
  }

  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [
    { text: prompt },
    ...images.map((img) => ({
      inlineData: {
        mimeType: img.mimeType || "image/jpeg",
        data: img.buffer.toString("base64"),
      },
    })),
  ];

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      // Nano Banana 既可以返回图片也可以返回文本，都要
      responseModalities: ["IMAGE", "TEXT"],
      temperature: 0.4,
    },
  });

  // 解析 response.candidates[0].content.parts，找出 inlineData（图片）
  const candidates = response.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error(
      "Nano Banana 未返回任何候选结果。可能是内容被安全策略拦截。",
    );
  }

  let imageData: { mimeType: string; data: Buffer } | null = null;
  let textResponse: string | undefined;

  for (const cand of candidates) {
    const parts = cand.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const base64 = part.inlineData.data;
        imageData = {
          mimeType: part.inlineData.mimeType || "image/png",
          data: Buffer.from(base64, "base64"),
        };
      } else if (part.text) {
        textResponse = (textResponse ? textResponse + "\n" : "") + part.text;
      }
    }
    if (imageData) break;
  }

  if (!imageData) {
    throw new Error(
      `Nano Banana 没返回图片。${textResponse ? "模型说：" + textResponse : ""}`,
    );
  }

  return {
    mimeType: imageData.mimeType,
    data: imageData.data,
    textResponse,
    model: MODEL,
  };
}

/**
 * 构造换色 prompt
 * 关键原则：
 * 1. 明确说"只改颜色"
 * 2. 要求保留面料纹理、装饰、廓形
 * 3. 给出目标颜色的自然语言描述 + HEX 色号辅助
 */
export function buildRecolorPrompt(colorName: string, hex: string): string {
  return `请严格按照以下要求修改图片：

【目标】把这件服装的主色调改为「${colorName}」（对应色号 ${hex}）。

【必须保留】
- 服装的廓形、版型、长度、剪裁细节
- 面料质感（如缎面、雪纺、蕾丝、网纱的光泽和透明度）
- 所有装饰细节（蕾丝、刺绣、珠片、褶皱、蝴蝶结、系带等）完全不动
- 模特（如有）的姿势、面部、发型、肤色、背景

【只改】服装主体的主色调
- 改后的颜色要自然地覆盖所有大面积的布料
- 蕾丝、刺绣等装饰保持与主色协调（比如白色蕾丝不变，同色蕾丝要跟着变）
- 阴影和高光要符合新颜色的光泽特性

【质量要求】输出图要清晰、真实，保持商品摄影级质感，不要添加水印或任何额外元素。

请输出一张修改后的产品图片。`;
}
