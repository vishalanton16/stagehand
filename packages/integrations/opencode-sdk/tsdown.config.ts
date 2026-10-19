import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    worker: "src/worker.ts",
    "mcp-wrapper": "src/mcp-wrapper.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node24",
  dts: { sourcemap: true },
  sourcemap: true,
  outDir: "dist",
});
