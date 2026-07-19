# 가계부 프론트 (Next.js standalone). 멀티스테이지로 런타임 이미지를 최소화한다.
# next.config 의 output:"standalone" 이 server.js + 최소 node_modules 만 뽑아준다.

# ── 의존성 설치 ──
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── 빌드 ──
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── 런타임 ──
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# standalone 출력만 복사. static 과 public 은 standalone 에 안 담기므로 따로 복사한다.
# node:20-slim 에 이미 있는 비루트 유저(node, uid 1000)가 소유하게 복사한다.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
