import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { created, ok, parse } from "../../lib/http.js";
import { createPedidoSchema, pedidoPaymentSchema } from "../../lib/validation.js";
import * as orders from "../../services/orders.js";
import { pixQrDataUrl } from "../../services/pix.js";
import { startPedidoPayment } from "../../services/pedido-payments.js";

const tokenParam = z.object({ token: z.string().trim().min(10).max(255) });

/**
 * Pedidos (Guest Checkout) — rota PUBLICA, sem autenticacao.
 *
 * O comprador nao tem conta: envia dados + itens + modalidade de frete.
 * O servidor recalcula precos/pesos/frete, gera o token de rastreio e grava
 * o pedido no PostgreSQL (Neon). O pagamento online e cobrado pelo Mercado
 * Pago quando configurado; nunca marcamos como pago sem confirmacao real.
 */
export async function pedidoRoutes(app: FastifyInstance): Promise<void> {
  app.post("/", async (request, reply) => {
    const input = parse(createPedidoSchema, request.body);

    try {
      const pedido = await orders.createGuestPedido(input);
      // QR Code PIX: preferimos o base64 devolvido pelo gateway; caso contrario
      // geramos a imagem a partir do copia e cola (BR Code) do proprio gateway.
      const pixQrCode = pedido.pagamento_qr_code_base64
        ? `data:image/png;base64,${pedido.pagamento_qr_code_base64}`
        : pedido.metodo_pagamento === "PIX" && pedido.pagamento_payload
          ? await pixQrDataUrl(pedido.pagamento_payload)
          : null;
      return created(reply, { success: true, pedido, pixQrCode });
    } catch (error) {
      request.log.error({ err: error }, "Falha ao criar pedido guest");
      throw error;
    }
  });

  /**
   * Regera/retenta a cobranca de um pedido Guest ainda nao pago.
   * Usado apos recusa de cartao ou para gerar um novo PIX/boleto.
   * Idempotente: cada tentativa envia uma nova X-Idempotency-Key.
   */
  app.post("/:token/pagamento", async (request, reply) => {
    const { token } = parse(tokenParam, request.params);
    const input = parse(pedidoPaymentSchema, request.body);

    const pedido = await orders.getPedidoByToken(token);
    await startPedidoPayment(pedido.id, {
      metodo: input.metodo,
      card: input.card,
      payer: input.payer
        ? {
            email: input.payer.email || undefined,
            docType: input.payer.docType,
            docNumber: input.payer.docNumber || undefined,
          }
        : undefined,
      idempotencyKey: input.idempotencyKey,
    });

    const updated = await orders.getPedidoByToken(token);
    const pixQrCode = updated.pagamento_qr_code_base64
      ? `data:image/png;base64,${updated.pagamento_qr_code_base64}`
      : updated.metodo_pagamento === "PIX" && updated.pagamento_payload
        ? await pixQrDataUrl(updated.pagamento_payload)
        : null;
    return ok(reply, { success: true, pedido: updated, pixQrCode });
  });
}
