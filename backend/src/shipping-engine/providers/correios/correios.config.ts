import type { ShippingServiceType } from "../../domain/service-catalog.js";

export type CorreiosAuthMode = "pre-generated-token" | "id-correios" | "contract" | "card";

export type CorreiosServiceConfig = {
  code: string;
  name: string;
  type: ShippingServiceType;
};

export type CorreiosConfig = {
  enabled: boolean;
  environment: "homologation" | "production";
  baseUrl: string;
  auth: {
    mode: CorreiosAuthMode;
    username?: string;
    password?: string;
    contract?: string;
    card?: string;
    /** Token já gerado (opcional) — dispensa usuário/senha. */
    token?: string;
  };
  originPostalCode: string;
  contract?: string;
  /** DR (Regional) do contrato — obrigatória quando há contrato. */
  dr?: string;
  services: CorreiosServiceConfig[];
  declaredValueEnabled: boolean;
  timeoutMs: number;
};

export const DEFAULT_CORREIOS_SERVICES: readonly CorreiosServiceConfig[] = [
  { code: "04510", name: "PAC", type: "STANDARD" },
  { code: "04014", name: "SEDEX", type: "EXPRESS" },
];

export function correiosBaseUrl(environment: CorreiosConfig["environment"]): string {
  return environment === "homologation"
    ? "https://apihom.correios.com.br"
    : "https://api.correios.com.br";
}

function truthy(value: string | undefined, fallback = true): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}

export function correiosConfigured(config: CorreiosConfig): boolean {
  const hasAuth = Boolean(config.auth.token) || Boolean(config.auth.username && config.auth.password);
  return config.enabled && config.originPostalCode.length === 8 && hasAuth;
}

/**
 * Monta a configuração dos Correios a partir de variáveis de ambiente.
 * NUNCA hardcoda credenciais — tudo vem do ambiente/secret manager.
 */
export function correiosConfigFromEnv(source: Record<string, string | undefined>): CorreiosConfig {
  const environment =
    (source.CORREIOS_ENVIRONMENT ?? "production").trim().toLowerCase() === "homologation"
      ? "homologation"
      : "production";

  const token = source.CORREIOS_TOKEN?.trim();
  const username = source.CORREIOS_USERNAME?.trim();
  const password = source.CORREIOS_PASSWORD?.trim();
  const contract = source.CORREIOS_CONTRATO?.trim();
  const card = source.CORREIOS_CARTAO?.trim();

  const mode: CorreiosAuthMode = token ? "pre-generated-token" : card ? "card" : contract ? "contract" : "id-correios";

  const services: CorreiosServiceConfig[] = [];
  const pacCode = source.CORREIOS_PAC_CODE?.trim();
  const sedexCode = source.CORREIOS_SEDEX_CODE?.trim();
  if (pacCode) services.push({ code: pacCode, name: "PAC", type: "STANDARD" });
  if (sedexCode) services.push({ code: sedexCode, name: "SEDEX", type: "EXPRESS" });

  const dr = source.CORREIOS_DR?.trim();
  const timeout = Number(source.CORREIOS_TIMEOUT_MS);
  const origin = (source.CORREIOS_ORIGEM_CEP ?? "").replace(/\D/g, "");

  return {
    enabled: truthy(source.CORREIOS_ENABLED),
    environment,
    baseUrl: (source.CORREIOS_API_URL?.trim() || correiosBaseUrl(environment)).replace(/\/+$/, ""),
    auth: {
      mode,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      ...(contract ? { contract } : {}),
      ...(card ? { card } : {}),
      ...(token ? { token } : {}),
    },
    originPostalCode: origin,
    ...(contract ? { contract } : {}),
    ...(dr ? { dr } : {}),
    services: services.length > 0 ? services : [...DEFAULT_CORREIOS_SERVICES],
    declaredValueEnabled: truthy(source.CORREIOS_DECLARED_VALUE),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 8000,
  };
}
