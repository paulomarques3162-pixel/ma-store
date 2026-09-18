import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "./env.js";

/**
 * Cliente Prisma unico (singleton).
 *
 * Em desenvolvimento o hot-reload recria o modulo; guardamos a instancia no
 * `globalThis` para nao vazar conexoes a cada reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      env.NODE_ENV === "development"
        ? [{ emit: "event", level: "query" }, "warn", "error"]
        : ["warn", "error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** Verifica a conexao com o banco (usado pelo /api/health e pelo laboratorio). */
export async function checkDatabase(): Promise<{ connected: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { connected: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      connected: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export { Prisma };
export type { PrismaClient };
