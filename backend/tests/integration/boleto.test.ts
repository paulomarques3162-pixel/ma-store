import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Boleto — o Mercado Pago EXIGE o endereco do pagador (zip_code, street_name,
 * street_number, neighborhood, city, federal_unit). Este teste garante que o
 * endereco do pedido e enviado ao gateway e que a ausencia gera erro claro.
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

import { api, db, makeApp, resetDatabase } from "../helpers";
import { createBoletoPayment } from "../../src/services/mercadopago/index";

const CLIENTE = { nome: "Cliente Boleto", whatsapp: "(19) 99999-3333", email: "boleto@teste.local" };
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
});

function boletoResult() {
  return {
    id: "MP-BOL-1",
    status: "PENDING" as const,
    mpStatus: "pending",
    statusDetail: "pending_waiting_payment",
    amount: 120,
    paymentMethodId: "bolbradesco",
    externalReference: "ref",
    pix: null,
    boleto: { url: "https://mp.test/boleto", barcode: "001905009", expiresAt: new Date(Date.now() + 86400000) },
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

describe("Boleto — endereço do pagador", () => {
  it("envia o endereço completo do pedido ao criar o boleto", async () => {
    vi.mocked(createBoletoPayment).mockResolvedValue(boletoResult() as never);
    const product = await createProduct();
    const frete = await shippingSelection(product.id);

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
          idempotencyKey: "idem-boleto-endereco",
        },
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const call = vi.mocked(createBoletoPayment).mock.calls[0]?.[0];
    // O adapter recebe o endereço tipado; `buildPayer` o converte para os nomes
    // exigidos pelo Mercado Pago (zip_code, street_name, ...).
    expect(call?.payer.address).toEqual({
      zipCode: "13630000",
      streetName: "Rua das Flores",
      streetNumber: "123",
      neighborhood: "Centro",
      city: "Pirassununga",
      federalUnit: "SP",
    });

    const pedido = (response.body.data as { pedido: { pagamento_boleto_url: string | null } }).pedido;
    expect(pedido.pagamento_boleto_url).toBe("https://mp.test/boleto");
  });

  it("recusa boleto com erro claro quando o pedido não tem endereço válido", async () => {
    const prisma = await db();
    // Pedido legado/atípico sem endereço completo (não inventamos endereço).
    const pedido = await prisma.pedido.create({
      data: {
        tokenRastreioUnico: `tok-${Date.now()}-boleto`,
        clienteNome: "Cliente Sem Endereco",
        clienteWhatsapp: "(19) 99999-0000",
        enderecoCompleto: {},
        produtosCarrinho: [{ id: "p1", nome: "Produto", quantidade: 1, preco: 100 }],
        freteEscolhidoNome: "Retirar na loja",
        freteEscolhidoValor: 0,
        pagamentoStatus: "Pendente",
      },
    });

    const response = await api(app, {
      method: "POST",
      url: `/api/pedidos/${pedido.tokenRastreioUnico}/pagamento`,
      payload: {
        metodo: "BOLETO",
        payer: { docType: "CPF", docNumber: "12345678909" },
        idempotencyKey: "idem-boleto-sem-endereco",
      },
    });
    expect(response.status).toBe(422);
    expect((response.body.error as { message: string }).message).toContain("endereco completo");
    expect(vi.mocked(createBoletoPayment).mock.calls.length).toBe(0);
  });

  it("exige CPF/CNPJ para gerar o boleto", async () => {
    const product = await createProduct();
    const frete = await shippingSelection(product.id);
    const response = await api(app, {
      method: "POST",
      url: "/api/pedidos",
      payload: {
        cliente: CLIENTE,
        endereco: ENDERECO,
        produtos: [{ id: product.id, quantidade: 1 }],
        frete,
        pagamento: { metodo: "BOLETO", idempotencyKey: "idem-boleto-sem-cpf" },
      },
    });
    expect(response.status).toBe(422);
    expect((response.body.error as { message: string }).message).toContain("CPF");
  });
});
