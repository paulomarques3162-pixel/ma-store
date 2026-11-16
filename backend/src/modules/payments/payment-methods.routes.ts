import type { FastifyInstance } from "fastify";
import { ok } from "../../lib/http.js";
import { getPixConfig } from "../../services/payment-config.js";
import { getMercadoPagoStatus } from "../../services/mercadopago/config.js";
import { boletoAvailability, isBoletoEnabled } from "../../services/payment-flags.js";

/**
 * Meios de pagamento disponiveis para o checkout (PUBLICO).
 *
 * Nunca expoe Access Token, Webhook Secret, chave PIX privada ou qualquer
 * segredo — apenas o que esta habilitado e a Public Key (que e publica e usada
 * pelo SDK no navegador para tokenizar o cartao).
 *
 * O BOLETO continua listado mesmo quando desativado (`BOLETO_ENABLED=false`):
 * o checkout o exibe como "Em breve"/indisponivel. `enabled=false` e a
 * autoridade para o frontend NUNCA deixar selecionar; `comingSoon` apenas
 * controla o selo visual. O backend rejeita a tentativa de qualquer forma.
 */
export async function paymentMethodsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    const mercadoPago = getMercadoPagoStatus();
    const pix = await getPixConfig();

    const onlineConfigured = mercadoPago.enabled;
    const legacyPixAvailable = pix.status.enabled && pix.status.configured;
    const boleto = boletoAvailability();

    const pixEnabled = onlineConfigured || legacyPixAvailable;
    const pixNote = pixEnabled
      ? null
      : `PIX indisponivel: ${mercadoPago.missing.length > 0 ? `faltam ${mercadoPago.missing.join(", ")}` : "configure a chave PIX da loja"}.`;

    // Boleto exige DUAS condicoes: gateway configurado E modalidade habilitada
    // comercialmente. Credencial configurada NAO anuncia boleto disponivel.
    const boletoEnabled = onlineConfigured && boleto.enabled;

    return ok(reply, {
      provider: mercadoPago.provider,
      environment: mercadoPago.environment,
      onlinePaymentsEnabled: onlineConfigured,
      // A Public Key pode ser usada no frontend; os demais segredos NUNCA.
      publicKey: mercadoPago.publicKey,
      // Estado comercial do boleto (para o checkout renderizar o selo "Em breve").
      boletoEnabled: isBoletoEnabled(),
      methods: [
        {
          id: "PIX",
          label: "PIX",
          enabled: pixEnabled,
          configured: pixEnabled,
          comingSoon: false,
          gateway: onlineConfigured ? "mercadopago" : legacyPixAvailable ? "static" : null,
          note: pixNote,
        },
        {
          id: "CREDIT_CARD",
          label: "Cartao de credito",
          enabled: onlineConfigured,
          configured: onlineConfigured,
          comingSoon: false,
          gateway: onlineConfigured ? "mercadopago" : null,
          note: onlineConfigured ? null : "Cartao indisponivel: Mercado Pago nao configurado.",
        },
        {
          id: "BOLETO",
          label: boleto.label,
          // `enabled` e o que libera a SELECAO no frontend.
          enabled: boletoEnabled,
          configured: onlineConfigured,
          // Mantido visivel com aparencia de indisponivel, sem janelas invasivas.
          comingSoon: boleto.comingSoon,
          gateway: onlineConfigured ? "mercadopago" : null,
          note: !boleto.enabled
            ? boleto.note
            : onlineConfigured
              ? null
              : "Boleto indisponivel: Mercado Pago nao configurado.",
        },
        {
          id: "COMBINAR",
          label: "Combinar com a loja (WhatsApp)",
          enabled: true,
          configured: true,
          comingSoon: false,
          gateway: null,
          note: null,
        },
      ],
    });
  });
}
