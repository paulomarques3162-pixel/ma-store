import { describe, expect, it } from "vitest";
import {
  classifyMercadoPagoKey,
  resolveMercadoPagoCredentials,
  type MercadoPagoCredentialSet,
} from "../../src/services/mercadopago/credentials.js";

/**
 * Testes PUROS da separacao sandbox x producao das credenciais do Mercado Pago.
 * Nenhum segredo real e usado: os valores abaixo sao ficticios.
 */

const TEST_ACCESS = "TEST-00000000-0000-0000-0000-000000000000";
const TEST_PUBLIC = "TEST-11111111-1111-1111-1111-111111111111";
const PROD_ACCESS = "APP_USR-00000000-0000-0000-0000-000000000000";
const PROD_PUBLIC = "APP_USR-11111111-1111-1111-1111-111111111111";

const empty: MercadoPagoCredentialSet = { accessToken: "", publicKey: "", webhookSecret: "" };
const testSet = (over: Partial<MercadoPagoCredentialSet> = {}): MercadoPagoCredentialSet => ({
  accessToken: TEST_ACCESS,
  publicKey: TEST_PUBLIC,
  webhookSecret: "webhook-secret-de-teste",
  ...over,
});
const prodSet = (over: Partial<MercadoPagoCredentialSet> = {}): MercadoPagoCredentialSet => ({
  accessToken: PROD_ACCESS,
  publicKey: PROD_PUBLIC,
  webhookSecret: "webhook-secret-de-producao",
  ...over,
});

describe("classifyMercadoPagoKey", () => {
  it("classifica pelos prefixos oficiais do Mercado Pago", () => {
    expect(classifyMercadoPagoKey(TEST_ACCESS)).toBe("test");
    expect(classifyMercadoPagoKey(PROD_ACCESS)).toBe("production");
    expect(classifyMercadoPagoKey("valor-qualquer")).toBe("unknown");
    expect(classifyMercadoPagoKey("")).toBe("missing");
    expect(classifyMercadoPagoKey(undefined)).toBe("missing");
  });
});

describe("resolveMercadoPagoCredentials", () => {
  it("sandbox com credenciais de teste (TEST-) fica habilitado", () => {
    const r = resolveMercadoPagoCredentials({ paymentEnv: "sandbox", production: empty, sandbox: testSet() });
    expect(r.environment).toBe("sandbox");
    expect(r.source).toBe("sandbox");
    expect(r.tokenKind).toBe("test");
    expect(r.configured).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.missing).toEqual([]);
  });

  it("BLOQUEIA credencial de producao (APP_USR-) usada em sandbox", () => {
    const r = resolveMercadoPagoCredentials({ paymentEnv: "sandbox", production: prodSet(), sandbox: empty });
    expect(r.environment).toBe("sandbox");
    expect(r.tokenKind).toBe("production");
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toContain("PRODUCAO");
    expect(r.blockedReason).toContain("MERCADOPAGO_SANDBOX_ACCESS_TOKEN");
  });

  it("BLOQUEIA APP_USR- tambem nas variaveis dedicadas de sandbox", () => {
    const r = resolveMercadoPagoCredentials({
      paymentEnv: "sandbox",
      production: empty,
      sandbox: testSet({ accessToken: PROD_ACCESS, publicKey: PROD_PUBLIC }),
    });
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toContain("PRODUCAO");
  });

  it("producao com credencial de producao (APP_USR-) fica habilitado", () => {
    const r = resolveMercadoPagoCredentials({ paymentEnv: "production", production: prodSet(), sandbox: empty });
    expect(r.environment).toBe("production");
    expect(r.source).toBe("production");
    expect(r.tokenKind).toBe("production");
    expect(r.configured).toBe(true);
    expect(r.blocked).toBe(false);
  });

  it("BLOQUEIA credencial de teste (TEST-) usada em producao", () => {
    const r = resolveMercadoPagoCredentials({ paymentEnv: "production", production: testSet(), sandbox: empty });
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toContain("TESTE");
  });

  it("prefere as variaveis dedicadas de sandbox quando presentes", () => {
    const r = resolveMercadoPagoCredentials({
      paymentEnv: "sandbox",
      production: prodSet(),
      sandbox: testSet(),
    });
    expect(r.source).toBe("sandbox");
    expect(r.accessToken).toBe(TEST_ACCESS);
    expect(r.blocked).toBe(false);
  });

  it("bloqueia formato de token desconhecido", () => {
    const r = resolveMercadoPagoCredentials({
      paymentEnv: "sandbox",
      production: empty,
      sandbox: testSet({ accessToken: "token-sem-prefixo-oficial" }),
    });
    expect(r.tokenKind).toBe("unknown");
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toContain("nao reconhecido");
  });

  it("bloqueia Public Key que nao corresponde ao ambiente", () => {
    const r = resolveMercadoPagoCredentials({
      paymentEnv: "sandbox",
      production: empty,
      sandbox: testSet({ publicKey: PROD_PUBLIC }),
    });
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toContain("Public Key");
  });

  it("reporta as variaveis ausentes sem inventar valores", () => {
    const r = resolveMercadoPagoCredentials({ paymentEnv: "sandbox", production: empty, sandbox: empty });
    expect(r.configured).toBe(false);
    expect(r.missing).toEqual([
      "MERCADOPAGO_SANDBOX_ACCESS_TOKEN",
      "MERCADOPAGO_SANDBOX_PUBLIC_KEY",
      "MERCADOPAGO_SANDBOX_WEBHOOK_SECRET",
    ]);
  });

  it("em sandbox sem variaveis dedicadas, cai no conjunto historico (compatibilidade)", () => {
    const r = resolveMercadoPagoCredentials({ paymentEnv: "sandbox", production: testSet(), sandbox: empty });
    expect(r.source).toBe("production");
    expect(r.accessToken).toBe(TEST_ACCESS);
    expect(r.blocked).toBe(false);
  });
});
