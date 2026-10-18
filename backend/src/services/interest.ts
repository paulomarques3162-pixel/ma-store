import type { InterestRule as InterestRuleRow } from "@prisma/client";
import { prisma } from "../db.js";
import { decimalToNumber } from "../lib/serialize.js";

/**
 * Juros e encargos configuráveis pelo ADMINISTRADOR (por produto ou padrão).
 *
 * Regras de ouro:
 *  - o cálculo é SEMPRE refeito no backend a partir do banco; o frontend nunca
 *    é a fonte da verdade;
 *  - juros só se aplicam ao CARTÃO DE CRÉDITO parcelado (nunca a PIX/boleto sem
 *    uma regra explícita), e apenas quando a regra está habilitada;
 *  - dinheiro é calculado em CENTAVOS (inteiros) para evitar erro de arredondamento;
 *  - a soma das parcelas é exatamente igual ao total informado ao cliente;
 *  - a taxa configurada é juros COMERCIAIS da loja — NÃO altera as tarifas do
 *    Mercado Pago (elas são independentes e cobradas pelo próprio provedor).
 */

export type InterestType = "PERCENT_MONTHLY" | "PERCENT_SIMPLE" | "FIXED";
export type InterestPayer = "CUSTOMER" | "MERCHANT";

export type InterestRule = {
  enabled: boolean;
  type: InterestType;
  /** Percentual (mensal/simples) ou valor fixo (R$), conforme `type`. */
  rate: number;
  payer: InterestPayer;
  maxInstallments: number;
  minInstallmentValue: number | null;
};

export const NO_INTEREST: InterestRule = {
  enabled: false,
  type: "PERCENT_MONTHLY",
  rate: 0,
  payer: "CUSTOMER",
  maxInstallments: 1,
  minInstallmentValue: null,
};

export type InterestPlan = {
  applied: boolean;
  /** Motivo técnico (sem dados sensíveis) quando não aplicado. */
  reason: string;
  type: InterestType;
  payer: InterestPayer;
  rate: number;
  installments: number;
  principalCents: number;
  /** Juros comerciais totais (independente de quem paga). */
  interestCents: number;
  /** Total efetivamente pago pelo cliente (parcelas somam exatamente isto). */
  customerCents: number;
  /** Valor de cada parcela (todas iguais). */
  installmentCents: number;
  /** Parte dos juros absorvida pela loja (payer = MERCHANT). */
  merchantAbsorbedCents: number;
};

const toCents = (value: number): number => Math.round(value * 100);
const fromCents = (cents: number): number => Math.round(cents) / 100;

/** Converte centavos em reais com 2 casas (arredondamento monetário). */
export function centsToAmount(cents: number): number {
  return fromCents(Math.round(cents));
}

export function normalizeType(value: string | null | undefined): InterestType {
  const key = (value ?? "").trim().toUpperCase();
  if (key === "FIXED" || key === "PERCENT_SIMPLE") return key;
  return "PERCENT_MONTHLY";
}

export function normalizePayer(value: string | null | undefined): InterestPayer {
  return (value ?? "").trim().toUpperCase() === "MERCHANT" ? "MERCHANT" : "CUSTOMER";
}

/**
 * Cálculo PURO e determinístico dos juros.
 *
 * `PERCENT_MONTHLY` usa a Tabela Price (juros compostos mensais):
 *   parcela = principal * i / (1 - (1 + i)^-n)
 * `PERCENT_SIMPLE` aplica o percentual uma única vez sobre o principal.
 * `FIXED` soma um valor fixo em reais.
 */
export function computeInterest(input: {
  principalCents: number;
  installments: number;
  method: string;
  rule: InterestRule;
}): InterestPlan {
  const principal = Math.max(0, Math.round(input.principalCents));
  const requested = Math.max(1, Math.floor(input.installments || 1));
  const base: InterestPlan = {
    applied: false,
    reason: "disabled",
    type: input.rule.type,
    payer: input.rule.payer,
    rate: input.rule.rate,
    installments: requested,
    principalCents: principal,
    interestCents: 0,
    customerCents: principal,
    installmentCents: principal,
    merchantAbsorbedCents: 0,
  };

  if (!input.rule.enabled) return base;
  // Juros comerciais só se aplicam ao cartão de crédito (parcelamento).
  if (input.method !== "CREDIT_CARD") return { ...base, reason: "method_not_supported" };
  if (requested <= 1) return { ...base, reason: "single_payment" };
  if (!(input.rule.rate > 0)) return { ...base, reason: "zero_rate" };

  // Respeita o máximo de parcelas e o valor mínimo por parcela.
  let installments = Math.min(requested, Math.max(1, Math.floor(input.rule.maxInstallments)));
  const minCents = input.rule.minInstallmentValue && input.rule.minInstallmentValue > 0 ? toCents(input.rule.minInstallmentValue) : 0;
  if (minCents > 0) {
    while (installments > 1 && Math.floor(principal / installments) < minCents) installments -= 1;
  }
  if (installments <= 1) return { ...base, reason: "single_payment", installments: 1 };

  let interestCents = 0;
  if (input.rule.type === "FIXED") {
    interestCents = toCents(input.rule.rate);
  } else if (input.rule.type === "PERCENT_SIMPLE") {
    interestCents = Math.round(principal * (input.rule.rate / 100));
  } else {
    const i = input.rule.rate / 100;
    const factor = Math.pow(1 + i, installments);
    const payment = (principal * (i * factor)) / (factor - 1);
    interestCents = Math.max(0, Math.round(payment * installments) - principal);
  }

  if (input.rule.payer === "MERCHANT") {
    // Loja absorve os juros: o cliente paga no máximo o principal.
    const installmentCents = Math.max(1, Math.floor(principal / installments));
    const customerCents = installmentCents * installments;
    return {
      applied: true,
      reason: "applied_merchant",
      type: input.rule.type,
      payer: "MERCHANT",
      rate: input.rule.rate,
      installments,
      principalCents: principal,
      interestCents,
      customerCents,
      installmentCents,
      merchantAbsorbedCents: interestCents + (principal - customerCents),
    };
  }

  // Cliente paga: arredonda o total para cima até ser divisível pelo nº de
  // parcelas, garantindo que a SOMA das parcelas == total informado.
  const rawTotal = principal + interestCents;
  const installmentCents = Math.ceil(rawTotal / installments);
  const customerCents = installmentCents * installments;
  return {
    applied: true,
    reason: "applied_customer",
    type: input.rule.type,
    payer: "CUSTOMER",
    rate: input.rule.rate,
    installments,
    principalCents: principal,
    interestCents: customerCents - principal,
    customerCents,
    installmentCents,
    merchantAbsorbedCents: 0,
  };
}

export function ruleFromRow(row: InterestRuleRow): InterestRule {
  return {
    enabled: row.enabled,
    type: normalizeType(row.type),
    rate: decimalToNumber(row.rate),
    payer: normalizePayer(row.payer),
    maxInstallments: Math.max(1, row.maxInstallments),
    minInstallmentValue: row.minInstallmentValue === null ? null : decimalToNumber(row.minInstallmentValue),
  };
}

/**
 * Resolve a regra de cada produto com precedência EXPLÍCITA:
 * regra do produto > regra padrão da loja > sem juros.
 */
export async function loadInterestRules(productIds: string[]): Promise<Map<string, InterestRule>> {
  const unique = [...new Set(productIds)];
  const [defaultRow, productRows] = await Promise.all([
    prisma.interestRule.findUnique({ where: { id: "default" } }),
    unique.length > 0
      ? prisma.interestRule.findMany({ where: { productId: { in: unique } } })
      : Promise.resolve([] as InterestRuleRow[]),
  ]);

  const fallback = defaultRow ? ruleFromRow(defaultRow) : NO_INTEREST;
  const map = new Map<string, InterestRule>();
  for (const id of unique) map.set(id, fallback);
  for (const row of productRows) {
    if (row.productId) map.set(row.productId, ruleFromRow(row));
  }
  return map;
}

export type CartInterestLine = {
  productId: string;
  quantity: number;
  unitPrice: number;
  principalCents: number;
  plan: InterestPlan;
};

export type CartInterestResult = {
  applied: boolean;
  installments: number;
  subtotalCents: number;
  interestCents: number;
  totalCents: number;
  merchantAbsorbedCents: number;
  lines: CartInterestLine[];
};

/**
 * Calcula os juros de um carrinho inteiro. Cada produto usa a sua própria regra
 * (ou a padrão); o total soma os valores por produto, sem aplicar taxa duas vezes.
 */
export function computeCartInterest(input: {
  items: Array<{ productId: string; quantity: number; unitPrice: number }>;
  installments: number;
  method: string;
  rules: Map<string, InterestRule>;
}): CartInterestResult {
  const lines: CartInterestLine[] = input.items.map((item) => {
    const principalCents = toCents(item.unitPrice) * Math.max(0, Math.floor(item.quantity));
    const rule = input.rules.get(item.productId) ?? NO_INTEREST;
    const plan = computeInterest({
      principalCents,
      installments: input.installments,
      method: input.method,
      rule,
    });
    return { productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice, principalCents, plan };
  });

  const subtotalCents = lines.reduce((total, line) => total + line.principalCents, 0);
  const totalCents = lines.reduce((total, line) => total + line.plan.customerCents, 0);
  const interestCents = lines.reduce((total, line) => total + (line.plan.customerCents - line.principalCents), 0);
  const merchantAbsorbedCents = lines.reduce((total, line) => total + line.plan.merchantAbsorbedCents, 0);

  return {
    applied: lines.some((line) => line.plan.applied),
    installments: Math.max(1, ...lines.map((line) => line.plan.installments)),
    subtotalCents,
    interestCents,
    totalCents,
    merchantAbsorbedCents,
    lines,
  };
}
