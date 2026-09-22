import { env } from "../../env.js";
import type { ShippingOption } from "./types.js";

/**
 * Adapter Jetlog.
 *
 * A Jetlog nao expoe um endpoint publico de cotacao documentado neste projeto.
 * Portanto:
 *  - se `JETLOG_API_URL` + `JETLOG_API_TOKEN` estiverem configurados, tentamos a
 *    cotacao real;
 *  - caso contrario, usamos o valor FIXO configurado pelo administrador
 *    (`JETLOG_VALOR`), sem inventar nada;
 *  - se nada estiver configurado, a modalidade nao aparece.
 */
export function jetlogConfigured(): boolean {
  return Boolean(env.JETLOG_API_URL.trim() && env.JETLOG_API_TOKEN.trim()) || env.JETLOG_VALOR !== undefined;
}

export async function quoteJetlog(params: {
  cepDestino: string;
  pesoKg: number;
}): Promise<{ option: ShippingOption | null; warning: string | null }> {
  if (env.JETLOG_API_URL.trim() && env.JETLOG_API_TOKEN.trim()) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const url = new URL(env.JETLOG_API_URL);
      url.searchParams.set("cepDestino", params.cepDestino);
      url.searchParams.set("peso", String(params.pesoKg));

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${env.JETLOG_API_TOKEN}`, Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        const payload = (await response.json()) as { valor?: number | string; prazo?: string };
        const valor = Number(String(payload.valor ?? "").replace(",", "."));
        if (Number.isFinite(valor)) {
          return {
            option: {
              id: "jetlog",
              nome: env.JETLOG_NOME,
              valor,
              prazo: payload.prazo ?? env.JETLOG_PRAZO,
              carrier: "Jetlog",
              descricao: null,
              pagoDireto: false,
              incluirNoTotal: true,
            },
            warning: null,
          };
        }
      }
    } catch {
      // Cai para o valor fixo (se configurado) sem quebrar o checkout.
    }
  }

  if (env.JETLOG_VALOR !== undefined) {
    return {
      option: {
        id: "jetlog",
        nome: env.JETLOG_NOME,
        valor: env.JETLOG_VALOR,
        prazo: env.JETLOG_PRAZO,
        carrier: "Jetlog",
        descricao: null,
        pagoDireto: false,
        incluirNoTotal: true,
      },
      warning: null,
    };
  }

  return { option: null, warning: null };
}
