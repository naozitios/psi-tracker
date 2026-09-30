import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only packages loaded from node_modules rather than bundled.
  serverExternalPackages: ["exceljs", "pg", "@electric-sql/pglite"],
};

export default nextConfig;
