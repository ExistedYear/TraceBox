import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Use Next's TypeScript API instead of the CLI subprocess. This keeps
    // production builds reliable across CI runners and local environments.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
