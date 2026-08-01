# rate_limit 플러그인을 포함한 Caddy 커스텀 빌드.
# 표준 caddy 이미지엔 rate_limit 이 없어 xcaddy 로 빌드해 넣는다.
FROM caddy:2-builder AS builder
# 버전을 고정한다. HEAD 로 두면 나중에 재빌드할 때 플러그인이 올라가 Caddyfile 의
# rate_limit 지시어 문법이 안 맞을 수 있고, 그러면 유일한 외부 진입점인 Caddy 가
# 기동을 거부해 "코드는 안 건드렸는데 사이트가 죽는" 상황이 된다.
RUN xcaddy build --with github.com/mholt/caddy-ratelimit@v0.1.0

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
