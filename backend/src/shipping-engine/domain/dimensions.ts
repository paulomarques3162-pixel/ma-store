import type { Brand } from "./brand.js";
import { invalidDimensions } from "./errors.js";

/** Dimensão em centímetros. */
export type Centimeters = Brand<number, "Centimeters">;

/** Divisor padrão de peso cúbico usado pelo mercado (cm³ / 6000 = kg). */
export const DEFAULT_CUBIC_DIVISOR = 6000;

/** Cria uma dimensão válida (> 0). Lança `INVALID_DIMENSIONS`. */
export function centimeters(value: number): Centimeters {
  if (!Number.isFinite(value) || value <= 0) {
    throw invalidDimensions();
  }
  return Math.round(value) as Centimeters;
}

/** Soma das três dimensões (alguns provedores limitam esse total). */
export function sumDimensionsCm(height: number, width: number, length: number): number {
  return height + width + length;
}

/**
 * Peso cúbico em gramas: (altura x largura x comprimento) / divisor * 1000.
 * O divisor é configurável porque cada provedor usa o seu.
 */
export function cubicWeightGrams(
  height: number,
  width: number,
  length: number,
  divisor: number = DEFAULT_CUBIC_DIVISOR,
): number {
  if (!Number.isFinite(divisor) || divisor <= 0) {
    throw invalidDimensions("Divisor de peso cúbico inválido.");
  }
  return Math.round(((height * width * length) / divisor) * 1000);
}
