import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this project so Next.js does not infer a parent
  // directory as the root when other lockfiles exist higher in the tree.
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
