import type { FastifyInstance } from "fastify";
import { ok, parse } from "../../lib/http.js";
import { z } from "zod";
import * as orders from "../../services/orders.js";
import { pixQrDataUrl } from "../../services/pix.js";

const tokenParam = z.object({ token: z.string().trim().min(10).max(255) });

/**
 * Rastreamento publico: o token e a credencial daquele pedido.
 * Nao exige login e usa query parametrizada (Prisma).
 */
export async function trackingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/:token", async (request, reply) => {
    const { token } = parse(tokenParam, request.params);
    const pedido = await orders.getPedidoByToken(token);
    const pixQrCode =
      pedido.metodo_pagamento === "PIX" && pedido.pagamento_payload
        ? await pixQrDataUrl(pedido.pagamento_payload)
        : null;
    return ok(reply, { success: true, pedido, pixQrCode });
  });
}
