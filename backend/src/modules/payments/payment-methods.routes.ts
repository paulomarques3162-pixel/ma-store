import type { FastifyInstance } from "fastify";
import { ok } from "../../lib/http.js";
import { getPixConfig } from "../../services/payment-config.js";
import { getMercadoPagoStatus } from "../../services/mercadopago/config.js";

/**
 * Meios de pagamento disponiveis para o checkout (PUBLICO).
 *
 * Nunca expoe Access Token, Webhook Secret, chave PIX privada ou qualquer
 * segredo — apenas o que esta habilitado e a Public Key (que e publica e usada
 * pelo SDK no navegador para tokenizar o cartao).
 */
export async function paymentMethodsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    const mercadoPago = getMercadoPagoStatus();
    const pix = await getPixConfig();

    const onlineConfigured = mercadoPago.enabled;
    const legacyPixAvailable = pix.status.enabled && pix.status.configured;

    const pixEnabled = onlineConfigured || legacyPixAvailable;
    const pixNote = pixEnabled
      ? null
      : onlineConfigured
        ? null
        : `PIX indisponivel: ${mercadoPago.missing.length > 0 ? `faltam ${mercadoPago.missing.join(", ")}` : "configure a chave PIX da loja"}.`;

    return ok(reply, {
      provider: mercadoPago.provider,
      environment: mercadoPago.environment,
      onlinePaymentsEnabled: onlineConfigured,
      // A Public Key pode ser usada no frontend; os demais segredos NUNCA.
      publicKey: mercadoPago.publicKey,
      methods: [
        {
          id: "PIX",
          label: "PIX",
          enabled: pixEnabled,
          configured: pixEnabled,
          gateway: onlineConfigured ? "mercadopago" : legacyPixAvailable ? "static" : null,
          note: pixNote,
        },
        {
          id: "CREDIT_CARD",
          label: "Cartao de credito",
          enabled: onlineConfigured,
          configured: onlineConfigured,
          gateway: onlineConfigured ? "mercadopago" : null,
          note: onlineConfigured ? null : "Cartao indisponivel: Mercado Pago nao configurado.",
        },
        {
          id: "BOLETO",
          label: "Boleto",
          enabled: onlineConfigured,
          configured: onlineConfigured,
          gateway: onlineConfigured ? "mercadopago" : null,
          // O boleto pode nao estar habilitado para a conta; nesse caso o
          // gateway responde "Boleto indisponivel para este pagamento".
          note: onlineConfigured ? null : "Boleto indisponivel: Mercado Pago nao configurado.",
        },
        {
          id: "COMBINAR",
          label: "Combinar com a loja (WhatsApp)",
          enabled: true,
          configured: true,
          gateway: null,
          note: null,
        },
      ],
    });
  });
}
