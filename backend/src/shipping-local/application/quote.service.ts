/**
 * Servico de cotacao do Shipping Engine proprio (multi-modalidade).
 *
 * O backend e a unica fonte de verdade: peso, subtotal, zona, modalidades,
 * regra, excecao de CEP, preco e prazo sao lidos do PostgreSQL. Nada vindo do
 * navegador (peso/preco/subtotal) e aceito. Cada cotacao e persistida e
 * devolve um `quoteId` com validade, usado na seguranca do checkout.
 */
import { shippingError, validationError } from "../../lib/errors.js";
import { normalizeZipCode, zipCodeToInt } from "../domain/cep.js";
import { selectWeightRule } from "../domain/rule.js";
import {
  applyPackagePadding,
  totalItemWeightGrams,
  totalVolumeCm3,
  type Dimensions,
} from "../domain/weight.js";
import { resolveZone } from "../domain/zone.js";
import type {
  LocalQuoteInput,
  LocalQuoteOption,
  LocalQuoteResult,
  LocalShippingRepository,
  ProductLogistics,
  ShippingWeightRuleRecord,
} from "../domain/types.js";
import { buildCacheKey, LocalShippingCache } from "./cache.js";

export const ESTIMATE_DISCLAIMER =
  "Valor e prazo estimados. Podem variar conforme destino, embalagem e condicoes de transporte.";

/** Validade padrao da cotacao (minutos) quando o ambiente nao define outra. */
export const DEFAULT_QUOTE_TTL_MINUTES = 15;

export type QuoteServiceDeps = {
  repository: LocalShippingRepository;
  cache?: LocalShippingCache;
  /** TTL da cotacao em minutos. */
  quoteTtlMinutes?: number;
  /** Relogio injetavel (testes de expiracao). */
  now?: () => Date;
};

type ResolvedItem = {
  product: ProductLogistics;
  quantity: number;
  dimensions: Dimensions | null;
};

function dimensionsOf(product: ProductLogistics): Dimensions | null {
  if (product.heightCm && product.widthCm && product.lengthCm) {
    return { heightCm: product.heightCm, widthCm: product.widthCm, lengthCm: product.lengthCm };
  }
  return null;
}

function validateQuantity(quantity: number, productName: string): number {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw shippingError("INVALID_QUANTITY", `Quantidade invalida para ${productName}.`);
  }
  return quantity;
}

/** Aceita `cep` ou `destinationZipCode` (compatibilidade entre contratos). */
function resolveCepInput(input: LocalQuoteInput & { destinationZipCode?: string }): string {
  return input.cep ?? input.destinationZipCode ?? "";
}

/**
 * Cota o frete para TODAS as modalidades ativas com regra aplicavel.
 * Lanca erros padronizados quando falta configuracao — nunca devolve preco ficticio.
 */
export async function quoteLocalShipping(
  rawInput: LocalQuoteInput & { destinationZipCode?: string },
  deps: QuoteServiceDeps,
): Promise<LocalQuoteResult> {
  const { repository, cache } = deps;
  const now = deps.now ?? (() => new Date());

  if (!Array.isArray(rawInput.items) || rawInput.items.length === 0) {
    throw validationError("Informe ao menos um produto para calcular o frete.");
  }

  const normalizedZipCode = normalizeZipCode(resolveCepInput(rawInput));
  const zipCodeInt = zipCodeToInt(normalizedZipCode);

  const settings = await repository.getSettings();
  if (!settings.enabled) {
    throw shippingError(
      "SHIPPING_ENGINE_DISABLED",
      "O calculo de frete proprio esta desativado pela loja.",
    );
  }

  // Busca em LOTE (evita N+1).
  const uniqueIds = [...new Set(rawInput.items.map((item) => item.productId))];
  const products = await repository.findProducts(uniqueIds);
  const byId = new Map(products.map((product) => [product.id, product]));

  const resolved: ResolvedItem[] = [];
  for (const item of rawInput.items) {
    const product = byId.get(item.productId);
    if (!product) throw validationError(`Produto nao encontrado: ${item.productId}.`);
    if (!product.active) throw validationError(`Produto indisponivel: ${product.name}.`);
    const quantity = validateQuantity(item.quantity, product.name);
    resolved.push({ product, quantity, dimensions: dimensionsOf(product) });
  }

  const subtotal = Math.round(
    resolved.reduce((total, item) => total + item.product.price * item.quantity, 0) * 100,
  ) / 100;

  const cacheKey = buildCacheKey({
    normalizedZipCode,
    orderValue: subtotal,
    configVersion: settings.configVersion,
    items: resolved.map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
      updatedAt: item.product.updatedAt,
    })),
  });
  const cached = cache?.get(cacheKey);
  if (cached) return cached;

  const shippable = resolved.filter((item) => item.product.hasShipping);
  const requiresShipping = shippable.length > 0;

  const ttlMinutes = Math.max(1, deps.quoteTtlMinutes ?? DEFAULT_QUOTE_TTL_MINUTES);
  const expiresAt = new Date(now().getTime() + ttlMinutes * 60 * 1000);
  const disclaimer = settings.showEstimateDisclaimer ? ESTIMATE_DISCLAIMER : "";

  // Nenhum item exige entrega: opcao unica sem custo, sem inventar regra.
  if (!requiresShipping) {
    const created = await repository.createQuote({
      sessionId: rawInput.sessionId ?? null,
      cep: normalizedZipCode,
      subtotal,
      totalWeightGrams: 0,
      zoneId: null,
      expiresAt,
      options: [
        {
          methodId: "local-free",
          code: "FREE",
          name: "Sem entrega",
          description: null,
          price: 0,
          deliveryDays: 0,
          zoneId: null,
          ruleId: null,
        },
      ],
    });

    const freeResult: LocalQuoteResult = {
      success: true,
      available: true,
      quoteId: created.quoteId,
      expiresAt: created.expiresAt,
      normalizedZipCode,
      zone: null,
      weightGrams: 0,
      subtotal,
      isFreeShipping: true,
      requiresShipping: false,
      isEstimate: true,
      disclaimer,
      currency: "BRL",
      options: [
        {
          methodId: "local-free",
          code: "FREE",
          name: "Sem entrega",
          description: null,
          price: 0,
          deliveryDays: 0,
          zoneId: null,
          ruleId: null,
        },
      ],
    };
    cache?.set(cacheKey, freeResult);
    return freeResult;
  }

  // Peso: nunca assume 1kg. Produto sem peso configurado => erro explicito.
  for (const item of shippable) {
    if (!rawInput.allowMissingWeight && (item.product.weightGrams === null || item.product.weightGrams <= 0)) {
      throw shippingError(
        "PRODUCT_WEIGHT_MISSING",
        `Produto sem peso configurado para calculo de frete: ${item.product.name}.`,
      );
    }
  }

  const rawWeight = totalItemWeightGrams(
    shippable.map((item) => ({
      weightGrams: item.product.weightGrams && item.product.weightGrams > 0 ? item.product.weightGrams : 0,
      quantity: item.quantity,
    })),
  );
  const weightGrams = applyPackagePadding(rawWeight, settings.packagePaddingGrams);
  const volumeCm3 = totalVolumeCm3(shippable.map((item) => ({ dimensions: item.dimensions, quantity: item.quantity })));

  // Zona / faixa de CEP.
  const activeZoneCount = await repository.countActiveZones();
  if (activeZoneCount === 0) {
    throw shippingError("SHIPPING_NOT_CONFIGURED", "O frete ainda nao esta configurado para este destino.");
  }

  const zones = await repository.findActiveZonesByZip(zipCodeInt);
  const zone = resolveZone(zones, zipCodeInt);
  if (!zone) {
    throw shippingError(
      "SHIPPING_ZONE_NOT_FOUND",
      "Nao encontramos uma regiao de entrega configurada para este CEP.",
    );
  }

  // Modalidades ativas (maior prioridade primeiro; `position` como desempate).
  const methods = (await repository.findActiveMethods()).sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.position !== b.position) return a.position - b.position;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  if (methods.length === 0) {
    throw shippingError("SHIPPING_NOT_CONFIGURED", "Nenhuma modalidade de entrega esta ativa.");
  }

  const [allRules, exceptions] = await Promise.all([
    repository.findWeightRules(zone.id),
    repository.findCepExceptions(normalizedZipCode),
  ]);

  const rulesByMethod = new Map<string, ShippingWeightRuleRecord[]>();
  for (const rule of allRules) {
    if (!rule.shippingMethodId) continue;
    const list = rulesByMethod.get(rule.shippingMethodId) ?? [];
    list.push(rule);
    rulesByMethod.set(rule.shippingMethodId, list);
  }
  const exceptionByMethod = new Map(exceptions.map((exception) => [exception.shippingMethodId, exception]));

  const minimum = settings.freeShippingMinimumOrderValue;
  const isFreeShipping =
    settings.freeShippingEnabled && minimum !== null && minimum !== undefined && subtotal >= minimum;

  const options: LocalQuoteOption[] = [];
  for (const method of methods) {
    const rule = selectWeightRule(rulesByMethod.get(method.id) ?? [], weightGrams);
    const exception = exceptionByMethod.get(method.id);

    let basePrice: number;
    let deliveryDays: number | null;

    if (exception && exception.priceOverride !== null) {
      basePrice = exception.priceOverride;
      deliveryDays =
        exception.deliveryDaysOverride ??
        rule?.deliveryDays ??
        rule?.estimatedMinBusinessDays ??
        settings.defaultDeliveryDays ??
        null;
    } else if (rule) {
      basePrice = rule.price;
      deliveryDays =
        rule.deliveryDays ??
        rule.estimatedMinBusinessDays ??
        settings.defaultDeliveryDays ??
        null;
    } else {
      // Sem regra de peso e sem excecao com preco: modalidade indisponivel.
      continue;
    }

    // Excecao pode sobrescrever apenas o prazo, mantendo o preco da regra.
    if (rule && exception && exception.priceOverride === null && exception.deliveryDaysOverride !== null) {
      deliveryDays = exception.deliveryDaysOverride;
    }

    const price = isFreeShipping ? 0 : Math.max(0, basePrice);

    options.push({
      methodId: method.id,
      code: method.code,
      name: method.name,
      description: method.description,
      price,
      deliveryDays,
      zoneId: zone.id,
      ruleId: rule?.id ?? null,
    });
  }

  if (options.length === 0) {
    throw shippingError(
      "SHIPPING_RULE_NOT_FOUND",
      "Nao ha uma faixa de peso configurada para este destino. Fale com a loja.",
    );
  }

  const created = await repository.createQuote({
    sessionId: rawInput.sessionId ?? null,
    cep: normalizedZipCode,
    subtotal,
    totalWeightGrams: weightGrams,
    zoneId: zone.id,
    expiresAt,
    options,
  });

  const result: LocalQuoteResult = {
    success: true,
    available: true,
    quoteId: created.quoteId,
    expiresAt: created.expiresAt,
    normalizedZipCode,
    zone: { id: zone.id, name: zone.name },
    weightGrams,
    subtotal,
    isFreeShipping,
    requiresShipping: true,
    isEstimate: true,
    disclaimer,
    currency: "BRL",
    options,
  };

  void volumeCm3; // volume calculado e mantido para evolucao (cubagem).
  cache?.set(cacheKey, result);
  return result;
}
