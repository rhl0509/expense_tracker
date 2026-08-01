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
# next.config 의 rewrites 목적지는 **빌드 시점에 평가돼 매니페스트에 문자열로 굳는다**.
# 런타임 environment 로 주는 BACKEND_URL 은 standalone 서버가 다시 읽지 않으므로,
# 빌드 인자로 넘겨야 컨테이너 네트워크 주소(backend:5000)가 박힌다. 안 넘기면 기본값
# 127.0.0.1:8010 이 굳어 프론트 컨테이너가 자기 자신을 호출하고 모든 API 가 실패한다.
# (백엔드 내부 주소라 시크릿이 아니다 — ARG 로 충분하다.)
ARG BACKEND_URL=http://backend:5000
ENV BACKEND_URL=$BACKEND_URL
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
