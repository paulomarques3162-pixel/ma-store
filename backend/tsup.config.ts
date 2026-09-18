import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node20",
  platform: "node",
  sourcemap: true,
  clean: true,
  splitting: false,
  // Prisma client must stay external: it loads its query engine at runtime.
  external: ["@prisma/client", ".prisma", "@prisma/engines"],
});
