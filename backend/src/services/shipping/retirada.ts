import { env } from "../../env.js";
import type { ShippingOption } from "./types.js";

/** Retirada na loja: sempre gratuita. */
export function quoteRetirada(): ShippingOption | null {
  if (!env.RETIRADA_ATIVA) return null;

  return {
    id: "retirada",
    nome: env.RETIRADA_NOME,
    valor: 0,
    prazo: env.RETIRADA_PRAZO,
    carrier: null,
    descricao: "Grátis — você retira o pedido na loja.",
    pagoDireto: false,
    incluirNoTotal: true,
  };
}
