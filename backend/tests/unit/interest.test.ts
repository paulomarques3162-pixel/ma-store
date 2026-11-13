import { describe, expect, it } from "vitest";
import {
  NO_INTEREST,
  centsToAmount,
  computeCartInterest,
  computeInterest,
  type InterestRule,
} from "../../src/services/interest.js";

/**
 * Testes PUROS do motor de juros (sem banco). Cobrem os cenários obrigatórios:
 * sem juros, taxa fixa, percentual simples, mensal (Price), limites de parcelas,
 * valor mínimo da parcela, loja absorvendo e arredondamento monetário.
 */

const rule = (over: Partial<InterestRule> = {}): InterestRule => ({
  enabled: true,
  type: "PERCENT_SIMPLE",
  rate: 10,
  payer: "CUSTOMER",
  maxInstallments: 12,
  minInstallmentValue: null,
  ...over,
});

const cents = (amount: number) => Math.round(amount * 100);

describe("computeInterest", () => {
  it("produto sem juros (regra desabilitada) nao aplica nada", () => {
    const plan = computeInterest({ principalCents: cents(100), installments: 6, method: "CREDIT_CARD", rule: NO_INTEREST });
    expect(plan.applied).toBe(false);
    expect(plan.interestCents).toBe(0);
    expect(plan.customerCents).toBe(cents(100));
  });

  it("nao aplica juros em PIX ou boleto", () => {
    for (const method of ["PIX", "BOLETO", "COMBINAR"]) {
      const plan = computeInterest({ principalCents: cents(100), installments: 6, method, rule: rule() });
      expect(plan.applied, method).toBe(false);
      expect(plan.reason).toBe("method_not_supported");
      expect(plan.customerCents).toBe(cents(100));
    }
  });

  it("nao aplica juros em pagamento a vista (1 parcela)", () => {
    const plan = computeInterest({ principalCents: cents(100), installments: 1, method: "CREDIT_CARD", rule: rule() });
    expect(plan.applied).toBe(false);
    expect(plan.reason).toBe("single_payment");
  });

  it("taxa fixa soma o valor fixo ao total", () => {
    const plan = computeInterest({
      principalCents: cents(200),
      installments: 4,
      method: "CREDIT_CARD",
      rule: rule({ type: "FIXED", rate: 15 }),
    });
    expect(plan.applied).toBe(true);
    expect(plan.interestCents).toBe(cents(15));
    expect(plan.customerCents).toBe(cents(215));
    expect(plan.installmentCents * plan.installments).toBe(plan.customerCents);
  });

  it("taxa percentual simples aplica o percentual uma vez", () => {
    const plan = computeInterest({
      principalCents: cents(100),
      installments: 3,
      method: "CREDIT_CARD",
      rule: rule({ type: "PERCENT_SIMPLE", rate: 10 }),
    });
    expect(plan.applied).toBe(true);
    // O total é arredondado para cima até ser divisível pelo nº de parcelas
    // (no máximo 1 centavo por parcela), garantindo soma == total.
    expect(plan.customerCents).toBeGreaterThanOrEqual(cents(110));
    expect(plan.customerCents - cents(110)).toBeLessThanOrEqual(plan.installments);
    expect(plan.installmentCents * plan.installments).toBe(plan.customerCents);
  });

  it("taxa mensal (Tabela Price) gera juros compostos maiores que os simples", () => {
    const monthly = computeInterest({
      principalCents: cents(1000),
      installments: 12,
      method: "CREDIT_CARD",
      rule: rule({ type: "PERCENT_MONTHLY", rate: 2 }),
    });
    const simple = computeInterest({
      principalCents: cents(1000),
      installments: 12,
      method: "CREDIT_CARD",
      rule: rule({ type: "PERCENT_SIMPLE", rate: 2 }),
    });
    expect(monthly.applied).toBe(true);
    expect(monthly.customerCents).toBeGreaterThan(simple.customerCents);
    expect(monthly.installmentCents * monthly.installments).toBe(monthly.customerCents);
  });

  it("respeita o maximo de parcelas configurado", () => {
    const plan = computeInterest({
      principalCents: cents(300),
      installments: 12,
      method: "CREDIT_CARD",
      rule: rule({ maxInstallments: 3 }),
    });
    expect(plan.installments).toBe(3);
  });

  it("reduz as parcelas para respeitar o valor minimo da parcela", () => {
    const plan = computeInterest({
      principalCents: cents(100),
      installments: 10,
      method: "CREDIT_CARD",
      rule: rule({ minInstallmentValue: 30, maxInstallments: 10 }),
    });
    // 100/10 = 10 < 30 -> reduz ate caber (100/3 = 33,33)
    expect(plan.installments).toBe(3);
    expect(plan.installmentCents).toBeGreaterThanOrEqual(3000);
  });

  it("loja absorve os juros: cliente paga no maximo o principal", () => {
    const plan = computeInterest({
      principalCents: cents(100),
      installments: 3,
      method: "CREDIT_CARD",
      rule: rule({ payer: "MERCHANT", type: "PERCENT_SIMPLE", rate: 10 }),
    });
    expect(plan.applied).toBe(true);
    expect(plan.customerCents).toBeLessThanOrEqual(cents(100));
    expect(plan.merchantAbsorbedCents).toBeGreaterThan(0);
  });

  it("a soma das parcelas e sempre igual ao total informado", () => {
    for (const type of ["PERCENT_SIMPLE", "PERCENT_MONTHLY", "FIXED"] as const) {
      for (const n of [2, 3, 7, 12]) {
        const plan = computeInterest({
          principalCents: 9999,
          installments: n,
          method: "CREDIT_CARD",
          rule: rule({ type, rate: 7.5, maxInstallments: 12 }),
        });
        expect(plan.installmentCents * plan.installments, `${type}/${n}`).toBe(plan.customerCents);
      }
    }
  });

  it("nao aplica juros com taxa zero", () => {
    const plan = computeInterest({
      principalCents: cents(100),
      installments: 6,
      method: "CREDIT_CARD",
      rule: rule({ rate: 0 }),
    });
    expect(plan.applied).toBe(false);
    expect(plan.reason).toBe("zero_rate");
  });
});

describe("computeCartInterest", () => {
  const rules = new Map<string, InterestRule>([
    ["a", rule({ type: "PERCENT_SIMPLE", rate: 10 })],
    ["b", rule({ type: "FIXED", rate: 5 })],
  ]);

  it("aplica a regra de cada produto e soma os totais", () => {
    const result = computeCartInterest({
      items: [
        { productId: "a", quantity: 1, unitPrice: 100 },
        { productId: "b", quantity: 2, unitPrice: 50 },
      ],
      installments: 2,
      method: "CREDIT_CARD",
      rules,
    });
    // a: 100 + 10% = 110 ; b: (50*2) + 5 = 105 -> total 215
    expect(centsToAmount(result.subtotalCents)).toBe(200);
    expect(centsToAmount(result.totalCents)).toBe(215);
    expect(centsToAmount(result.interestCents)).toBe(15);
  });

  it("produto sem regra nao recebe juros", () => {
    const result = computeCartInterest({
      items: [{ productId: "sem-regra", quantity: 1, unitPrice: 100 }],
      installments: 6,
      method: "CREDIT_CARD",
      rules,
    });
    expect(result.applied).toBe(false);
    expect(result.totalCents).toBe(cents(100));
  });

  it("nao aplica taxa duas vezes em item repetido (usa a quantidade)", () => {
    const result = computeCartInterest({
      items: [{ productId: "a", quantity: 2, unitPrice: 100 }],
      installments: 2,
      method: "CREDIT_CARD",
      rules,
    });
    // 200 + 10% = 220 (uma vez)
    expect(centsToAmount(result.totalCents)).toBe(220);
  });
});
