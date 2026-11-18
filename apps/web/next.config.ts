import type { NextConfig } from "next";

/**
 * Static export for Cloudflare Pages (free tier).
 * Security headers live in `public/_headers` (Cloudflare) — next.config
 * `headers()` is incompatible with `output: "export"`.
 */
const nextConfig: NextConfig = {
  output: "export",
  // Prefer /login/index.html so Cloudflare Pages + other static hosts resolve /login cleanly.
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  poweredByHeader: false,
};

export default nextConfig;
