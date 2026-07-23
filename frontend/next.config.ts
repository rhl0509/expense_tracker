import type { NextConfig } from "next";

const BACKEND = process.env.BACKEND_URL || "http://127.0.0.1:8010";

const nextConfig: NextConfig = {
  // 배포: 최소 런타임만 담은 standalone 서버로 빌드. dev 에는 영향 없다.
  output: "standalone",
  allowedDevOrigins: [
    "127.0.0.1",
    // DHCP로 마지막 옥텟이 바뀌어도 안 깨지게 대역으로 둔다.
    // (Next의 matchWildcardDomain은 점 단위 우측부터 매칭하고 *는 한 세그먼트를 먹는다.)
    "112.158.254.*",
    "100.125.255.53",
    "desktop-7du8ple.tail641172.ts.net",
  ],
  async rewrites() {
    // 브라우저는 동일 출처(localhost:3010)로 호출 → 세션 쿠키 그대로 전달.
    // Next 서버가 백엔드(FastAPI)로 프록시한다.
    return [
      { source: "/auth/:path*", destination: `${BACKEND}/auth/:path*` },
      { source: "/transaction/:path*", destination: `${BACKEND}/transaction/:path*` },
      { source: "/ai/:path*", destination: `${BACKEND}/ai/:path*` },
      { source: "/integration/:path*", destination: `${BACKEND}/integration/:path*` },
      { source: "/health", destination: `${BACKEND}/health` },
    ];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
