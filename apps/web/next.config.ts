import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: [
    "pdfjs-dist",
    "@napi-rs/canvas",
    "bullmq",
    "ioredis",
  ],
  transpilePackages: [
    "@framecraft/shared",
    "@framecraft/knowledge",
    "@framecraft/ai",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
