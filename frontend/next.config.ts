import type { NextConfig } from "next";

const BACKEND = process.env.BACKEND_URL || "http://127.0.0.1:5000";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "127.0.0.1",
    "112.158.254.192",
    "100.125.255.53",
    "desktop-7du8ple.tail641172.ts.net",
  ],
  async rewrites() {
    // 브라우저는 동일 출처(localhost:3000)로 호출 → 세션 쿠키 그대로 전달.
    // Next 서버가 백엔드(FastAPI)로 프록시한다.
    return [
      { source: "/auth/:path*", destination: `${BACKEND}/auth/:path*` },
      { source: "/transaction/:path*", destination: `${BACKEND}/transaction/:path*` },
      { source: "/ai/:path*", destination: `${BACKEND}/ai/:path*` },
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
