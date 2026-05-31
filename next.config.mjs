import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const codexTraceIncludes = [
  "./node_modules/@openai/codex/**/*",
  "./node_modules/@openai/codex-sdk/**/*",
  "./node_modules/@openai/codex-linux-x64/**/*",
  "./node_modules/@openai/codex-linux-arm64/**/*",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this project so Next.js does not infer a parent
  // directory as the root when other lockfiles exist higher in the tree.
  outputFileTracingRoot: projectRoot,
  outputFileTracingIncludes: {
    "/api/ai/auth/sign-in": codexTraceIncludes,
    "/api/ai/auth/status": codexTraceIncludes,
    "/api/ai/chat": codexTraceIncludes,
  },
};

export default nextConfig;
