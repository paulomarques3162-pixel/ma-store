import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BOLETO TEMPORARIAMENTE INDISPONIVEL (BOLETO_ENABLED=false, padrao).
 *
 * Prova que o bloqueio e do BACKEND (nao depende da UI):
 *   - `POST /api/pedidos` com `metodo: "BOLETO"` responde 422 e NAO cria pedido;
 *   - `POST /api/pedidos/:token/pagamento` com BOLETO responde 422 e NAO altera
 *     o pedido existente;
 *   - o gateway nunca e chamado (nenhuma cobranca de boleto e enviada);
 *   - PIX continua funcionando normalmente (mesmo fluxo, mesma rota).
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
      // Valor padrao da loja: boleto desligado para novas compras.
      BOLETO_ENABLED: false,
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

import { api, db, makeApp, resetDatabase } from "../helpers";
import { createBoletoPayment, createPixPayment } from "../../src/services/mercadopago/index";

const CLIENTE = { nome: "Cliente Boleto Bloqueado", whatsapp: "(19) 99999-4444", email: "bloqueado@teste.local" };
const ENDERECO = {
  cep: "13630000",
  logradouro: "Rua das Flores",
  numero: "123",
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
  vi.mocked(createBoletoPayment).mockReset();
  vi.mocked(createPixPayment).mockReset();
});

function pixResult() {
  return {
    id: "MP-PIX-1",
    status: "PENDING" as const,
    mpStatus: "pending",
    statusDetail: "pending_waiting_transfer",
    amount: 100,
    paymentMethodId: "pix",
    externalReference: "ref",
    pix: { qrCode: "00020126...", qrCodeBase64: "AAAA", ticketUrl: null },
    boleto: null,
    raw: {},
  };
}

async function createProduct() {
  const prisma = await db();
  const category = await prisma.category.create({ data: { name: "Cat", slug: `cat-${Date.now()}`, active: true } });
  return prisma.product.create({
    data: {
      name: "Produto Boleto",
      slug: `produto-${Date.now()}`,
      sku: `SKU-${Date.now()}`,
      price: "100.00",
      stock: 10,
      categoryId: category.id,
      active: true,
    },
  });
}

async function shippingSelection(productId: string) {
  const quote = await api(app, {
    method: "POST",
    url: "/api/shipping",
    payload: { cep: ENDERECO.cep, items: [{ id: productId, nome: "Produto", quantidade: 1, peso_unitario: 0.5 }] },
  });
  const options = (quote.body as { options: Array<{ id: string; valor: number }> }).options;
  const option = options.find((entry) => Number(entry.valor) > 0) ?? options[0]!;
  return { id: option.id };
}

describe("Boleto bloqueado — backend e a autoridade final", () => {
  it("rejeita a criação de pedido com boleto sem gravar nada", async () => {
    const prisma = await db();
    const product = await createProduct();
    const frete = await shippingSelection(product.id);
    const before = await prisma.pedido.count();

    const response = await api(app, {
      method: "POST",
      url: "/api/pedidos",
      payload: {
        cliente: CLIENTE,
        endereco: ENDERECO,
        produtos: [{ id: product.id, quantidade: 1 }],
        frete,
        pagamento: {
          metodo: "BOLETO",
          payer: { docType: "CPF", docNumber: "12345678909" },
          idempotencyKey: "idem-boleto-bloqueado",
        },
      },
    });

    expect(response.status).toBe(422);
    expect((response.body.error as { message: string }).message).toContain("boleto temporariamente indisponível");
    expect(vi.mocked(createBoletoPayment).mock.calls.length).toBe(0);

    // Nenhum pedido criado e o estoque NAO foi reservado.
    expect(await prisma.pedido.count()).toBe(before);
    const fresh = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(fresh.stock).toBe(10);
    expect(fresh.reservedStock).toBe(0);
  });

  it("rejeita a tentativa de gerar boleto para um pedido pendente existente", async () => {
    const prisma = await db();
    const pedido = await prisma.pedido.create({
      data: {
        tokenRastreioUnico: `tok-${Date.now()}-bloqueado`,
        clienteNome: "Cliente Existente",
        clienteWhatsapp: "(19) 99999-5555",
        clienteEmail: "existente@teste.local",
        enderecoCompleto: ENDERECO,
        produtosCarrinho: [{ id: "p1", nome: "Produto", quantidade: 1, preco: 100 }],
        freteEscolhidoNome: "Retirar na loja",
        freteEscolhidoValor: 0,
        pagamentoStatus: "Pendente",
        metodoPagamento: "BOLETO",
      },
    });

    const response = await api(app, {
      method: "POST",
      url: `/api/pedidos/${pedido.tokenRastreioUnico}/pagamento`,
      payload: {
        metodo: "BOLETO",
        payer: { email: "existente@teste.local", docType: "CPF", docNumber: "12345678909" },
        idempotencyKey: "idem-boleto-pedido-existente",
      },
    });

    expect(response.status).toBe(422);
    expect(vi.mocked(createBoletoPayment).mock.calls.length).toBe(0);

    const fresh = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    // O pedido historico permanece intacto (nada de "Falha"/Divergente).
    expect(fresh.pagamentoStatus).toBe("Pendente");
    expect(fresh.metodoPagamento).toBe("BOLETO");
  });

  it("continua aceitando PIX (nada alem do boleto foi afetado)", async () => {
    vi.mocked(createPixPayment).mockResolvedValue(pixResult() as never);
    const product = await createProduct();
    const frete = await shippingSelection(product.id);

    const response = await api(app, {
      method: "POST",
      url: "/api/pedidos",
      payload: {
        // PIX exige e-mail real (o Mercado Pago recusa e-mail ficticio).
        cliente: { nome: "Cliente Pix", whatsapp: "(19) 99999-6666", email: "pix@teste.local" },
        endereco: ENDERECO,
        produtos: [{ id: product.id, quantidade: 1 }],
        frete,
        pagamento: { metodo: "PIX", idempotencyKey: "idem-pix-liberado" },
      },
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(vi.mocked(createPixPayment).mock.calls.length).toBe(1);
  });
});
