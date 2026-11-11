import type { NextConfig } from "next";

// A static site: `next build` writes plain HTML, CSS and JS to `out/`. No server,
// no image optimizer, no telemetry endpoint.
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  poweredByHeader: false,
  // Type checking runs through `pnpm typecheck`, with the repo's TypeScript.
  typescript: { ignoreBuildErrors: true },
};

export default config;
