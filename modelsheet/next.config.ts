import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ExcelJS is only used by the export route; keep it out of the server bundle.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
