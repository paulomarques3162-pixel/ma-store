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

  STORAGE_DRIVER: z.string().default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./var/uploads"),
  STORAGE_PUBLIC_URL: z.string().default("http://localhost:3333/uploads"),

  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  MAIL_FROM: z.string().optional().default(""),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
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
