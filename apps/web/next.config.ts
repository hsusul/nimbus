import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@nimbus/config", "@nimbus/contracts"],
  // Public-link tokens live in the route path, so framework request-path logs stay disabled.
  logging: { incomingRequests: false },
};

export default nextConfig;
