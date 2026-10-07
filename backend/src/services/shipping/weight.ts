import { env } from "../../env.js";
import type { ShippingItem } from "./types.js";

/**
 * Peso total = soma(peso_unitario x quantidade) + margem fixa da embalagem.
 * NUNCA calcular apenas pela quantidade de itens.
 */
export function calculateWeightKg(items: ShippingItem[]): number {
  const itemsWeight = items.reduce((total, item) => {
    const unit = Number.isFinite(item.peso_unitario) && item.peso_unitario > 0 ? item.peso_unitario : 0;
    const quantity = Number.isFinite(item.quantidade) && item.quantidade > 0 ? Math.floor(item.quantidade) : 0;
    return total + unit * quantity;
  }, 0);

  const margin = env.SHIPPING_WEIGHT_MARGIN_KG;
  // Arredonda para 3 casas (gramas) para evitar ruido de ponto flutuante.
  return Math.round((itemsWeight + margin) * 1000) / 1000;
}
