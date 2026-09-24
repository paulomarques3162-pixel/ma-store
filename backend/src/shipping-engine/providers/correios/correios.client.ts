import {
  providerAuthError,
  providerTimeout,
  providerUnavailable,
  rateLimited,
  serviceUnavailable,
} from "../../domain/errors.js";
import type { CorreiosConfig } from "./correios.config.js";
import {
  parseCorreiosDeadline,
  parseCorreiosErrorMessage,
  parseCorreiosPrice,
  type ParsedDeadline,
  type ParsedPrice,
} from "./correios.mapper.js";

export type HttpResponseLike = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<HttpResponseLike>;

export type CorreiosPriceParams = {
  serviceCode: string;
  origin: string;
  destination: string;
  weightGrams: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  declaredValue?: number;
};

export type CorreiosDeadlineParams = {
  serviceCode: string;
  origin: string;
  destination: string;
};

/**
 * Cliente HTTP isolado dos Correios (API Token + Preço + Prazo).
 *
 * - Bearer token com cache/expiração.
 * - Erros HTTP traduzidos para `ShippingError` com código padronizado.
 * - Sem segredos em logs; nenhuma URL fictícia.
 */
export class CorreiosClient {
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: CorreiosConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly now: () => number = Date.now,
  ) {}

  async getToken(): Promise<string> {
    if (this.config.auth.token) return this.config.auth.token;
    if (this.tokenCache && this.tokenCache.expiresAt > this.now()) return this.tokenCache.token;

    const credentials = `${this.config.auth.username ?? ""}:${this.config.auth.password ?? ""}`;
    const basic = Buffer.from(credentials, "utf8").toString("base64");

    const { path, body } = this.tokenRequest();
    const response = await this.send(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const payload = await response.json();
    const record = (Array.isArray(payload) ? payload[0] : payload) as Record<string, unknown> | undefined;
    const token = record && typeof record.token === "string" ? record.token : null;
    if (!token) {
      throw providerAuthError("Não foi possível obter o token dos Correios.");
    }

    const expiresAt = this.parseExpiry(record?.expiraEm);
    this.tokenCache = { token, expiresAt };
    return token;
  }

  async getPrice(params: CorreiosPriceParams): Promise<ParsedPrice> {
    const token = await this.getToken();
    const url = new URL(`${this.config.baseUrl}/preco/v1/nacional/${encodeURIComponent(params.serviceCode)}`);
    url.searchParams.set("cepOrigem", params.origin);
    url.searchParams.set("cepDestino", params.destination);
    // A API oficial exige o peso em GRAMAS e as medidas para tpObjeto=2 (Pacote).
    url.searchParams.set("psObjeto", String(Math.max(1, Math.round(params.weightGrams))));
    url.searchParams.set("tpObjeto", "2");
    url.searchParams.set("comprimento", String(Math.round(params.lengthCm)));
    url.searchParams.set("largura", String(Math.round(params.widthCm)));
    url.searchParams.set("altura", String(Math.round(params.heightCm)));
    if (this.config.contract) url.searchParams.set("nuContrato", this.config.contract);
    if (this.config.dr) url.searchParams.set("nuDR", this.config.dr);
    if (this.config.declaredValueEnabled && typeof params.declaredValue === "number") {
      url.searchParams.set("vlDeclarado", String(params.declaredValue));
    }

    const response = await this.send(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const payload = await response.json();
    const parsed = parseCorreiosPrice(payload);
    if (!parsed) {
      throw serviceUnavailable(parseCorreiosErrorMessage(payload) ?? "Preço indisponível para este trecho.");
    }
    return parsed;
  }

  async getDeadline(params: CorreiosDeadlineParams): Promise<ParsedDeadline> {
    const token = await this.getToken();
    const body = {
      idLote: "1",
      parametrosPrazo: [
        {
          coProduto: params.serviceCode,
          cepOrigem: params.origin,
          cepDestino: params.destination,
          nuRequisicao: "1",
        },
      ],
    };

    const response = await this.send(`${this.config.baseUrl}/prazo/v3/nacional`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    const parsed = parseCorreiosDeadline(payload);
    if (!parsed) {
      throw serviceUnavailable(parseCorreiosErrorMessage(payload) ?? "Prazo indisponível para este trecho.");
    }
    return parsed;
  }

  /** Teste de conexão: mede latência da autenticação sem expor credenciais. */
  async testConnection(): Promise<{ connected: boolean; latencyMs: number }> {
    const startedAt = this.now();
    await this.getToken();
    return { connected: true, latencyMs: this.now() - startedAt };
  }

  private tokenRequest(): { path: string; body?: Record<string, unknown> } {
    switch (this.config.auth.mode) {
      case "contract": {
        const contract = this.config.auth.contract ?? this.config.contract;
        return { path: "/token/v1/autentica/contrato", body: { contrato: contract, ...(this.config.dr ? { dr: this.config.dr } : {}) } };
      }
      case "card":
        return { path: "/token/v1/autentica/cartaopostagem", body: { numeroCartaoPostagem: this.config.auth.card } };
      case "id-correios":
      case "pre-generated-token":
      default:
        return { path: "/token/v1/autentica" };
    }
  }

  private parseExpiry(value: unknown): number {
    // Renova 1 minuto antes do vencimento; sem data confiável, assume 10 min.
    if (typeof value === "string") {
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp)) return timestamp - 60_000;
    }
    return this.now() + 10 * 60_000;
  }

  private async send(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<HttpResponseLike> {
    let response: HttpResponseLike;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : "falha de rede";
      if (/abort|timeout/i.test(message)) throw providerTimeout();
      throw providerUnavailable("Não foi possível conectar aos Correios.", { technical: message });
    }

    if (response.ok) return response;

    if (response.status === 401 || response.status === 403) {
      throw providerAuthError("Credenciais dos Correios inválidas ou sem permissão para esta API.");
    }
    if (response.status === 429) {
      throw rateLimited("Limite de requisições dos Correios atingido.");
    }
    if (response.status >= 500) {
      throw providerUnavailable("Correios indisponível no momento.");
    }

    let detail: string | null = null;
    try {
      detail = parseCorreiosErrorMessage(await response.json());
    } catch {
      detail = null;
    }
    throw serviceUnavailable(detail ?? "Os Correios recusaram a consulta de frete.", {
      technical: `HTTP ${response.status}`,
    });
  }
}
