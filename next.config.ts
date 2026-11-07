import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    devIndicators: false,
    // /whats-new was live briefly before the changelog replaced it
    async redirects() {
        return [{ source: '/whats-new', destination: '/changelog', permanent: true }];
    },
    turbopack: {
        root: process.cwd(),
    },
    // No remote image hosts: next/image sources are local assets.
};

export default nextConfig;
