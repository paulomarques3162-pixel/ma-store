/**
 * Handlers HTTP do Shipping Engine proprio.
 *
 * O endpoint de cotacao e PUBLICO (guest checkout) e devolve o envelope padrao
 * do projeto (`{ data }`). Os erros usam os codigos padronizados
 * (INVALID_ZIP_CODE, SHIPPING_NOT_CONFIGURED, ...) e passam pelo handler global.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../db.js";
import { env } from "../../env.js";
import { ok, parse } from "../../lib/http.js";
import { localShippingCache, localShippingRepository } from "../application/container.js";
import { quoteLocalShipping } from "../application/quote.service.js";
import { getShippingSettings } from "../application/admin.service.js";
import { localQuoteRequestSchema, localSimulateRequestSchema } from "./schemas.js";

function quoteDeps() {
  return {
    repository: localShippingRepository,
    cache: localShippingCache,
    quoteTtlMinutes: env.SHIPPING_QUOTE_TTL_MINUTES,
  };
}

export async function handleLocalQuote(request: FastifyRequest, reply: FastifyReply) {
  const input = parse(localQuoteRequestSchema, request.body);

  request.log.info(
    { event: "shipping_quote_requested", zip: input.cep ?? input.destinationZipCode, items: input.items.length },
    "shipping_quote_requested",
  );

  const result = await quoteLocalShipping(input, quoteDeps());

  request.log.info(
    { event: "shipping_quote_success", zip: result.normalizedZipCode, options: result.options.length },
    "shipping_quote_success",
  );

  return ok(reply, result);
}

/** Simulador administrativo: mesma cotacao, com rastreio detalhado. */
export async function handleLocalSimulate(request: FastifyRequest, reply: FastifyReply) {
  const input = parse(localSimulateRequestSchema, request.body);
  const result = await quoteLocalShipping(input, quoteDeps());
  return ok(reply, {
    ...result,
    appliedZoneName: result.zone?.name ?? null,
    appliedRules: result.options.map((option) => ({ methodId: option.methodId, ruleId: option.ruleId })),
  });
}

/** Status publico do motor (sem segredos) para o checkout decidir o fluxo. */
export async function handleLocalEngineStatus(_request: FastifyRequest, reply: FastifyReply) {
  const settings = await getShippingSettings();
  const [zones, rules, methods] = await Promise.all([
    localShippingRepository.countActiveZones(),
    prisma.shippingWeightRule.count({ where: { active: true } }),
    prisma.shippingMethod.count({ where: { active: true } }),
  ]);
  return ok(reply, {
    enabled: settings.enabled,
    originZipCode: settings.originZipCode,
    hasZones: zones > 0,
    activeZones: zones,
    activeWeightRules: rules,
    activeMethods: methods,
    freeShippingEnabled: settings.freeShippingEnabled,
    configured: settings.enabled && zones > 0 && rules > 0,
  });
}
