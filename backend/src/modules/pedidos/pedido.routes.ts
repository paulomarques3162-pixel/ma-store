import type { FastifyInstance } from "fastify";
import { created, parse } from "../../lib/http.js";
import { createPedidoSchema } from "../../lib/validation.js";
import * as orders from "../../services/orders.js";

/**
 * Pedidos (Guest Checkout) — rota PUBLICA, sem autenticacao.
 *
 * O comprador nao tem conta: envia dados + itens + modalidade de frete.
 * O servidor recalcula precos/pesos/frete, gera o token de rastreio e grava
 * o pedido no PostgreSQL (Neon).
 */
export async function pedidoRoutes(app: FastifyInstance): Promise<void> {
  app.post("/", async (request, reply) => {
    const input = parse(createPedidoSchema, request.body);

    try {
      const pedido = await orders.createGuestPedido(input);
      return created(reply, { success: true, pedido });
    } catch (error) {
      request.log.error({ err: error }, "Falha ao criar pedido guest");
      throw error;
    }
  });
}
