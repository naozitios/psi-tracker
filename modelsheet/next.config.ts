import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only packages loaded from node_modules rather than bundled.
  serverExternalPackages: ["exceljs", "pg", "@electric-sql/pglite"],
  // This app sits inside another Next.js project. Without this, Next picks
  // the parent folder as the workspace root and uses its PostCSS config.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
