/**
 * Money — valor monetário com moeda explícita.
 *
 * O motor nunca soma valores de moedas diferentes: isso é tratado como erro de
 * programação (`INVALID_REQUEST` padrão do domínio seria enganoso, então
 * lançamos `Error` puro e deixamos a borda validar).
 */

export type Currency = "BRL" | (string & {});

export type Money = {
  amount: number;
  currency: Currency;
};

export const DEFAULT_CURRENCY: Currency = "BRL";

/** Arredonda para 2 casas (half-up), evitando ruído de ponto flutuante. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function money(amount: number, currency: Currency = DEFAULT_CURRENCY): Money {
  if (!Number.isFinite(amount)) {
    throw new Error("Valor monetário inválido.");
  }
  return { amount: roundMoney(amount), currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Não é possível somar moedas diferentes (${a.currency} x ${b.currency}).`);
  }
  return money(a.amount + b.amount, a.currency);
}

export function sumMoney(values: readonly Money[], currency: Currency = DEFAULT_CURRENCY): Money {
  return values.reduce((total, value) => addMoney(total, value), money(0, currency));
}

export function isZeroMoney(value: Money): boolean {
  return value.amount === 0;
}
