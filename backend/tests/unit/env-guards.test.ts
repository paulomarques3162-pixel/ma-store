import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Guarda-corpos de producao do `env.ts`.
 *
 * O modulo `src/env.ts` valida o ambiente no momento do import e encerra o
 * processo (`process.exit(1)`) em configuracoes inseguras. Aqui reimportamos o
 * modulo com `vi.resetModules()` e `process.exit` mockado para provar que:
 *   - producao real NAO sobe com pagamento `mock`;
 *   - producao real NAO sobe com `mercadopago` sem credenciais completas;
 *   - producao NAO sobe com CORS apontando para localhost;
 *   - sandbox continua funcionando com `mock` (dev/staging).
 */

const BASE: Record<string, string> = {
  NODE_ENV: "production",
  APP_ENV: "production",
  APP_VERSION: "test",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  JWT_SECRET: "0123456789abcdef0123456789abcdef",
  WEBHOOK_SECRET: "webhook-secret-para-teste",
  CORS_ORIGINS: "https://loja.exemplo.com",
  STORAGE_DRIVER: "local",
  LOG_LEVEL: "silent",
};

type Loaded = { env: typeof import("../../src/env.js").env; errorSpy: unknown };

async function loadEnv(overrides: Record<string, string>): Promise<Loaded> {
  vi.resetModules();
  const merged = { ...BASE, ...overrides };
  for (const [key, value] of Object.entries(merged)) vi.stubEnv(key, value);

  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`PROCESS_EXIT_${code ?? 0}`);
  }) as never);

  const mod = await import("../../src/env.js");
  return { env: mod.env, errorSpy: console.error };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("env — guarda-corpos de producao", () => {
  it("FALHA ao subir em producao real com PAYMENT_PROVIDER=mock", async () => {
    await expect(loadEnv({ PAYMENT_ENV: "production", PAYMENT_PROVIDER: "mock" })).rejects.toThrow(
      /PROCESS_EXIT_1/,
    );
  });

  it("FALHA ao subir em producao real com mercadopago sem credenciais", async () => {
    await expect(loadEnv({ PAYMENT_ENV: "production", PAYMENT_PROVIDER: "mercadopago" })).rejects.toThrow(
      /PROCESS_EXIT_1/,
    );
  });

  it("FALHA ao subir em producao com CORS apontando para localhost", async () => {
    await expect(
      loadEnv({
        NODE_ENV: "production",
        CORS_ORIGINS: "http://localhost:5173",
        PAYMENT_ENV: "sandbox",
        PAYMENT_PROVIDER: "mock",
      }),
    ).rejects.toThrow(/PROCESS_EXIT_1/);
  });

  it("SOBE em sandbox com mock (desenvolvimento/staging)", async () => {
    const { env } = await loadEnv({ PAYMENT_ENV: "sandbox", PAYMENT_PROVIDER: "mock" });
    expect(env.paymentProvider).toBe("mock");
    expect(env.isSandboxPayments).toBe(true);
  });

  it("SOBE em producao com mercadopago e todas as credenciais", async () => {
    const { env } = await loadEnv({
      PAYMENT_ENV: "production",
      PAYMENT_PROVIDER: "mercadopago",
      MERCADOPAGO_ACCESS_TOKEN: "APP_USR-token",
      MERCADOPAGO_PUBLIC_KEY: "APP_USR-public",
      MERCADOPAGO_WEBHOOK_SECRET: "mp-webhook-secret",
      PUBLIC_API_URL: "https://api.exemplo.com",
    });
    expect(env.paymentProvider).toBe("mercadopago");
    expect(env.isMercadoPagoEnabled).toBe(true);
    expect(env.mercadoPagoMissing).toEqual([]);
  });

  it("considera PUBLIC_API_URL obrigatoria para habilitar o Mercado Pago", async () => {
    const { env } = await loadEnv({
      PAYMENT_ENV: "sandbox",
      PAYMENT_PROVIDER: "mercadopago",
      MERCADOPAGO_ACCESS_TOKEN: "APP_USR-token",
      MERCADOPAGO_PUBLIC_KEY: "APP_USR-public",
      MERCADOPAGO_WEBHOOK_SECRET: "mp-webhook-secret",
      PUBLIC_API_URL: "",
    });
    expect(env.isMercadoPagoEnabled).toBe(false);
    expect(env.mercadoPagoMissing).toContain("PUBLIC_API_URL");
  });
});
