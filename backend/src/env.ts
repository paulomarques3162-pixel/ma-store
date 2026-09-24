import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

/**
 * Validacao de variaveis de ambiente.
 *
 * Regra de ouro do projeto: nenhum segredo vive no codigo. Tudo e lido do
 * ambiente e validado na inicializacao - se algo obrigatorio faltar, a
 * aplicacao NAO sobe (fail fast), evitando rodar com configuracao insegura.
 */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase()),
  );

/** Numero opcional: string vazia/ausente vira `undefined` (nunca 0 acidental). */
const optionalNumber = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? undefined : v),
  z.coerce.number().nonnegative().optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "test", "production", "sandbox"]).default("development"),
  APP_VERSION: z.string().default("1.0.0"),
  PORT: z.coerce.number().int().positive().default(3333),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL e obrigatoria"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET precisa ter ao menos 32 caracteres"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  PAYMENT_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  WEBHOOK_SECRET: z.string().min(8, "WEBHOOK_SECRET e obrigatorio"),
  PAYMENT_EXPIRES_MINUTES: z.coerce.number().int().positive().default(60),
  PAYMENT_PROVIDER: z.string().default("mock"),
  PAYMENT_PROVIDER_KEY: z.string().optional().default(""),
  PAYMENT_PROVIDER_SECRET: z.string().optional().default(""),

  SHIPPING_ORIGIN_CEP: z.string().optional().default(""),
  SHIPPING_FREE_ABOVE: z.string().optional().default(""),
  // Margem fixa de embalagem somada ao peso total (kg). Padrao: 100g.
  SHIPPING_WEIGHT_MARGIN_KG: z.coerce.number().nonnegative().default(0.1),

  // --- Retirada na loja (gratuita) -----------------------------------------
  RETIRADA_ATIVA: booleanish.default(true),
  RETIRADA_NOME: z.string().default("Retirar na loja"),
  RETIRADA_PRAZO: z.string().default("Retirada na loja"),

  // --- Flex / Motoboy (entrega local por faixa de CEP) ----------------------
  FLEX_CEP_PREFIX: z.string().default("1363"),
  FLEX_VALOR: z.coerce.number().nonnegative().default(10),
  FLEX_PRAZO: z.string().default("Mesmo dia ou até o dia seguinte"),
  FLEX_NOME: z.string().default("Motoboy — Pirassununga"),

  // --- Correios (Preco e Prazo) ---------------------------------------------
  // O token e opcional: sem ele, a modalidade simplesmente nao e ofertada.
  CORREIOS_TOKEN: z.string().optional().default(""),
  CORREIOS_ORIGEM_CEP: z.string().optional().default(""),
  CORREIOS_API_URL: z.string().default("https://api.correios.com.br"),
  CORREIOS_PAC_CODE: z.string().default("04510"),
  CORREIOS_SEDEX_CODE: z.string().default("04014"),
  CORREIOS_CONTRATO: z.string().optional().default(""),
  CORREIOS_DR: z.string().optional().default(""),

  // --- Jetlog ---------------------------------------------------------------
  JETLOG_API_URL: z.string().optional().default(""),
  JETLOG_API_TOKEN: z.string().optional().default(""),
  JETLOG_VALOR: optionalNumber,
  JETLOG_PRAZO: z.string().default("3 a 7 dias úteis"),
  JETLOG_NOME: z.string().default("Jetlog"),

  // --- Pegaki (ponto de retirada) -------------------------------------------
  PEGAKI_API_URL: z.string().optional().default(""),
  PEGAKI_API_TOKEN: z.string().optional().default(""),
  PEGAKI_VALOR: optionalNumber,
  PEGAKI_PRAZO: z.string().default("3 a 6 dias úteis"),
  PEGAKI_NOME: z.string().default("Ponto de Retirada Pegaki"),

  // --- Shipping Engine (API universal /api/v1/shipping) ----------------------
  SHIPPING_ENGINE_ENABLED: booleanish.default(true),
  SHIPPING_ENGINE_MOCK: booleanish.default(false),
  SHIPPING_DEFAULT_STORE_ID: z.string().default("default"),
  SHIPPING_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(60_000),
  SHIPPING_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  SHIPPING_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),

  // --- Correios (autenticacao por token) -------------------------------------
  CORREIOS_USERNAME: z.string().optional().default(""),
  CORREIOS_PASSWORD: z.string().optional().default(""),
  CORREIOS_CARTAO: z.string().optional().default(""),
  CORREIOS_ENVIRONMENT: z.enum(["production", "homologation"]).default("production"),
  CORREIOS_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),

  STORAGE_DRIVER: z.string().default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./var/uploads"),
  // Base absoluta OPCIONAL para servir uploads (CDN/S3). Vazio => usamos o
  // caminho relativo portátil `/uploads/<arquivo>`, resolvido no frontend.
  STORAGE_PUBLIC_URL: z.string().default(""),
  // Limite de tamanho de upload de imagem (MB).
  UPLOAD_MAX_MB: z.coerce.number().positive().default(5),

  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  MAIL_FROM: z.string().optional().default(""),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // A vitrine é um SPA: cada página faz ~6 chamadas (conteúdo, tema, categorias,
  // marcas, facetas, produtos). O padrão de 120/min bloqueava um usuário que
  // navegasse rápido entre páginas. 300/min mantém a proteção contra abuso sem
  // atrapalhar o uso legítimo; o limite de autenticação continua rígido (10/min).
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  // Limite mais rigoroso para rotas sensiveis (login, cadastro, reset).
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  TRUST_PROXY: booleanish.default(false),
});

export type Env = z.infer<typeof schema> & {
  isProduction: boolean;
  isTest: boolean;
  isSandboxPayments: boolean;
  corsOrigins: string[];
};

function build(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`\n[MA STORE] Configuracao de ambiente invalida:\n${details}\n`);
    process.exit(1);
  }

  const env = parsed.data as Env;

  // Guarda-corpo: nunca permitir credenciais de sandbox em producao real.
  if (env.NODE_ENV === "production" && env.PAYMENT_ENV === "sandbox") {
    // eslint-disable-next-line no-console
    console.warn(
      "[MA STORE] AVISO: NODE_ENV=production com PAYMENT_ENV=sandbox. " +
        "Pagamentos estao em modo de teste e NAO processam dinheiro real.",
    );
  }

  env.isProduction = env.NODE_ENV === "production";
  env.isTest = env.NODE_ENV === "test";
  void env.AUTH_RATE_LIMIT_MAX;
  env.isSandboxPayments = env.PAYMENT_ENV === "sandbox";
  env.corsOrigins = env.CORS_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return env;
}

export const env: Env = build();
