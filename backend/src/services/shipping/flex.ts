import { env } from "../../env.js";
import type { ShippingOption } from "./types.js";

/**
 * Entrega Flex (Motoboy local).
 *
 * Regra unica e centralizada: a modalidade so aparece quando o CEP de destino
 * pertence a faixa configurada da origem da loja (prefixo de CEP).
 */
export function flexEligible(cep: string): boolean {
  const prefix = env.FLEX_CEP_PREFIX.trim();
  if (!prefix) return false;
  return cep.startsWith(prefix);
}

export function quoteFlex(cep: string): ShippingOption | null {
  if (!flexEligible(cep)) return null;

  return {
    id: "motoboy",
    nome: env.FLEX_NOME,
    valor: env.FLEX_VALOR,
    prazo: env.FLEX_PRAZO,
    carrier: env.FLEX_NOME,
    descricao: "Entrega local feita por motoboy.",
    pagoDireto: false,
    incluirNoTotal: true,
  };
}
