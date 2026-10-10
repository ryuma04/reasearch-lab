import type { NextConfig } from "next";

/**
 * API transport:
 * - Direct mode (default): the browser calls NEXT_PUBLIC_API_BASE_URL (the Go backend) with
 *   credentials; the backend must allow this origin via CORS with credentials.
 * - Proxy mode: set NEXT_PUBLIC_API_BASE_URL=/api and API_PROXY_TARGET=http://localhost:8080.
 *   Next rewrites /api/* to the Go backend so the session cookie is first-party.
 *   This is a transparent rewrite only — no backend logic lives in Next.js.
 */
const proxyTarget = process.env.API_PROXY_TARGET;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets a second dev server run from the same folder (e.g. against another API port).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async rewrites() {
    if (!proxyTarget) return [];
    return [{ source: "/api/:path*", destination: `${proxyTarget.replace(/\/$/, "")}/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
