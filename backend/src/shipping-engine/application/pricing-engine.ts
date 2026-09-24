import { roundMoney } from "../domain/money.js";
import type { ShippingQuote } from "../domain/types.js";
import type { StoreShippingConfig, PriceAdjustment, FreeShippingRule } from "./config.js";
import { shippingRegion } from "./config.js";

export type PricingContext = {
  orderValue?: number | null;
  destinationPostalCode?: string | null;
};

export type PricingOutcome = {
  price: number;
  basePrice: number;
  appliedRules: string[];
  freeShippingApplied: boolean;
};

function applyAdjustment(value: number, adjustment: PriceAdjustment): number {
  if (adjustment.type === "percent") return value * (adjustment.value / 100);
  return adjustment.value;
}

/** Uma regra de frete grátis se aplica ao serviço/região e ao valor do pedido? */
export function isFreeShippingEligible(
  rule: FreeShippingRule,
  quote: Pick<ShippingQuote, "serviceCode" | "serviceName">,
  context: PricingContext,
): boolean {
  if (!rule.enabled) return false;

  const minimum = rule.minimumOrderValue;
  if (typeof minimum === "number" && minimum > 0) {
    const orderValue = context.orderValue;
    if (typeof orderValue !== "number" || orderValue < minimum) return false;
  }

  if (rule.services && rule.services.length > 0) {
    const wanted = new Set(rule.services.map((service) => service.trim().toLowerCase()));
    const serviceCode = quote.serviceCode.toLowerCase();
    const serviceName = quote.serviceName.toLowerCase();
    if (!wanted.has(serviceCode) && !wanted.has(serviceName)) return false;
  }

  if (rule.regionPrefixes && rule.regionPrefixes.length > 0) {
    if (!context.destinationPostalCode) return false;
    const region = shippingRegion(context.destinationPostalCode);
    if (!rule.regionPrefixes.some((prefix) => region.startsWith(prefix))) return false;
  }

  return true;
}

/**
 * Aplica as regras de preço da loja sobre o valor devolvido pelo provedor.
 * Nunca deixa o preço ficar negativo.
 */
export function applyStorePricing(
  basePrice: number,
  config: Pick<StoreShippingConfig, "pricing" | "freeShipping">,
  quote: Pick<ShippingQuote, "serviceCode" | "serviceName">,
  context: PricingContext = {},
): PricingOutcome {
  const appliedRules: string[] = [];
  let price = roundMoney(basePrice);

  if (isFreeShippingEligible(config.freeShipping, quote, context)) {
    return { price: 0, basePrice, appliedRules: ["freeShipping"], freeShippingApplied: true };
  }

  if (config.pricing.fee) {
    price = roundMoney(price + applyAdjustment(price, config.pricing.fee));
    appliedRules.push("fee");
  }

  if (config.pricing.subsidy) {
    price = roundMoney(price - applyAdjustment(price, config.pricing.subsidy));
    appliedRules.push("subsidy");
  }

  return { price: Math.max(0, price), basePrice, appliedRules, freeShippingApplied: false };
}
