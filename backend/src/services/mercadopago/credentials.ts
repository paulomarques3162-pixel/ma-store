/**
 * Resolucao PURA das credenciais do Mercado Pago por ambiente.
 *
 * Este modulo NAO importa `env.ts` de proposito:
 *  - pode ser testado isoladamente (sem subir a aplicacao);
 *  - pode ser usado tanto pela validacao de ambiente (`env.ts`) quanto pelo
 *    cliente do gateway (`client.ts`), evitando ciclos de importacao.
 *
 * Regra central: o ambiente NAO e decidido pelo NOME da variavel, e sim pela
 * combinacao entre `PAYMENT_ENV` e o FORMATO real do token:
 *   - sandbox    -> Access Token e Public Key comecam com `TEST-`
 *   - production -> Access Token e Public Key comecam com `APP_USR-`
 * Se o formato nao corresponder ao ambiente, a cobranca online fica BLOQUEADA
 * (nunca usamos, por acidente, uma credencial real em teste — ou vice-versa).
 */

export type MercadoPagoEnvironment = "sandbox" | "production";
export type MercadoPagoTokenKind = "test" | "production" | "unknown" | "missing";

export type MercadoPagoCredentialSet = {
  accessToken: string | undefined | null;
  publicKey: string | undefined | null;
  webhookSecret: string | undefined | null;
};

export type ResolvedMercadoPagoCredentials = {
  environment: MercadoPagoEnvironment;
  /** De onde as credenciais foram lidas (pode diferir do ambiente em sandbox legado). */
  source: MercadoPagoEnvironment;
  accessToken: string;
  publicKey: string;
  webhookSecret: string;
  tokenKind: MercadoPagoTokenKind;
  /** Nomes das variaveis ausentes (sem valores). */
  missing: string[];
  configured: boolean;
  /** `true` quando a credencial existe mas nao corresponde ao ambiente. */
  blocked: boolean;
  /** Motivo seguro (sem segredos) do bloqueio, ou `null`. */
  blockedReason: string | null;
};

const VAR_NAMES: Record<MercadoPagoEnvironment, { accessToken: string; publicKey: string; webhookSecret: string }> = {
  production: {
    accessToken: "MERCADOPAGO_ACCESS_TOKEN",
    publicKey: "MERCADOPAGO_PUBLIC_KEY",
    webhookSecret: "MERCADOPAGO_WEBHOOK_SECRET",
  },
  sandbox: {
    accessToken: "MERCADOPAGO_SANDBOX_ACCESS_TOKEN",
    publicKey: "MERCADOPAGO_SANDBOX_PUBLIC_KEY",
    webhookSecret: "MERCADOPAGO_SANDBOX_WEBHOOK_SECRET",
  },
};

function text(value: string | undefined | null): string {
  return (value ?? "").trim();
}

/** Classifica o Access Token/Public Key pelo prefixo real do Mercado Pago. */
export function classifyMercadoPagoKey(value: string | undefined | null): MercadoPagoTokenKind {
  const key = text(value);
  if (!key) return "missing";
  if (key.startsWith("TEST-")) return "test";
  if (key.startsWith("APP_USR-")) return "production";
  return "unknown";
}

function hasAny(set: MercadoPagoCredentialSet): boolean {
  return Boolean(text(set.accessToken) || text(set.publicKey) || text(set.webhookSecret));
}

/**
 * Resolve as credenciais ativas de forma deterministica.
 *
 * - Producao: usa SEMPRE as variaveis historicas (`MERCADOPAGO_*`), que ja
 *   estao configuradas no Render. Nada muda para quem ja opera em producao.
 * - Sandbox: usa as variaveis dedicadas (`MERCADOPAGO_SANDBOX_*`). Se nenhuma
 *   delas estiver definida, cai no conjunto historico por compatibilidade — mas
 *   a validacao de formato abaixo garante que um token `APP_USR-` seja
 *   BLOQUEADO em sandbox.
 */
export function resolveMercadoPagoCredentials(input: {
  paymentEnv: MercadoPagoEnvironment;
  production: MercadoPagoCredentialSet;
  sandbox: MercadoPagoCredentialSet;
}): ResolvedMercadoPagoCredentials {
  const environment: MercadoPagoEnvironment = input.paymentEnv === "production" ? "production" : "sandbox";
  const isSandbox = environment === "sandbox";

  const useSandboxSet = isSandbox && hasAny(input.sandbox);
  const source: MercadoPagoEnvironment = useSandboxSet ? "sandbox" : "production";
  const chosen = useSandboxSet ? input.sandbox : input.production;
  // Os NOMES reportados como ausentes sao sempre os canonicos do AMBIENTE
  // selecionado (em sandbox: `MERCADOPAGO_SANDBOX_*`), mesmo quando os valores
  // vieram do conjunto historico por compatibilidade. Assim o dono e guiado
  // para a variavel correta do ambiente.
  const names = VAR_NAMES[environment];

  const accessToken = text(chosen.accessToken);
  const publicKey = text(chosen.publicKey);
  const webhookSecret = text(chosen.webhookSecret);

  const missing: string[] = [];
  if (!accessToken) missing.push(names.accessToken);
  if (!publicKey) missing.push(names.publicKey);
  if (!webhookSecret) missing.push(names.webhookSecret);

  const tokenKind = classifyMercadoPagoKey(accessToken);
  const expectedKind: MercadoPagoTokenKind = isSandbox ? "test" : "production";

  let blockedReason: string | null = null;

  if (accessToken && tokenKind !== expectedKind) {
    if (isSandbox && tokenKind === "production") {
      blockedReason =
        "Credencial de PRODUCAO (APP_USR-) detectada com PAYMENT_ENV=sandbox. " +
        `Use um Access Token de teste (TEST-) em ${VAR_NAMES.sandbox.accessToken}.`;
    } else if (!isSandbox && tokenKind === "test") {
      blockedReason =
        "Credencial de TESTE (TEST-) detectada com PAYMENT_ENV=production. " +
        `Use um Access Token de producao (APP_USR-) em ${VAR_NAMES.production.accessToken}.`;
    } else {
      blockedReason =
        `Formato do Access Token nao reconhecido (esperado ${isSandbox ? "TEST-" : "APP_USR-"}) em ${names.accessToken}.`;
    }
  }

  if (!blockedReason && publicKey) {
    const publicKeyKind = classifyMercadoPagoKey(publicKey);
    if (publicKeyKind !== expectedKind) {
      blockedReason =
        `Public Key nao corresponde ao ambiente ${environment} ` +
        `(esperado ${isSandbox ? "TEST-" : "APP_USR-"}) em ${names.publicKey}.`;
    }
  }

  return {
    environment,
    source,
    accessToken,
    publicKey,
    webhookSecret,
    tokenKind,
    missing,
    configured: missing.length === 0,
    blocked: blockedReason !== null,
    blockedReason,
  };
}

/** Nomes das variaveis esperadas para um ambiente (para mensagens/erros). */
export function mercadoPagoVarNames(environment: MercadoPagoEnvironment): {
  accessToken: string;
  publicKey: string;
  webhookSecret: string;
} {
  return VAR_NAMES[environment];
}
