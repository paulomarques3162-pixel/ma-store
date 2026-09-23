import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ok, parse } from "../../lib/http.js";
import { validationError } from "../../lib/errors.js";
import { getIntegrationsStatus, getPixConfig } from "../../services/payment-config.js";
import { buildPixPayload, pixQrDataUrl } from "../../services/pix.js";

/**
 * Diagnóstico de integrações (ADMIN). Mostra o que está configurado e o que
 * falta — SEM inventar resultados. Não dispara cobrança real.
 */
export async function diagnosticsAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  app.get("/integrations", async (_request, reply) => {
    const pix = await getPixConfig();
    return ok(reply, {
      shipping: getIntegrationsStatus(),
      pix: { enabled: pix.status.enabled, configured: pix.status.configured, missing: pix.status.missing },
      disclaimer:
        "Status de configuração. Não representa cobrança/entrega real: só uma chamada real ao provedor/transportadora confirma dinheiro ou frete.",
    });
  });

  /** Gera um BR Code de exemplo com a chave configurada (sem criar cobrança). */
  app.post("/pix/preview", async (request, reply) => {
    const input = parse(z.object({ amount: z.coerce.number().positive().max(1000000).optional() }), request.body ?? {});
    const pix = await getPixConfig();
    if (!pix.status.configured || !pix.key || !pix.holder || !pix.city) {
      throw validationError(`PIX não configurado: falta ${pix.status.missing.join(", ")}.`);
    }
    const payload = buildPixPayload({
      key: pix.key,
      merchantName: pix.holder,
      merchantCity: pix.city,
      amount: input.amount,
      txid: "TESTE",
    });
    return ok(reply, {
      payload,
      qrDataUrl: await pixQrDataUrl(payload),
      note: "BR Code estático de teste. Não confirma pagamento — não marca nenhum pedido como pago.",
    });
  });
}
