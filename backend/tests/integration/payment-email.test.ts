import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HTTP 402 no pagamento de pedido existente: o pagador precisa de um e-mail
 * REAL. Nunca enviamos `comprador@mastore.local`. Sem e-mail, o backend
 * devolve 422 claro (VALIDATION_ERROR) e NAO chama o gateway.
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

import { api, createShopFixture, db, makeApp, resetDatabase } from "../helpers";
import { createPixPayment } from "../../src/services/mercadopago/index";

const ENDERECO = { cep: "13630000", logradouro: "Rua Email", numero: "10", bairro: "Centro", cidade: "Pirassununga", uf: "SP" };

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
  vi.mocked(createPixPayment).mockReset();
});

function pixResult(amount = 100, email = "nao-usado@mp.test") {
  return {
    id: "MP-PIX-E1",
    status: "PENDING" as const,
    mpStatus: "pending",
    statusDetail: null,
    amount,
    paymentMethodId: "pix",
    externalReference: "ref",
    pix: { qrCode: "00020126", qrCodeBase64: "aGk=", ticketUrl: null },
    boleto: null,
    raw: {},
    payerEmail: email,
  };
}

async function shippingSelection(productId: string) {
  const quote = await api(app, {
    method: "POST",
    url: "/api/shipping",
    payload: { cep: ENDERECO.cep, items: [{ id: productId, nome: "P", quantidade: 1, peso_unitario: 0.5 }] },
  });
  const options = (quote.body as { options: Array<{ id: string; valor: number }> }).options;
  const option = options.find((entry) => Number(entry.valor) > 0) ?? options[0]!;
  return { id: option.id };
}

async function createOrder(opts: { productId: string; email?: string; metodo?: "PIX" | "COMBINAR" }) {
  const frete = await shippingSelection(opts.productId);
  return api(app, {
    method: "POST",
    url: "/api/pedidos",
    payload: {
      cliente: { nome: "Cliente Email", whatsapp: "11999990000", email: opts.email },
      endereco: ENDERECO,
      produtos: [{ id: opts.productId, quantidade: 1 }],
      frete,
      pagamento: { metodo: opts.metodo ?? "PIX", idempotencyKey: `idem-email-${Date.now()}-${Math.random()}` },
    },
  });
}

describe("E-mail do pagador no pagamento de pedido existente", () => {
  it("usa o e-mail REAL do pedido ao criar a cobrança", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult() as never);
    const { product } = await createShopFixture({ stock: 5, price: "100.00" });
    const response = await createOrder({ productId: product.id, email: "cliente.real@teste.local" });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(vi.mocked(createPixPayment).mock.calls[0]?.[0]?.payer.email).toBe("cliente.real@teste.local");
  });

  it("pedido SEM e-mail: retry devolve 422 e NÃO chama o gateway (nunca usa e-mail fictício)", async () => {
    const { product } = await createShopFixture({ stock: 5, price: "100.00" });
    const created = await createOrder({ productId: product.id, metodo: "COMBINAR" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const pedido = (created.body.data as { pedido: { token_rastreio_unico: string; pagamento_email_necessario: boolean } }).pedido;
    expect(pedido.pagamento_email_necessario).toBe(true);

    const retry = await api(app, {
      method: "POST",
      url: `/api/pedidos/${pedido.token_rastreio_unico}/pagamento`,
      payload: { metodo: "PIX", idempotencyKey: "idem-sem-email-123" },
    });
    expect(retry.status).toBe(422);
    expect((retry.body.error as { code: string }).code).toBe("VALIDATION_ERROR");
    expect((retry.body.error as { message: string }).message).toContain("e-mail");
    expect(vi.mocked(createPixPayment).mock.calls.length).toBe(0);
  });

  it("cliente informa um e-mail válido no rastreio: cobrança é gerada e o e-mail é persistido", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult() as never);
    const { product } = await createShopFixture({ stock: 5, price: "100.00" });
    const created = await createOrder({ productId: product.id, metodo: "COMBINAR" });
    const pedido = (created.body.data as { pedido: { token_rastreio_unico: string } }).pedido;

    const retry = await api(app, {
      method: "POST",
      url: `/api/pedidos/${pedido.token_rastreio_unico}/pagamento`,
      payload: {
        metodo: "PIX",
        payer: { email: "informado.no.rastreio@teste.local" },
        idempotencyKey: "idem-email-informado-1",
      },
    });
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(vi.mocked(createPixPayment).mock.calls[0]?.[0]?.payer.email).toBe("informado.no.rastreio@teste.local");

    // Persistido no pedido: uma nova tentativa SEM informar o e-mail funciona.
    const prisma = await db();
    const saved = await prisma.pedido.findFirstOrThrow();
    expect(saved.clienteEmail).toBe("informado.no.rastreio@teste.local");

    const again = await api(app, {
      method: "POST",
      url: `/api/pedidos/${pedido.token_rastreio_unico}/pagamento`,
      payload: { metodo: "PIX", idempotencyKey: "idem-email-informado-2" },
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(vi.mocked(createPixPayment).mock.calls[1]?.[0]?.payer.email).toBe("informado.no.rastreio@teste.local");
  });

  it("e-mail inválido informado pelo cliente é recusado (422) sem chamar o gateway", async () => {
    const { product } = await createShopFixture({ stock: 5, price: "100.00" });
    const created = await createOrder({ productId: product.id, metodo: "COMBINAR" });
    const pedido = (created.body.data as { pedido: { token_rastreio_unico: string } }).pedido;

    const retry = await api(app, {
      method: "POST",
      url: `/api/pedidos/${pedido.token_rastreio_unico}/pagamento`,
      payload: {
        metodo: "PIX",
        payer: { email: "email-invalido" },
        idempotencyKey: "idem-email-invalido-1",
      },
    });
    expect(retry.status).toBe(422);
    expect(vi.mocked(createPixPayment).mock.calls.length).toBe(0);
  });

  it("rejeição do gateway retorna PAYMENT_ERROR (402) e não marca o pedido como pago", async () => {
    vi.mocked(createPixPayment).mockRejectedValue({
      status: 400,
      message: "Invalid payment data",
      cause: [{ code: "1", description: "payer.email invalid" }],
    } as never);
    const { product } = await createShopFixture({ stock: 5, price: "100.00" });
    const created = await createOrder({ productId: product.id, email: "cliente.real@teste.local" });
    const pedido = (created.body.data as { pedido: { token_rastreio_unico: string } }).pedido;

    // O checkout já tentou criar a cobrança e falhou; o pedido fica "Falha".
    const prisma = await db();
    const saved = await prisma.pedido.findFirstOrThrow();
    expect(saved.pagamentoStatus).not.toBe("Pago");

    const retry = await api(app, {
      method: "POST",
      url: `/api/pedidos/${pedido.token_rastreio_unico}/pagamento`,
      payload: { metodo: "PIX", idempotencyKey: "idem-gateway-reject-1" },
    });
    expect(retry.status).toBe(402);
    expect((retry.body.error as { code: string }).code).toBe("PAYMENT_ERROR");
    const after = await prisma.pedido.findFirstOrThrow();
    expect(after.pagamentoStatus).not.toBe("Pago");
  });

  it("nunca envia comprador@mastore.local ao gateway", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult() as never);
    const { product } = await createShopFixture({ stock: 5, price: "100.00" });
    await createOrder({ productId: product.id, email: "real@teste.local" });
    for (const call of vi.mocked(createPixPayment).mock.calls) {
      expect(call[0]?.payer.email).not.toBe("comprador@mastore.local");
      expect(call[0]?.payer.email).toMatch(/@/);
    }
  });
});
