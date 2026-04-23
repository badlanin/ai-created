/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // better-sqlite3 是 native binding，不要让 webpack 打包
  // 必须在服务端作为外部模块 require
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

module.exports = nextConfig;
