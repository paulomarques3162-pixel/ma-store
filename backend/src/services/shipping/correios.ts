import { env } from "../../env.js";
import type { ShippingOption } from "./types.js";

/**
 * Adapter isolado dos Correios (API oficial de Preco e Prazo).
 *
 * - Credenciais SEMPRE via environment (`CORREIOS_TOKEN`, `CORREIOS_ORIGEM_CEP`).
 * - NUNCA inventamos preco nem prazo: se a API falhar ou nao estiver
 *   configurada, a modalidade simplesmente nao e ofertada e um aviso e
 *   devolvido ao frontend.
 * - Os codigos de servico sao configuraveis, pois a API oficial ja mudou de
 *   contrato mais de uma vez.
 */

const PRODUCTS = [
  { id: "pac", nome: "Correios PAC", codigo: () => env.CORREIOS_PAC_CODE },
  { id: "sedex", nome: "Correios SEDEX", codigo: () => env.CORREIOS_SEDEX_CODE },
] as const;

export function correiosConfigured(): boolean {
  return Boolean(env.CORREIOS_TOKEN.trim() && env.CORREIOS_ORIGEM_CEP.trim());
}

type CorreiosRawResponse = {
  pcFinal?: string | number;
  pcBase?: string | number;
  valor?: string | number;
  prazoEntrega?: string | number;
  prazo?: string | number;
  msgErro?: string;
  erro?: string;
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/[^\d,.-]/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Normaliza a resposta (array ou objeto) do endpoint oficial. */
function parseResponse(payload: unknown): { valor: number; prazo: string } | null {
  const record = (Array.isArray(payload) ? payload[0] : payload) as CorreiosRawResponse | undefined;
  if (!record) return null;

  const valor = toNumber(record.pcFinal ?? record.pcBase ?? record.valor);
  const prazoRaw = record.prazoEntrega ?? record.prazo;
  if (valor === null || prazoRaw === undefined) return null;

  const prazo = /dia/i.test(String(prazoRaw)) ? String(prazoRaw) : `${prazoRaw} dias úteis`;
  return { valor, prazo };
}

async function fetchProducto(
  codigo: string,
  params: { origem: string; destino: string; pesoKg: number },
): Promise<{ valor: number; prazo: string } | null> {
  const url = new URL(`/preco/v1/nacional/${encodeURIComponent(codigo)}`, env.CORREIOS_API_URL);
  url.searchParams.set("cepOrigem", params.origem);
  url.searchParams.set("cepDestino", params.destino);
  url.searchParams.set("psObjeto", String(params.pesoKg));
  url.searchParams.set("tpObjeto", "2");
  if (env.CORREIOS_CONTRATO) url.searchParams.set("nuContrato", env.CORREIOS_CONTRATO);
  if (env.CORREIOS_DR) url.searchParams.set("nuDR", env.CORREIOS_DR);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.CORREIOS_TOKEN}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as unknown;
    return parseResponse(payload);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type CorreiosQuote = { options: ShippingOption[]; warnings: string[]; retryable: boolean };

/** Cota PAC e SEDEX. Peso minimo aceito pelos Correios: 0.3kg. */
export async function quoteCorreios(params: {
  cepDestino: string;
  pesoKg: number;
}): Promise<CorreiosQuote> {
  if (!correiosConfigured()) {
    return { options: [], warnings: [], retryable: false };
  }

  const pesoKg = Math.max(params.pesoKg, 0.3);
  const origem = env.CORREIOS_ORIGEM_CEP.replace(/\D/g, "");

  const results = await Promise.all(
    PRODUCTS.map(async (product) => {
      const data = await fetchProducto(product.codigo(), {
        origem,
        destino: params.cepDestino,
        pesoKg,
      });
      if (!data) return null;

      const option: ShippingOption = {
        id: product.id,
        nome: product.nome,
        valor: data.valor,
        prazo: data.prazo,
        carrier: "Correios",
        descricao: "O valor do frete é pago diretamente aos Correios no despacho.",
        pagoDireto: true,
        incluirNoTotal: false,
      };
      return option;
    }),
  );

  const options = results.filter((option): option is ShippingOption => option !== null);
  const failed = options.length < PRODUCTS.length;

  return {
    options,
    warnings: failed
      ? ["Não foi possível calcular uma ou mais modalidades dos Correios. Tente novamente."]
      : [],
    retryable: failed,
  };
}
