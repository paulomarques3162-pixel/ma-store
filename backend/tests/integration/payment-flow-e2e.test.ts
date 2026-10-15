import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VALIDACAO DE PONTA A PONTA DO FLUXO DE PAGAMENTO (Guest Checkout).
 *
 * Exercita o caminho REAL de producao: rotas HTTP, PostgreSQL, validacao de
 * assinatura do webhook, transicoes de status e movimentacao de estoque.
 * Apenas as chamadas de REDE ao SDK do Mercado Pago sao substituidas por um
 * duble (nao ha credencial de sandbox neste ambiente), exatamente como a suite
 * de integracao do gateway ja faz.
 *
 * O que este teste prova:
 *  1. PIX criado no checkout (copia-e-cola + QR) com valor recalculado no servidor.
 *  2. Antes do pagamento: rastreio do cliente e painel mostram "Pendente".
 *  3. Estoque reservado (reservedStock=1), ainda NAO vendido (soldStock=0).
 *  4. Webhook com assinatura valida localiza o pedido pelo id do gateway
 *     (providerRef), mesmo com externalReference ERRADO.
 *  5. Depois do webhook: rastreio do cliente e painel mostram "Pago".
 *  6. Estoque confirmado: soldStock=1, reservedStock=0 (sem baixa duplicada).
 *  7. Webhook repetido (mesmo evento) => DUPLICATED; evento novo do mesmo
 *     pagamento => PROCESSED, mas o estoque continua 1.
 *  8. Valor divergente => "Divergente" e NAO marca como pago.
 *  9. Pagamento recusado => "Recusado", pagoEm nulo.
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
      // Sandbox usa as variaveis DEDICADAS; explicito para que qualquer
      // variavel do processo hospedeiro nao vaze para o teste.
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

import { api, createAdmin, createShopFixture, db, makeApp, resetDatabase } from "../helpers";
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
    id: "MP-PAY-E2E",
    status: "PENDING",
    mpStatus: "pending",
    statusDetail: "pending_waiting_transfer",
    amount: 110,
    paymentMethodId: "pix",
    externalReference: "referencia-intencionalmente-errada",
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

const CLIENTE = { nome: "Cliente E2E Sandbox", whatsapp: "(19) 99999-1111", email: "e2e@teste.local" };
const ENDERECO = {
  cep: "13630000",
  logradouro: "Rua E2E",
  numero: "200",
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

/** Cota o frete real e escolhe uma modalidade paga (como o frontend faz). */
async function shippingSelection(productId: string) {
  const quote = await api(app, {
    method: "POST",
    url: "/api/shipping",
    payload: { cep: ENDERECO.cep, items: [{ id: productId, nome: "Produto E2E", quantidade: 1, peso_unitario: 0.5 }] },
  });
  expect(quote.status, JSON.stringify(quote.body)).toBe(200);
  const options = (quote.body as { options: Array<{ id: string; valor: number }> }).options;
  const option = options.find((entry) => Number(entry.valor) > 0) ?? options[0]!;
  return { id: option.id, price: Number(option.valor) || 0 };
}

/** Cria um pedido Guest PIX e devolve tudo que os testes precisam. */
async function createPixPedido() {
  const { product } = await createShopFixture({ stock: 5, price: "100.00" });
  const frete = await shippingSelection(product.id);
  const amount = 100 + frete.price;

  const response = await api(app, {
    method: "POST",
    url: "/api/pedidos",
    payload: {
      cliente: CLIENTE,
      endereco: ENDERECO,
      produtos: [{ id: product.id, quantidade: 1 }],
      frete,
      pagamento: { metodo: "PIX", idempotencyKey: `e2e-${Date.now()}-${Math.random().toString(16).slice(2, 6)}` },
    },
  });

  return { response, product, amount };
}

function sign(dataId: string, requestId: string) {
  return buildSignatureHeader({ dataId, requestId, secret: WEBHOOK_SECRET });
}

/** Envia a notificacao do Mercado Pago (como o gateway faria). */
async function postWebhook(opts: { eventId: string; paymentId: string; requestId?: string }) {
  const requestId = opts.requestId ?? `req-${opts.eventId}`;
  return api(app, {
    method: "POST",
    url: "/api/payments/webhooks/mercadopago",
    headers: { "x-signature": sign(opts.paymentId, requestId), "x-request-id": requestId },
    payload: { id: opts.eventId, type: "payment", data: { id: opts.paymentId } },
  });
}

async function readCustomer(token: string) {
  const response = await api(app, { method: "GET", url: `/api/rastreio/${token}` });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (response.body.data as { pedido: Record<string, unknown> }).pedido;
}

describe("Fluxo de pagamento PIX — ponta a ponta", () => {
  it("cria o PIX, recebe o webhook e confirma Pago no rastreio e no painel, sem duplicar estoque", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult({ amount: 110 }) as never);

    // ---- 1. Checkout cria o pedido e a cobranca PIX --------------------------
    const { response, product, amount } = await createPixPedido();
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const data = response.body.data as { pedido: Record<string, unknown>; pixQrCode: string | null };
    const token = data.pedido["token_rastreio_unico"] as string;
    const pedidoId = data.pedido["id"] as number;

    expect(data.pedido["pagamento_provider"]).toBe("mercadopago");
    expect(data.pedido["pagamento_provider_ref"]).toBe("MP-PAY-E2E");
    expect(data.pedido["pagamento_payload"]).toContain("BR.GOV.BCB.PIX");
    expect(data.pixQrCode).toMatch(/^data:image\/png;base64,/);
    // Valor cobrado = total recalculado no servidor (produto + frete).
    expect(vi.mocked(createPixPayment).mock.calls[0]?.[0]?.amount).toBe(amount);

    // ---- 2. ANTES do pagamento: rastreio e painel = "Pendente" ---------------
    const beforeTracking = await readCustomer(token);
    expect(beforeTracking["pagamento_status"]).toBe("Pendente");
    expect(beforeTracking["pago_em"]).toBeNull();

    const admin = await createAdmin(app);
    const adminBefore = await api(app, { method: "GET", url: `/api/admin/pedidos/${pedidoId}`, token: admin.token });
    expect(adminBefore.status).toBe(200);
    expect((adminBefore.body.data as { pedido: { pagamento_status: string } }).pedido.pagamento_status).toBe("Pendente");

    // ---- 3. Estoque RESERVADO, ainda nao vendido ----------------------------
    const prisma = await db();
    let saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(saved.stock).toBe(4);
    expect(saved.reservedStock).toBe(1);
    expect(saved.soldStock).toBe(0);

    // ---- 4. Webhook APPROVED (o gateway confirma o pagamento) ---------------
    // externalReference do gateway vem ERRADO de proposito: a localizacao
    // correta depende do providerRef (id do pagamento no gateway).
    vi.mocked(getMercadoPagoPayment).mockResolvedValue(
      pixResult({ status: "APPROVED", mpStatus: "approved", statusDetail: "accredited", amount }) as never,
    );
    const webhook = await postWebhook({ eventId: "evt-e2e-1", paymentId: "MP-PAY-E2E" });
    expect(webhook.status, JSON.stringify(webhook.body)).toBe(200);
    expect((webhook.body.data as { status: string }).status).toBe("PROCESSED");

    // ---- 5. Rastreio do CLIENTE mostra "Pago" -------------------------------
    const afterTracking = await readCustomer(token);
    expect(afterTracking["pagamento_status"]).toBe("Pago");
    expect(afterTracking["status_atual"]).toBe("Empacotando Produto");
    expect(afterTracking["pago_em"]).not.toBeNull();
    expect(afterTracking["pagamento_provider_status"]).toBe("approved");

    // ---- 6. Painel ADMIN mostra "Pago" --------------------------------------
    const adminAfter = await api(app, { method: "GET", url: `/api/admin/pedidos/${pedidoId}`, token: admin.token });
    const adminPedido = (adminAfter.body.data as { pedido: { pagamento_status: string; status_atual: string; pago_em: string | null } }).pedido;
    expect(adminPedido.pagamento_status).toBe("Pago");
    expect(adminPedido.status_atual).toBe("Empacotando Produto");
    expect(adminPedido.pago_em).not.toBeNull();

    // ---- 7. Estoque CONFIRMADO (venda), sem baixa duplicada -----------------
    saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(saved.soldStock).toBe(1);
    expect(saved.reservedStock).toBe(0);
    expect(saved.stock).toBe(4);

    // ---- 8. Reenvio do MESMO evento: DUPLICATED -----------------------------
    const replay = await postWebhook({ eventId: "evt-e2e-1", paymentId: "MP-PAY-E2E" });
    expect((replay.body.data as { status: string }).status).toBe("DUPLICATED");

    // ---- 9. Evento NOVO do mesmo pagamento: PROCESSED, estoque continua 1 ---
    const reprocess = await postWebhook({ eventId: "evt-e2e-2", paymentId: "MP-PAY-E2E" });
    expect((reprocess.body.data as { status: string }).status).toBe("PROCESSED");
    saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(saved.soldStock).toBe(1);
    expect(saved.reservedStock).toBe(0);
  });

  it("nao marca como Pago quando o valor pago diverge do total do pedido", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult({ amount: 110 }) as never);
    const { response, product, amount } = await createPixPedido();
    const token = (response.body.data as { pedido: { token_rastreio_unico: string } }).pedido.token_rastreio_unico;

    vi.mocked(getMercadoPagoPayment).mockResolvedValue(
      pixResult({ status: "APPROVED", mpStatus: "approved", amount: amount - 50 }) as never,
    );
    const webhook = await postWebhook({ eventId: "evt-div", paymentId: "MP-PAY-E2E" });
    expect((webhook.body.data as { status: string }).status).toBe("AMOUNT_MISMATCH");

    const tracking = await readCustomer(token);
    expect(tracking["pagamento_status"]).toBe("Divergente");
    expect(tracking["pago_em"]).toBeNull();

    const prisma = await db();
    const saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(saved.reservedStock).toBe(1);
    expect(saved.soldStock).toBe(0);
  });

  it("nao marca como Pago quando o gateway RECUSA o pagamento", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult({ amount: 110 }) as never);
    const { response, amount } = await createPixPedido();
    const token = (response.body.data as { pedido: { token_rastreio_unico: string } }).pedido.token_rastreio_unico;

    vi.mocked(getMercadoPagoPayment).mockResolvedValue(
      pixResult({ status: "DECLINED", mpStatus: "rejected", statusDetail: "cc_rejected_other_reason", amount }) as never,
    );
    const webhook = await postWebhook({ eventId: "evt-rec", paymentId: "MP-PAY-E2E" });
    expect((webhook.body.data as { status: string }).status).toBe("PROCESSED");

    const tracking = await readCustomer(token);
    expect(tracking["pagamento_status"]).toBe("Recusado");
    expect(tracking["pago_em"]).toBeNull();
  });
});
