import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_CARTO_API_KEY:
      process.env.NEXT_PUBLIC_CARTO_API_KEY || process.env.CARTO_API_KEY || "",
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
