import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Juros configuráveis por produto — integração REAL (rotas + PostgreSQL).
 *
 * O gateway é dublado (não há credencial de sandbox), mas o cálculo, a
 * persistência, o snapshot imutável e a validação do valor cobrado são reais.
 */

vi.mock("../../src/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/env.js")>();
  return {
    env: {
      ...actual.env,
      PAYMENT_PROVIDER: "mercadopago",
      PAYMENT_ENV: "sandbox",
      paymentProvider: "mercadopago",
      MERCADOPAGO_ACCESS_TOKEN: "TEST-access-token",
      MERCADOPAGO_PUBLIC_KEY: "TEST-public-key",
      MERCADOPAGO_WEBHOOK_SECRET: "webhook-secret-de-teste",
      MERCADOPAGO_SANDBOX_ACCESS_TOKEN: "TEST-access-token",
      MERCADOPAGO_SANDBOX_PUBLIC_KEY: "TEST-public-key",
      MERCADOPAGO_SANDBOX_WEBHOOK_SECRET: "webhook-secret-de-teste",
      PUBLIC_API_URL: "https://api.exemplo.test",
      isMercadoPagoEnabled: true,
      mercadoPagoMissing: [],
    },
  };
});

vi.mock("../../src/services/mercadopago/index.js", () => ({
  createPixPayment: vi.fn(),
  createBoletoPayment: vi.fn(),
  createCardPayment: vi.fn(),
  getMercadoPagoPayment: vi.fn(),
  notificationUrl: () => "https://api.exemplo.test/api/payments/webhooks/mercadopago",
}));

import { api, createAdmin, db, makeApp, resetDatabase } from "../helpers";
import { createCardPayment, createPixPayment } from "../../src/services/mercadopago/index";

const CLIENTE = { nome: "Cliente Juros", whatsapp: "(19) 99999-2222", email: "juros@teste.local" };
const ENDERECO = { cep: "13630000", logradouro: "Rua Juros", numero: "10", bairro: "Centro", cidade: "Pirassununga", uf: "SP" };

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  const prisma = await db();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(createCardPayment).mockReset();
  vi.mocked(createPixPayment).mockReset();
});

function cardResult(amount: number) {
  return {
    id: "MP-CARD-1",
    status: "PENDING" as const,
    mpStatus: "in_process",
    statusDetail: null,
    amount,
    paymentMethodId: "visa",
    externalReference: "ref",
    pix: null,
    boleto: null,
    raw: {},
  };
}

async function createProduct(
  token: string,
  over: { name: string; price: number; interest?: Record<string, unknown> | null; stock?: number },
) {
  const response = await api(app, {
    method: "POST",
    url: "/api/admin/products",
    token,
    payload: {
      name: over.name,
      price: over.price,
      stock: over.stock ?? 10,
      hasShipping: true,
      active: true,
      ...(over.interest !== undefined ? { interest: over.interest } : {}),
    },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data as { id: string; price: number; interestRule?: unknown };
}

async function shippingSelection(productId: string, quantity = 1) {
  const quote = await api(app, {
    method: "POST",
    url: "/api/shipping",
    payload: { cep: ENDERECO.cep, items: [{ id: productId, nome: "Produto", quantidade: quantity, peso_unitario: 0.5 }] },
  });
  expect(quote.status, JSON.stringify(quote.body)).toBe(200);
  const options = (quote.body as { options: Array<{ id: string; valor: number }> }).options;
  const option = options.find((entry) => Number(entry.valor) > 0) ?? options[0]!;
  return { id: option.id, price: Number(option.valor) || 0 };
}

async function createOrder(productId: string, pagamento: Record<string, unknown>) {
  const frete = await shippingSelection(productId);
  const response = await api(app, {
    method: "POST",
    url: "/api/pedidos",
    payload: {
      cliente: CLIENTE,
      endereco: ENDERECO,
      produtos: [{ id: productId, quantidade: 1 }],
      frete,
      pagamento,
    },
  });
  return response;
}

describe("Juros por produto — integração", () => {
  it("admin configura juros individuais e eles são persistidos e retornados", async () => {
    const admin = await createAdmin(app);
    const product = await createProduct(admin.token, {
      name: "Perfume com juros",
      price: 100,
      interest: { enabled: true, type: "PERCENT_SIMPLE", rate: 10, payer: "CUSTOMER", maxInstallments: 6 },
    });

    const detail = await api(app, { method: "GET", url: `/api/admin/products/${product.id}`, token: admin.token });
    const rule = (detail.body.data as { interestRule: { enabled: boolean; rate: string; type: string } }).interestRule;
    expect(rule.enabled).toBe(true);
    expect(rule.type).toBe("PERCENT_SIMPLE");
    expect(Number(rule.rate)).toBe(10);
  });

  it("a cotação pública calcula os juros no backend", async () => {
    const admin = await createAdmin(app);
    const product = await createProduct(admin.token, {
      name: "Perfume juros cotação",
      price: 100,
      interest: { enabled: true, type: "PERCENT_SIMPLE", rate: 10, payer: "CUSTOMER", maxInstallments: 6 },
    });

    const quote = await api(app, {
      method: "POST",
      url: "/api/interest/quote",
      payload: { items: [{ productId: product.id, quantity: 1 }], method: "CREDIT_CARD", installments: 3 },
    });
    expect(quote.status).toBe(200);
    const data = quote.body.data as { applied: boolean; subtotal: number; interest: number; total: number; installments: number };
    expect(data.applied).toBe(true);
    expect(data.subtotal).toBe(100);
    expect(data.interest).toBeGreaterThan(0);
    expect(data.total).toBeGreaterThan(100);
    expect(data.installments).toBe(3);

    // PIX não recebe juros.
    const pix = await api(app, {
      method: "POST",
      url: "/api/interest/quote",
      payload: { items: [{ productId: product.id, quantity: 1 }], method: "PIX", installments: 3 },
    });
    expect((pix.body.data as { applied: boolean; total: number }).applied).toBe(false);
    expect((pix.body.data as { total: number }).total).toBe(100);
  });

  it("pedido no cartão cobra o total COM juros e guarda o snapshot", async () => {
    const admin = await createAdmin(app);
    const product = await createProduct(admin.token, {
      name: "Perfume cartão",
      price: 100,
      interest: { enabled: true, type: "PERCENT_SIMPLE", rate: 10, payer: "CUSTOMER", maxInstallments: 6 },
    });

    vi.mocked(createCardPayment).mockResolvedValue(cardResult(110) as never);

    const response = await createOrder(product.id, {
      metodo: "CREDIT_CARD",
      card: { token: "tok_teste", installments: 3 },
      idempotencyKey: "idem-juros-card",
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const pedido = (response.body.data as { pedido: Record<string, unknown> }).pedido;
    expect(Number(pedido["juros_total"])).toBeGreaterThan(0);
    expect(Number(pedido["parcelas"])).toBe(3);
    expect(Number(pedido["total"])).toBeGreaterThan(Number(pedido["subtotal"]));

    const items = pedido["produtos_carrinho"] as Array<Record<string, number>>;
    expect(items[0]!["total_final"]!).toBeGreaterThan(items[0]!["total_original"]!);

    // O valor enviado ao gateway é o total recalculado (com juros), sem divergência.
    expect(vi.mocked(createCardPayment).mock.calls[0]?.[0]?.amount).toBe(Number(pedido["total"]));
  });

  it("PIX não recebe juros mesmo com regra ativa", async () => {
    const admin = await createAdmin(app);
    const product = await createProduct(admin.token, {
      name: "Perfume pix",
      price: 100,
      interest: { enabled: true, type: "PERCENT_SIMPLE", rate: 10, payer: "CUSTOMER", maxInstallments: 6 },
    });

    vi.mocked(createPixPayment).mockResolvedValue({
      id: "MP-PIX-1",
      status: "PENDING",
      mpStatus: "pending",
      statusDetail: null,
      amount: 100,
      paymentMethodId: "pix",
      externalReference: "ref",
      pix: { qrCode: "00020126", qrCodeBase64: "aGk=", ticketUrl: null },
      boleto: null,
      raw: {},
    } as never);

    const response = await createOrder(product.id, { metodo: "PIX", idempotencyKey: "idem-juros-pix" });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const pedido = (response.body.data as { pedido: Record<string, unknown> }).pedido;
    expect(Number(pedido["juros_total"])).toBe(0);
  });

  it("usa a regra PADRÃO quando o produto não tem regra individual", async () => {
    const admin = await createAdmin(app);
    const product = await createProduct(admin.token, { name: "Perfume padrão", price: 100, interest: null });

    const put = await api(app, {
      method: "PUT",
      url: "/api/admin/interest",
      token: admin.token,
      payload: { enabled: true, type: "FIXED", rate: 20, payer: "CUSTOMER", maxInstallments: 6 },
    });
    expect(put.status).toBe(200);

    const quote = await api(app, {
      method: "POST",
      url: "/api/interest/quote",
      payload: { items: [{ productId: product.id, quantity: 1 }], method: "CREDIT_CARD", installments: 2 },
    });
    const data = quote.body.data as { applied: boolean; total: number };
    expect(data.applied).toBe(true);
    expect(data.total).toBe(120);
  });

  it("alterar a regra depois NÃO muda pedidos já criados (snapshot imutável)", async () => {
    const admin = await createAdmin(app);
    const product = await createProduct(admin.token, {
      name: "Perfume snapshot",
      price: 100,
      interest: { enabled: true, type: "FIXED", rate: 10, payer: "CUSTOMER", maxInstallments: 6 },
    });

    vi.mocked(createCardPayment).mockResolvedValue(cardResult(110) as never);
    const response = await createOrder(product.id, {
      metodo: "CREDIT_CARD",
      card: { token: "tok", installments: 2 },
      idempotencyKey: "idem-snapshot",
    });
    const pedido = (response.body.data as { pedido: Record<string, unknown> }).pedido;
    const totalOriginal = Number(pedido["total"]);

    // Admin dobra os juros.
    await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${product.id}`,
      token: admin.token,
      payload: { interest: { enabled: true, type: "FIXED", rate: 80, payer: "CUSTOMER", maxInstallments: 6 } },
    });

    const token = pedido["token_rastreio_unico"] as string;
    const reread = await api(app, { method: "GET", url: `/api/rastreio/${token}` });
    const after = (reread.body.data as { pedido: { total: number; juros_total: number } }).pedido;
    expect(after.total).toBe(totalOriginal);
    expect(after.juros_total).toBe(10);
  });

  it("usuário comum não acessa a configuração de juros", async () => {
    const response = await api(app, { method: "GET", url: "/api/admin/interest" });
    expect(response.status).toBe(401);
  });
});
