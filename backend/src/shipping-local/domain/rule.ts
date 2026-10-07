/**
 * Selecao da regra de peso aplicavel.
 *
 * Ordem deterministica: prioridade DESC, depois faixa mais especifica
 * (minWeightGrams DESC), depois id (estavel). Sem regra => SHIPPING_RULE_NOT_FOUND
 * tratado no servico (nunca um preco ficticio).
 */
import type { ShippingWeightRuleRecord } from "./types.js";

export function selectWeightRule(
  rules: ShippingWeightRuleRecord[],
  weightGrams: number,
): ShippingWeightRuleRecord | null {
  const matches = rules.filter(
    (rule) => rule.active && rule.minWeightGrams <= weightGrams && rule.maxWeightGrams >= weightGrams,
  );
  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.minWeightGrams !== a.minWeightGrams) return b.minWeightGrams - a.minWeightGrams;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return matches[0]!;
}
