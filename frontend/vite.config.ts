import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Build do WebApp da MA STORE.
 *
 * Saida em `dist/` pronta para a Vercel. O "code splitting" e automatico:
 * as rotas sao carregadas com React.lazy, gerando chunks sob demanda.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Em desenvolvimento a API roda em 3333. Isso evita CORS e mantem o
      // frontend consumindo caminhos relativos (/api/...) em qualquer ambiente.
      "/api": {
        target: process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:3333",
        changeOrigin: true,
      },
      // Uploads do driver local são servidos pela API em /uploads. O proxy
      // garante que o preview relativo (/uploads/x.jpg) funcione em dev.
      "/uploads": {
        target: process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:3333",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": {
        target: process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:3333",
        changeOrigin: true,
      },
      "/uploads": {
        target: process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:3333",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
    cssCodeSplit: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});
