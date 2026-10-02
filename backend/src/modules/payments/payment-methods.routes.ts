import type { FastifyInstance } from "fastify";
import { ok } from "../../lib/http.js";
import { getPixConfig } from "../../services/payment-config.js";

/**
 * Meios de pagamento disponíveis para o checkout (PÚBLICO).
 * Nunca expõe chave PIX, titular ou qualquer segredo — apenas o que está
 * habilitado e se está corretamente configurado.
 */
export async function paymentMethodsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    const pix = await getPixConfig();

    return ok(reply, {
      methods: [
        {
          id: "PIX",
          label: "PIX",
          enabled: pix.status.enabled,
          configured: pix.status.configured,
          note: pix.status.configured ? null : `PIX indisponível: falta ${pix.status.missing.join(", ")}.`,
        },
        {
          id: "COMBINAR",
          label: "Combinar com a loja (WhatsApp)",
          enabled: true,
          configured: true,
          note: null,
        },
      ],
    });
  });
}
