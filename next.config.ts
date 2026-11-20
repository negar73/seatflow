import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained server bundle in .next/standalone —
  // this is what the multi-stage Dockerfile ships to production.
  output: "standalone",
  reactStrictMode: true,
  // BullMQ and ioredis must stay outside the bundler: they rely on Node
  // internals (worker threads, dynamic requires) that webpack can't trace.
  serverExternalPackages: ["bullmq", "ioredis"],
};

export default nextConfig;
