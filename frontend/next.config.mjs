/**
 * Two build modes:
 *
 *   default            server build for Docker / Fly.io / Railway
 *   NEXT_OUTPUT=export static build for GitHub Pages
 *
 * GitHub Pages serves a project site from a subpath
 * (https://USER.github.io/REPO/), so basePath and assetPrefix have to be set.
 * Next rewrites next/link and next/font URLs automatically, but NOT plain
 * fetch() calls — those use NEXT_PUBLIC_BASE_PATH, read in src/lib/constants.ts.
 */

const isExport = process.env.NEXT_OUTPUT === "export";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: isExport ? "export" : "standalone",
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  images: { unoptimized: true },
  trailingSlash: isExport,
};

export default nextConfig;
