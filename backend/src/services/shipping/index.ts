import { normalizeCep } from "../../lib/validation.js";
import { quoteCorreios } from "./correios.js";
import { quoteFlex } from "./flex.js";
import { quoteJetlog } from "./jetlog.js";
import { quotePegaki } from "./pegaki.js";
import { quoteRetirada } from "./retirada.js";
import type { ShippingItem, ShippingOption, ShippingQuoteResult } from "./types.js";
import { calculateWeightKg } from "./weight.js";

export type { ShippingItem, ShippingOption, ShippingQuoteResult } from "./types.js";
export { calculateWeightKg } from "./weight.js";

/**
 * Motor de frete unico.
 *
 * Ordem das modalidades: Retirada -> Motoboy/Flex (regra de CEP) ->
 * Correios PAC/SEDEX -> Jetlog -> Pegaki.
 *
 * Nenhum valor e inventado: o que nao pode ser calculado simplesmente nao
 * aparece na resposta (com aviso quando faz sentido).
 */
export async function quoteShipping(params: {
  cep: string;
  items: ShippingItem[];
  /** Subtotal opcional para eventual frete gratis (nao usado por padrao). */
  subtotal?: number;
}): Promise<ShippingQuoteResult> {
  const cep = normalizeCep(params.cep);
  const items = params.items
    .map((item) => ({
      id: String(item.id),
      nome: String(item.nome ?? ""),
      quantidade: Math.max(1, Math.floor(Number(item.quantidade) || 1)),
      peso_unitario: Math.max(0, Number(item.peso_unitario) || 0),
    }))
    .filter((item) => item.id.length > 0);

  const pesoTotal = calculateWeightKg(items);
  const warnings: string[] = [];
  let retryable = false;

  const options: ShippingOption[] = [];

  const retirada = quoteRetirada();
  if (retirada) options.push(retirada);

  const flex = quoteFlex(cep);
  if (flex) options.push(flex);

  // Correios (PAC/SEDEX). Cliente paga direto a transportadora.
  const correios = await quoteCorreios({ cepDestino: cep, pesoKg: pesoTotal });
  options.push(...correios.options);
  warnings.push(...correios.warnings);
  if (correios.retryable) retryable = true;

  const jetlog = await quoteJetlog({ cepDestino: cep, pesoKg: pesoTotal });
  if (jetlog.option) options.push(jetlog.option);
  if (jetlog.warning) warnings.push(jetlog.warning);

  const pegaki = await quotePegaki({ cepDestino: cep, pesoKg: pesoTotal });
  if (pegaki.option) options.push(pegaki.option);
  if (pegaki.warning) warnings.push(pegaki.warning);

  // Deduplica por id preservando a ordem e nunca deixa valor negativo.
  const seen = new Set<string>();
  const cleanOptions = options
    .filter((option) => {
      if (seen.has(option.id)) return false;
      seen.add(option.id);
      return true;
    })
    .map((option) => ({ ...option, valor: Math.max(0, Number(option.valor) || 0) }));

  return {
    success: cleanOptions.length > 0,
    cep,
    pesoTotal,
    options: cleanOptions,
    warnings,
    retryable,
  };
}

/** Localiza uma modalidade pelo id dentro de uma cotacao. */
export function findShippingOption(quote: ShippingQuoteResult, optionId: string): ShippingOption | null {
  return quote.options.find((option) => option.id === optionId) ?? null;
}
