import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integracao REAL do fluxo de pagamento (Mercado Pago) com o gateway MOCKADO.
 *
 * O SDK do Mercado Pago e substituido por um dublê para que a suite nao faca
 * chamadas de rede. O que validamos aqui e o comportamento da MA STORE:
 *  - PIX criado com dados reais do gateway (QR/copia e cola);
 *  - valor recalculado no servidor;
 *  - webhook com assinatura valida/invalida;
 *  - idempotencia do evento e do pedido;
 *  - atualizacao de status/estoque;
 *  - recusa nao marca como pago.
 *
 * Requer PostgreSQL de teste (mesma infra da suite de integracao).
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

import {
  api,
  createShopFixture,
  db,
  enableLocalShippingForGuest,
  makeApp,
  quoteGuestShipping,
  resetDatabase,
} from "../helpers";
import { buildSignatureHeader } from "../../src/services/mercadopago/signature";
import { createPixPayment, getMercadoPagoPayment } from "../../src/services/mercadopago/index";

const WEBHOOK_SECRET = "webhook-secret-de-teste";

type MpResult = {
  id: string;
  status: "PENDING" | "APPROVED" | "DECLINED";
  mpStatus: string;
  statusDetail: string | null;
  amount: number;
  paymentMethodId: string;
  externalReference: string;
  pix: { qrCode: string | null; qrCodeBase64: string | null; ticketUrl: string | null } | null;
  boleto: null;
  raw: Record<string, unknown>;
};

function pixResult(overrides: Partial<MpResult> = {}): MpResult {
  return {
    id: "MP-PAY-1",
    status: "PENDING",
    mpStatus: "pending",
    statusDetail: "pending_waiting_transfer",
    amount: 120,
    paymentMethodId: "pix",
    externalReference: "ref",
    pix: {
      qrCode: "00020126580014BR.GOV.BCB.PIX0136chave-de-teste5204000053039865802BR",
      qrCodeBase64: "iVBORw0KGgo=",
      ticketUrl: "https://mercadopago.test/ticket",
    },
    boleto: null,
    raw: {},
    ...overrides,
  };
}

const CLIENTE = { nome: "Cliente Guest Teste", whatsapp: "(19) 99999-0000", email: "guest@teste.local" };
const ENDERECO = {
  cep: "13630000",
  logradouro: "Rua de Teste",
  numero: "100",
  bairro: "Centro",
  cidade: "Pirassununga",
  uf: "SP",
};

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
  vi.mocked(getMercadoPagoPayment).mockReset();
});

const SESSION = "sess-guest";

/** Cria produto + motor de frete proprio + cotacao real e monta o pedido Guest. */
async function buildGuestPayload(
  pagamento: Record<string, unknown>,
  produtos?: Array<{ id: string; quantidade: number }>,
) {
  const { product } = await createShopFixture({ stock: 10, price: "100.00" });
  // O motor de frete proprio exige peso/dimensoes para calcular a cotacao.
  const prisma = await db();
  await prisma.product.update({
    where: { id: product.id },
    data: { weightGrams: 500, heightCm: 10, widthCm: 5, lengthCm: 2 },
  });
  await enableLocalShippingForGuest(app);
  const quote = await quoteGuestShipping(app, product.id, 1, ENDERECO.cep);
  const payload = {
    cliente: CLIENTE,
    endereco: ENDERECO,
    produtos: produtos ?? [{ id: product.id, quantidade: 1 }],
    frete: { quoteId: quote.quoteId, methodId: quote.first.methodId, valor: 0 },
    pagamento,
    sessionId: SESSION,
  };
  return { payload, product, quote };
}

async function createPedido(pagamento: Record<string, unknown>, produtos?: Array<{ id: string; quantidade: number }>) {
  const { payload, product, quote } = await buildGuestPayload(pagamento, produtos);
  const response = await api(app, { method: "POST", url: "/api/pedidos", payload });
  return { response, product, quote };
}

describe("Mercado Pago — criacao de PIX no checkout Guest", () => {
  it("cria o pedido e devolve QR/copia e cola reais do gateway", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult({ amount: 120 }) as never);

    const { response, product } = await createPedido({ metodo: "PIX", idempotencyKey: "idem-pix-1" });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const data = response.body.data as {
      pedido: Record<string, unknown>;
      pixQrCode: string | null;
    };
    expect(data.pedido.pagamento_provider).toBe("mercadopago");
    expect(data.pedido.pagamento_provider_ref).toBe("MP-PAY-1");
    expect(data.pedido.pagamento_status).toBe("Pendente");
    expect(data.pedido.pagamento_payload).toContain("BR.GOV.BCB.PIX");
    expect(data.pixQrCode).toMatch(/^data:image\/png;base64,/);

    // O valor enviado ao gateway e o total recalculado no servidor (100 + 20).
    expect(vi.mocked(createPixPayment).mock.calls[0]?.[0]?.amount).toBe(120);

    // Estoque reservado, ainda nao vendido.
    const prisma = await db();
    const saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(saved.stock).toBe(9);
    expect(saved.reservedStock).toBe(1);
    expect(saved.soldStock).toBe(0);
  });

  it("nao duplica pedido em duplo clique (mesma idempotency key)", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult({ amount: 120 }) as never);

    const { payload } = await buildGuestPayload({ metodo: "PIX", idempotencyKey: "idem-duplo-clique" });

    const first = await api(app, { method: "POST", url: "/api/pedidos", payload });
    const second = await api(app, { method: "POST", url: "/api/pedidos", payload });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstId = (first.body.data as { pedido: { id: number } }).pedido.id;
    const secondId = (second.body.data as { pedido: { id: number } }).pedido.id;
    expect(secondId).toBe(firstId);

    const prisma = await db();
    expect(await prisma.pedido.count()).toBe(1);
    // O gateway foi acionado apenas uma vez.
    expect(vi.mocked(createPixPayment).mock.calls.length).toBe(1);
  });
});

describe("Mercado Pago — webhook", () => {
  async function approvedWebhook() {
    vi.mocked(getMercadoPagoPayment).mockResolvedValue(
      pixResult({ status: "APPROVED", mpStatus: "approved", statusDetail: "accredited", amount: 120 }) as never,
    );
    const signature = buildSignatureHeader({
      dataId: "MP-PAY-1",
      requestId: "req-1",
      secret: WEBHOOK_SECRET,
    });
    return api(app, {
      method: "POST",
      url: "/api/payments/webhooks/mercadopago",
      headers: { "x-signature": signature, "x-request-id": "req-1" },
      payload: { id: "evt-1", type: "payment", data: { id: "MP-PAY-1" } },
    });
  }

  it("ACEITA assinatura valida e marca o pedido como Pago", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult({ amount: 120 }) as never);
    const { response, product } = await createPedido({ metodo: "PIX", idempotencyKey: "idem-webhook-ok" });
    expect(response.status).toBe(201);

    const webhook = await approvedWebhook();
    expect(webhook.status, JSON.stringify(webhook.body)).toBe(200);
    expect((webhook.body.data as { status: string }).status).toBe("PROCESSED");

    const prisma = await db();
    const pedido = await prisma.pedido.findFirstOrThrow();
    expect(pedido.pagamentoStatus).toBe("Pago");
    expect(pedido.pagamentoProviderStatus).toBe("approved");
    expect(pedido.statusAtual).toBe("Empacotando Produto");
    expect(pedido.pagoEm).not.toBeNull();

    const saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(saved.soldStock).toBe(1);
    expect(saved.reservedStock).toBe(0);
  });

  it("REJEITA assinatura invalida e nao atualiza o pedido", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult({ amount: 120 }) as never);
    await createPedido({ metodo: "PIX", idempotencyKey: "idem-webhook-invalid" });

    vi.mocked(getMercadoPagoPayment).mockResolvedValue(pixResult({ status: "APPROVED", mpStatus: "approved" }) as never);
    const webhook = await api(app, {
      method: "POST",
      url: "/api/payments/webhooks/mercadopago",
      headers: { "x-signature": "ts=1,v1=assinatura-falsa", "x-request-id": "req-x" },
      payload: { id: "evt-invalid", type: "payment", data: { id: "MP-PAY-1" } },
    });

    expect(webhook.status).toBe(200);
    expect((webhook.body.data as { status: string }).status).toBe("INVALID_SIGNATURE");

    const prisma = await db();
    const pedido = await prisma.pedido.findFirstOrThrow();
    expect(pedido.pagamentoStatus).toBe("Pendente");
    expect(vi.mocked(getMercadoPagoPayment).mock.calls.length).toBe(0);
  });

  it("NAO processa o mesmo evento duas vezes (idempotencia)", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult({ amount: 120 }) as never);
    await createPedido({ metodo: "PIX", idempotencyKey: "idem-webhook-dup" });

    const first = await approvedWebhook();
    const second = await approvedWebhook();
    expect((first.body.data as { status: string }).status).toBe("PROCESSED");
    expect((second.body.data as { status: string }).status).toBe("DUPLICATED");

    const prisma = await db();
    const pedido = await prisma.pedido.findFirstOrThrow();
    const saved = await prisma.product.findFirstOrThrow();
    // O estoque nao pode ser confirmado duas vezes.
    expect(pedido.pagamentoStatus).toBe("Pago");
    expect(saved.soldStock).toBe(1);
  });

  it("recusa pagamento com valor divergente do pedido", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult({ amount: 120 }) as never);
    await createPedido({ metodo: "PIX", idempotencyKey: "idem-webhook-valor" });

    vi.mocked(getMercadoPagoPayment).mockResolvedValue(
      pixResult({ status: "APPROVED", mpStatus: "approved", amount: 1 }) as never,
    );
    const signature = buildSignatureHeader({ dataId: "MP-PAY-1", requestId: "req-v", secret: WEBHOOK_SECRET });
    const webhook = await api(app, {
      method: "POST",
      url: "/api/payments/webhooks/mercadopago",
      headers: { "x-signature": signature, "x-request-id": "req-v" },
      payload: { id: "evt-valor", type: "payment", data: { id: "MP-PAY-1" } },
    });

    expect((webhook.body.data as { status: string }).status).toBe("AMOUNT_MISMATCH");
    const prisma = await db();
    const pedido = await prisma.pedido.findFirstOrThrow();
    expect(pedido.pagamentoStatus).toBe("Divergente");
  });

  it("nao marca como pago quando o gateway RECUSA", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult({ amount: 120 }) as never);
    await createPedido({ metodo: "PIX", idempotencyKey: "idem-webhook-recusado" });

    vi.mocked(getMercadoPagoPayment).mockResolvedValue(
      pixResult({ status: "DECLINED", mpStatus: "rejected", statusDetail: "cc_rejected_other_reason" }) as never,
    );
    const signature = buildSignatureHeader({ dataId: "MP-PAY-1", requestId: "req-d", secret: WEBHOOK_SECRET });
    const webhook = await api(app, {
      method: "POST",
      url: "/api/payments/webhooks/mercadopago",
      headers: { "x-signature": signature, "x-request-id": "req-d" },
      payload: { id: "evt-declined", type: "payment", data: { id: "MP-PAY-1" } },
    });

    expect((webhook.body.data as { status: string }).status).toBe("PROCESSED");
    const prisma = await db();
    const pedido = await prisma.pedido.findFirstOrThrow();
    expect(pedido.pagamentoStatus).toBe("Recusado");
    expect(pedido.pagoEm).toBeNull();
  });
});
