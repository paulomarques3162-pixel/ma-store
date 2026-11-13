import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, createAdmin, createShopFixture, db, makeApp, resetDatabase } from "../helpers";

/**
 * "Combinar entrega/retirada com a loja": o pedido é criado sem valor de frete,
 * em "Aguardando Negociação", sem cobrança. O admin define o frete acordado e
 * libera o pagamento; o total é recalculado e o cliente vê o valor atualizado.
 */

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
});

const CLIENTE = { nome: "Cliente Negociação", whatsapp: "(19) 99999-4444", email: "negociacao@teste.local" };
const ENDERECO = { cep: "13630000", logradouro: "Rua Negociação", numero: "10", bairro: "Centro", cidade: "Pirassununga", uf: "SP" };

async function createCombinarPedido(productId: string) {
  return api(app, {
    method: "POST",
    url: "/api/pedidos",
    payload: {
      cliente: CLIENTE,
      endereco: ENDERECO,
      produtos: [{ id: productId, quantidade: 1 }],
      frete: { combinar: true },
      pagamento: { metodo: "COMBINAR" },
    },
  });
}

describe("Combinar entrega/retirada com a loja", () => {
  it("cria o pedido em 'Aguardando Negociação', sem frete e sem cobrança", async () => {
    const { product } = await createShopFixture({ stock: 5, price: "100.00" });
    const response = await createCombinarPedido(product.id);
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const pedido = (response.body.data as { pedido: Record<string, unknown> }).pedido;
    expect(pedido["status_atual"]).toBe("Aguardando Negociação");
    expect(pedido["frete_combinar"]).toBe(true);
    expect(pedido["frete_escolhido_valor"]).toBeNull();
    expect(pedido["metodo_pagamento"]).toBe("COMBINAR");
    expect(pedido["pagamento_provider"]).toBeNull();
    expect(Number(pedido["total"])).toBe(100);
    expect((pedido["timeline"] as Array<{ status: string }>)[0]?.status).toBe("Aguardando Negociação");

    const prisma = await db();
    const saved = await prisma.pedido.findFirstOrThrow();
    expect(saved.freteCombinar).toBe(true);
    expect(saved.freteEscolhidoValor).toBeNull();
    expect(saved.statusAtual).toBe("Aguardando Negociação");
  });

  it("admin define o frete acordado e libera o pagamento, recalculando o total", async () => {
    const admin = await createAdmin(app);
    const { product } = await createShopFixture({ stock: 5, price: "100.00" });
    const created = await createCombinarPedido(product.id);
    const pedido = (created.body.data as { pedido: { id: number; token_rastreio_unico: string } }).pedido;

    const patch = await api(app, {
      method: "PATCH",
      url: `/api/admin/pedidos/${pedido.id}`,
      token: admin.token,
      payload: { status_atual: "Aguardando Pagamento", frete_valor: 25 },
    });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);

    const updated = (patch.body.data as { pedido: Record<string, unknown> }).pedido;
    expect(updated["status_atual"]).toBe("Aguardando Pagamento");
    expect(Number(updated["frete_escolhido_valor"])).toBe(25);
    expect(Number(updated["total"])).toBe(125);

    // O cliente vê o valor atualizado no rastreio.
    const tracking = await api(app, { method: "GET", url: `/api/rastreio/${pedido.token_rastreio_unico}` });
    const publicPedido = (tracking.body.data as { pedido: Record<string, unknown> }).pedido;
    expect(Number(publicPedido["total"])).toBe(125);
    expect(Number(publicPedido["frete_escolhido_valor"])).toBe(25);
    expect(publicPedido["frete_combinar"]).toBe(true);
  });

  it("não permite definir frete acordado em pedido com frete calculado", async () => {
    const admin = await createAdmin(app);
    const { product } = await createShopFixture({ stock: 5, price: "100.00" });

    const quote = await api(app, {
      method: "POST",
      url: "/api/shipping",
      payload: { cep: ENDERECO.cep, items: [{ id: product.id, nome: "P", quantidade: 1, peso_unitario: 0.5 }] },
    });
    const options = (quote.body as { options: Array<{ id: string; valor: number }> }).options;
    const option = options.find((entry) => Number(entry.valor) > 0) ?? options[0]!;

    const created = await api(app, {
      method: "POST",
      url: "/api/pedidos",
      payload: {
        cliente: CLIENTE,
        endereco: ENDERECO,
        produtos: [{ id: product.id, quantidade: 1 }],
        frete: { id: option.id },
        pagamento: { metodo: "COMBINAR" },
      },
    });
    const pedido = (created.body.data as { pedido: { id: number } }).pedido;

    const patch = await api(app, {
      method: "PATCH",
      url: `/api/admin/pedidos/${pedido.id}`,
      token: admin.token,
      payload: { status_atual: "Aguardando Pagamento", frete_valor: 10 },
    });
    expect(patch.status).toBe(400);
  });

  it("exige administrador para definir o frete acordado", async () => {
    const { product } = await createShopFixture({ stock: 5, price: "100.00" });
    const created = await createCombinarPedido(product.id);
    const pedido = (created.body.data as { pedido: { id: number } }).pedido;

    const patch = await api(app, {
      method: "PATCH",
      url: `/api/admin/pedidos/${pedido.id}`,
      payload: { status_atual: "Aguardando Pagamento", frete_valor: 25 },
    });
    expect(patch.status).toBe(401);
  });
});
