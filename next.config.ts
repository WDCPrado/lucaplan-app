import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  allowedDevOrigins: ["pcwilly.taild2feb2.ts.net", "100.101.76.33"],
  // Solo /sw.js: sin caché HTTP (updateViaCache:none + no-store ⇒ nunca queda un SW viejo
  // pegado) y CSP acotada. Sin headers globales para no afectar OAuth/assets externos.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          { key: "Cache-Control", value: "no-store" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ]
  },
}

export default nextConfig
