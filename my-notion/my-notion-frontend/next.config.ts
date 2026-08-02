import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the Docker runtime stage to be a slim `node:22-slim` copy of
  // just `.next/standalone` + `.next/static` + `public` — no `npm install` at
  // container start. See my-notion-frontend/Dockerfile.
  output: "standalone",
};

export default nextConfig;
