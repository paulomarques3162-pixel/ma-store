import type { Brand } from "./brand.js";
import { invalidWeight } from "./errors.js";

/** Peso em gramas (unidade canônica do motor). */
export type Grams = Brand<number, "Grams">;

export const GRAMS_PER_KILOGRAM = 1000;

/** Cria um peso válido (> 0, inteiro em gramas). Lança `INVALID_WEIGHT`. */
export function grams(value: number): Grams {
  if (!Number.isFinite(value) || value <= 0) {
    throw invalidWeight();
  }
  return Math.round(value) as Grams;
}

export function kilogramsToGrams(value: number): Grams {
  return grams(value * GRAMS_PER_KILOGRAM);
}

/** Converte gramas para quilogramas (o valor pedido pelos provedores). */
export function gramsToKilograms(value: Grams | number): number {
  return Number(value) / GRAMS_PER_KILOGRAM;
}

export function isPositiveWeight(value: unknown): value is Grams {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
