import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@siftloom/shared", "@siftloom/ui"],
  poweredByHeader: false
};

export default nextConfig;
