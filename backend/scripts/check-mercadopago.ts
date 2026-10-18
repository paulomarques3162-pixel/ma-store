/**
 * Verifica a configuracao do Mercado Pago SEM expor nenhum segredo.
 *
 * Uso:
 *   cd backend
 *   npm run payments:check
 *
 * Le o `.env` local, resolve as credenciais do ambiente selecionado
 * (`PAYMENT_ENV`) e informa: ambiente, tipo do token (teste/producao), variaveis
 * ausentes e eventual bloqueio por incompatibilidade de ambiente. Nunca imprime
 * o valor de um token ou segredo.
 */
import { config as loadDotenv } from "dotenv";
import { resolveMercadoPagoCredentials } from "../src/services/mercadopago/credentials.js";

loadDotenv();

const read = (key: string): string => (process.env[key] ?? "").trim();

const paymentEnv = read("PAYMENT_ENV") === "production" ? "production" : "sandbox";
const provider = read("PAYMENT_PROVIDER") || "mock";

const resolved = resolveMercadoPagoCredentials({
  paymentEnv,
  production: {
    accessToken: read("MERCADOPAGO_ACCESS_TOKEN"),
    publicKey: read("MERCADOPAGO_PUBLIC_KEY"),
    webhookSecret: read("MERCADOPAGO_WEBHOOK_SECRET"),
  },
  sandbox: {
    accessToken: read("MERCADOPAGO_SANDBOX_ACCESS_TOKEN"),
    publicKey: read("MERCADOPAGO_SANDBOX_PUBLIC_KEY"),
    webhookSecret: read("MERCADOPAGO_SANDBOX_WEBHOOK_SECRET"),
  },
});

const onlineEnabled = provider === "mercadopago" && resolved.configured && !resolved.blocked;

const lines: string[] = [
  "MA STORE - status da configuracao do Mercado Pago (sem expor segredos)",
  `  provider ................ ${provider}`,
  `  PAYMENT_ENV ............. ${resolved.environment}`,
  `  origem das credenciais .. ${resolved.source}${resolved.source !== resolved.environment ? " (fallback: nomes historicos)" : ""}`,
  `  tipo do Access Token .... ${resolved.tokenKind}`,
  `  credenciais completas ... ${resolved.configured ? "sim" : "nao"}`,
  `  pagamento online ........ ${onlineEnabled ? "HABILITADO" : "INDISPONIVEL"}`,
  `  variaveis ausentes ...... ${resolved.missing.length ? resolved.missing.join(", ") : "(nenhuma)"}`,
];

if (resolved.blocked) {
  lines.push(`  BLOQUEIO ................ ${resolved.blockedReason}`);
}

// eslint-disable-next-line no-console
console.log(lines.join("\n"));

if (resolved.blocked) {
  process.exitCode = 1;
}
