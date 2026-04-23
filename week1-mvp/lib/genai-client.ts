import { GoogleGenAI } from "@google/genai";

/**
 * 统一构造 @google/genai 客户端
 *
 * 鉴权方式：Application Default Credentials (ADC)
 *
 * 底层的 google-auth-library 会按这个顺序找凭证：
 *   1. 环境变量 GOOGLE_APPLICATION_CREDENTIALS 指向的 JSON 文件
 *      （用户账号 ADC：gcloud auth application-default login 生成；
 *        也可以是下载的 service account key）
 *   2. 如果跑在 GCP VM / Cloud Run 上：自动用绑定的 Service Account
 *      的 metadata server token
 *
 * 部署在 VM 上时，默认会用 2（SA）。若 SA 对某些 preview 模型没有访问权（比如
 * Nano Banana），可以在 VM 上跑 `gcloud auth application-default login`
 * 生成用户账号凭证，然后通过 docker-compose.yml 挂载到容器并设置
 * GOOGLE_APPLICATION_CREDENTIALS 指向它，优先级高于 SA。
 *
 * 组织安全策略通常禁止 API Key（长寿命 secret），所以这里不走 API Key。
 */
export function buildGenaiClient(): GoogleGenAI {
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || "us-central1";

  if (!project) {
    throw new Error(
      "缺少环境变量 GCP_PROJECT_ID，请在 .env 中配置",
    );
  }

  // @google/genai 在 vertexai 模式下会自动用 google-auth-library 读 ADC
  // 无需显式传 credentials
  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });
}
