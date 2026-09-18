import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // O Vitest 2 traz uma copia propria do Vite (5) enquanto o projeto usa o Vite 6.
  // O cast abaixo evita o conflito de TIPOS do plugin sem alterar o comportamento.
  plugins: [react() as never],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    testTimeout: 15_000,
  },
});
