import { defineConfig } from "vitest/config";

/**
 * Execucao RAPIDA apenas dos testes unitarios, sem banco de dados.
 *
 * A suite completa (`vitest.config.ts`) sobe o Prisma e exige um PostgreSQL de
 * teste. Este perfil roda os modulos puros (mapeamento de status, assinatura do
 * webhook, PIX, motor de frete) sem infraestrutura — util em CI rapido e no
 * desenvolvimento local.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
  },
});
