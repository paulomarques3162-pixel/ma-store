/**
 * Calculo de peso e volume do Shipping Engine proprio.
 *
 * Regras (documentadas de proposito):
 *  - peso do item = peso unitario do produto (gramas) x quantidade;
 *  - peso total  = soma dos itens;
 *  - peso calculado = peso total + padding de embalagem (configurado pelo admin;
 *    quando nao configurado, nada e somado — nunca inventamos um valor);
 *  - volume: estrategia inicial SIMPLES e conservadora -> soma dos volumes dos
 *    itens. Nao ha "multiplicar volumes" nem cubagem: fica preparado para
 *    evolucao futura (multiplos volumes, cubagem, limite dimensional).
 */
import { validationError } from "../../lib/errors.js";

export type WeightItem = {
  weightGrams: number;
  quantity: number;
};

export function totalItemWeightGrams(items: WeightItem[]): number {
  return items.reduce((total, item) => total + item.weightGrams * item.quantity, 0);
}

export function applyPackagePadding(weightGrams: number, paddingGrams: number | null): number {
  const padding = paddingGrams ?? 0;
  return Math.max(0, weightGrams + Math.max(0, padding));
}

export type Dimensions = { heightCm: number; widthCm: number; lengthCm: number };

export function itemVolumeCm3(dimensions: Dimensions): number {
  return dimensions.heightCm * dimensions.widthCm * dimensions.lengthCm;
}

/**
 * Volume total: soma dos volumes unitarios x quantidade.
 * Retorna `null` quando algum item nao possui dimensoes completas — o frete
 * segue por peso (a ausencia de dimensao NAO e inventada como zero).
 */
export function totalVolumeCm3(
  items: Array<{ dimensions: Dimensions | null; quantity: number }>,
): number | null {
  if (items.length === 0) return null;
  let total = 0;
  for (const item of items) {
    if (!item.dimensions) return null;
    total += itemVolumeCm3(item.dimensions) * item.quantity;
  }
  return total;
}

/** Valida faixa de peso configurada pelo administrador. */
export function assertWeightRange(minWeightGrams: number, maxWeightGrams: number): void {
  if (!Number.isFinite(minWeightGrams) || !Number.isFinite(maxWeightGrams)) {
    throw validationError("Faixa de peso invalida.");
  }
  if (minWeightGrams < 0 || maxWeightGrams < 0 || minWeightGrams > maxWeightGrams) {
    throw validationError("A faixa de peso minima nao pode ser maior que a maxima.");
  }
}
