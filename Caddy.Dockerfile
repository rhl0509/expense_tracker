# rate_limit 플러그인을 포함한 Caddy 커스텀 빌드.
# 표준 caddy 이미지엔 rate_limit 이 없어 xcaddy 로 빌드해 넣는다.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
