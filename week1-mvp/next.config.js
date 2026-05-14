/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // better-sqlite3 + sharp 是 native binding，不要让 webpack 打包
  // 必须在服务端作为外部模块 require
  serverExternalPackages: ["better-sqlite3", "sharp"],
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  // 跳过 Docker build 时的 ESLint —— 我们 deploy 前在本地跑过 npx tsc --noEmit，
  // 且很少有需要 lint 才能 catch 的问题。Lint 每次 build 占 25-30 秒，跳过省时间。
  // 真要 lint 本地手动跑 `npx next lint`
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
