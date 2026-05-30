# syntax=docker/dockerfile:1

# ---- Base ----
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# ---- Dependencies ----
# better-sqlite3 需要编译，装好 python3 + make + g++
FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# ---- Build ----
FROM base AS builder
RUN apk add --no-cache python3 make g++
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runner ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# 拷贝 standalone 产物
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 种子资源（首启动时拷贝到 data/uploads/，让新实例自动有色卡/模特/场景预设）
COPY --from=builder --chown=nextjs:nodejs /app/seed-assets ./seed-assets

# better-sqlite3 的 native binding 不在 standalone 里，需要单独拷贝
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# sharp 是 native binding，附带 libvips 二进制和 platform-specific 子模块（linux-musl-*）
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@img ./node_modules/@img
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/color ./node_modules/color
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/color-string ./node_modules/color-string
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/color-name ./node_modules/color-name
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/color-convert ./node_modules/color-convert
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/simple-swizzle ./node_modules/simple-swizzle
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/is-arrayish ./node_modules/is-arrayish
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/detect-libc ./node_modules/detect-libc
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/semver ./node_modules/semver

# 创建 data 目录并让 nextjs 用户可写
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
