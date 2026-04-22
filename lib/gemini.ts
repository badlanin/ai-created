import { GoogleGenAI } from "@google/genai";

/**
 * 服装属性结构化 schema
 * responseSchema 使用 JSON schema 子集
 */
const garmentSchema = {
  type: "object",
  properties: {
    主色调: {
      type: "string",
      description: "衣服主色调的中文描述（如：淡粉色、酒红色、香槟金）",
    },
    整体版型: {
      type: "string",
      description: "版型描述（如：A 字裙、直筒、修身、高腰）",
    },
    长度: {
      type: "string",
      description: "衣长或裙长（如：及膝、中长款、拖地）",
    },
    领口设计: {
      type: "string",
      description: "领口样式（如：V 领、方领、一字肩、抹胸、高领）",
    },
    袖型: {
      type: "string",
      description: "袖型（如：无袖、短袖、灯笼袖、泡泡袖、长袖）",
    },
    后背设计: {
      type: "string",
      description: "背部设计（如：系带、拉链、露背、蝴蝶结）",
    },
    面料材质: {
      type: "string",
      description: "面料（如：雪纺、蕾丝、缎面、亮片、网纱）",
    },
    装饰细节: {
      type: "array",
      items: { type: "string" },
      description: "核心装饰点列表（如：蕾丝边、珠片、刺绣、褶皱、腰带）",
    },
  },
  required: [
    "主色调",
    "整体版型",
    "长度",
    "领口设计",
    "袖型",
    "后背设计",
    "面料材质",
    "装饰细节",
  ],
};

const SYSTEM_PROMPT = `你是一位专业的服装视觉分析师，专注于伴娘服、礼服、婚纱这类商品。
用户会上传服装的正面图和（可选的）背面图。
请基于图片提取结构化的服饰属性，用中文输出，保持描述精简、商品化、可用于电商描述。
不要猜测图片里看不到的部分（比如只给了正面就不要强行描述后背，填"未提供"即可）。`;

/**
 * 调用 Vertex AI 的 Gemini 2.5 Flash 做视觉解析，返回结构化 JSON
 *
 * 鉴权方式：Application Default Credentials (ADC)
 * - 在 GCP VM 上运行：自动使用 VM 绑定的 Service Account（通过 metadata 服务器）
 * - 本地开发：先执行 `gcloud auth application-default login`
 * - 需要 VM 的 Service Account 拥有 "Vertex AI User" 角色
 */
export async function analyzeGarment(
  images: { buffer: Buffer; mimeType: string }[],
) {
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || "asia-southeast1";

  if (!project) {
    throw new Error(
      "缺少环境变量 GCP_PROJECT_ID，请在 .env 文件中配置为你的 Google Cloud 项目 ID",
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
    {
      text: `请分析以下 ${images.length} 张服装图片，提取结构化的服饰属性。`,
    },
    ...images.map((img) => ({
      inlineData: {
        mimeType: img.mimeType || "image/jpeg",
        data: img.buffer.toString("base64"),
      },
    })),
  ];

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: garmentSchema,
      temperature: 0.2,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error(
      "Vertex AI 未返回内容，请检查：\n" +
        "1. VM 的 Service Account 是否有 Vertex AI User 角色\n" +
        "2. 项目是否已启用 Vertex AI API\n" +
        "3. GCP_LOCATION 是否支持 Gemini 2.5 Flash",
    );
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`模型返回的 JSON 无法解析：${msg}\n原始响应：${text}`);
  }
}
