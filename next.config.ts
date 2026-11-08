import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    devIndicators: false,
    // Versioned research backups can include a full 12 MiB journal plus JSON overhead.
    experimental: { serverActions: { bodySizeLimit: '34mb' } },
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
