import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@nimbus/config", "@nimbus/contracts"],
};

export default nextConfig;
