import { prisma } from "../db.js";
import { env } from "../env.js";

/**
 * Configuração de pagamento lida do CMS (admin) — chaves PIX privadas NUNCA
 * saem para o site público. Quando algo essencial falta, devolvemos
 * `configured: false` com a lista do que falta (sem inventar valores).
 */

export type PixConfigStatus = {
  configured: boolean;
  enabled: boolean;
  hasKey: boolean;
  hasHolder: boolean;
  hasCity: boolean;
  missing: string[];
};

const PRIVATE_KEYS = ["payment.pixKey", "payment.pixHolder", "payment.pixCity", "payment.pixEnabled"] as const;

export async function getPixConfig(): Promise<{
  status: PixConfigStatus;
  key: string | null;
  holder: string | null;
  city: string | null;
}> {
  const rows = await prisma.siteContent.findMany({
    where: { key: { in: [...PRIVATE_KEYS] } },
    select: { key: true, value: true },
  });
  const values = new Map(rows.map((row) => [row.key, row.value ?? ""]));

  const key = values.get("payment.pixKey")?.trim() ?? "";
  const holder = values.get("payment.pixHolder")?.trim() ?? "";
  const city = values.get("payment.pixCity")?.trim() ?? "";
  const enabled = (values.get("payment.pixEnabled") ?? "").toLowerCase() === "true";

  const missing: string[] = [];
  if (!key) missing.push("Chave PIX");
  if (!holder) missing.push("Titular da chave");
  if (!city) missing.push("Cidade do recebedor");

  return {
    status: { configured: missing.length === 0, enabled, hasKey: key.length > 0, hasHolder: holder.length > 0, hasCity: city.length > 0, missing },
    key: key || null,
    holder: holder || null,
    city: city || null,
  };
}

/** Status das integracoes externas (sem expor segredos). */
export function getIntegrationsStatus() {
  return {
    payment: {
      provider: env.PAYMENT_PROVIDER || "mock",
      environment: env.PAYMENT_ENV,
      sandbox: env.PAYMENT_ENV !== "production",
      webhookConfigured: Boolean(env.WEBHOOK_SECRET),
    },
    correios: {
      configured: Boolean(env.CORREIOS_TOKEN.trim() && env.CORREIOS_ORIGEM_CEP.trim()),
      hasToken: Boolean(env.CORREIOS_TOKEN.trim()),
      hasOriginCep: Boolean(env.CORREIOS_ORIGEM_CEP.trim()),
      pacCode: env.CORREIOS_PAC_CODE,
      sedexCode: env.CORREIOS_SEDEX_CODE,
    },
    jetlog: {
      configured: Boolean(env.JETLOG_API_URL.trim() && env.JETLOG_API_TOKEN.trim()) || env.JETLOG_VALOR !== undefined,
      hasApi: Boolean(env.JETLOG_API_URL.trim() && env.JETLOG_API_TOKEN.trim()),
      hasFixedValue: env.JETLOG_VALOR !== undefined,
    },
    pegaki: {
      configured: Boolean(env.PEGAKI_API_URL.trim() && env.PEGAKI_API_TOKEN.trim()) || env.PEGAKI_VALOR !== undefined,
      hasApi: Boolean(env.PEGAKI_API_URL.trim() && env.PEGAKI_API_TOKEN.trim()),
      hasFixedValue: env.PEGAKI_VALOR !== undefined,
    },
    retirada: { enabled: env.RETIRADA_ATIVA },
    localDelivery: { configuredPrefix: env.FLEX_CEP_PREFIX, value: env.FLEX_VALOR, active: Boolean(env.FLEX_CEP_PREFIX.trim()) },
  };
}
