import { env } from "../../env.js";
import type { ShippingOption } from "./types.js";

/**
 * Adapter Pegaki (ponto de retirada).
 *
 * Sem credenciais/API oficiais disponiveis, NAO simulamos integracao real:
 * a modalidade so aparece quando o administrador configura explicitamente um
 * valor (`PEGAKI_VALOR`). Se houver API configurada, tentamos a cotacao real.
 */
export function pegakiConfigured(): boolean {
  return Boolean(env.PEGAKI_API_URL.trim() && env.PEGAKI_API_TOKEN.trim()) || env.PEGAKI_VALOR !== undefined;
}

export async function quotePegaki(params: {
  cepDestino: string;
  pesoKg: number;
}): Promise<{ option: ShippingOption | null; warning: string | null }> {
  if (env.PEGAKI_API_URL.trim() && env.PEGAKI_API_TOKEN.trim()) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const url = new URL(env.PEGAKI_API_URL);
      url.searchParams.set("cep", params.cepDestino);
      url.searchParams.set("peso", String(params.pesoKg));

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${env.PEGAKI_API_TOKEN}`, Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        const payload = (await response.json()) as { valor?: number | string; prazo?: string };
        const valor = Number(String(payload.valor ?? "").replace(",", "."));
        if (Number.isFinite(valor)) {
          return {
            option: {
              id: "pegaki",
              nome: env.PEGAKI_NOME,
              valor,
              prazo: payload.prazo ?? env.PEGAKI_PRAZO,
              carrier: "Pegaki",
              descricao: "Retirada em ponto parceiro Pegaki.",
              pagoDireto: false,
              incluirNoTotal: true,
            },
            warning: null,
          };
        }
      }
    } catch {
      // Sem API funcional: usa configuracao explicita abaixo.
    }
  }

  if (env.PEGAKI_VALOR !== undefined) {
    return {
      option: {
        id: "pegaki",
        nome: env.PEGAKI_NOME,
        valor: env.PEGAKI_VALOR,
        prazo: env.PEGAKI_PRAZO,
        carrier: "Pegaki",
        descricao: "Retirada em ponto parceiro Pegaki.",
        pagoDireto: false,
        incluirNoTotal: true,
      },
      warning: null,
    };
  }

  return { option: null, warning: null };
}
