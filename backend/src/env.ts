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

  // --- Mercado Pago ---------------------------------------------------------
  // O Access Token e o Webhook Secret NUNCA podem chegar ao frontend; apenas a
  // Public Key pode ser usada no navegador (tokenizacao de cartao).
  MERCADOPAGO_ACCESS_TOKEN: z.string().optional().default(""),
  MERCADOPAGO_PUBLIC_KEY: z.string().optional().default(""),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional().default(""),
  // URL publica do backend usada como `notification_url` no Mercado Pago.
  PUBLIC_API_URL: z.string().optional().default(""),

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
  // Validade da cotacao de frete propria (minutos).
  SHIPPING_QUOTE_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  SHIPPING_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  SHIPPING_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),

  // --- Correios (autenticacao por token) -------------------------------------
  CORREIOS_USERNAME: z.string().optional().default(""),
  CORREIOS_PASSWORD: z.string().optional().default(""),
  CORREIOS_CARTAO: z.string().optional().default(""),
  CORREIOS_ENVIRONMENT: z.enum(["production", "homologation"]).default("production"),
  CORREIOS_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),

  // local | s3  (s3 = qualquer storage compativel com a API S3: AWS S3,
  // Cloudflare R2, Backblaze B2, MinIO, DigitalOcean Spaces...).
  STORAGE_DRIVER: z.string().default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./var/uploads"),
  // --- Storage de objetos (STORAGE_DRIVER=s3) ------------------------------
  STORAGE_S3_BUCKET: z.string().optional().default(""),
  STORAGE_S3_REGION: z.string().optional().default("us-east-1"),
  // Endpoint customizado (R2/MinIO/Spaces). Vazio = AWS S3 padrao.
  STORAGE_S3_ENDPOINT: z.string().optional().default(""),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional().default(""),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
  // MinIO/R2 costumam exigir path-style (bucket no path da URL).
  STORAGE_S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Prefixo (pasta) dentro do bucket.
  STORAGE_S3_PREFIX: z.string().optional().default("uploads/"),
  // Prova de entrega: diretorio PRIVADO (nao e servido por /uploads). O acesso
  // acontece somente via endpoint autenticado do modulo de entrega.
  DELIVERY_PROOF_DIR: z.string().default("./var/delivery-proofs"),
  // Base absoluta OPCIONAL para servir uploads (CDN/S3). Vazio => usamos o
  // caminho relativo portátil `/uploads/<arquivo>`, resolvido no frontend.
  STORAGE_PUBLIC_URL: z.string().default(""),
  // Limite de tamanho de upload de imagem (MB).
  UPLOAD_MAX_MB: z.coerce.number().positive().default(5),

  // --- Web Push (PWA) --------------------------------------------------------
  // Chaves VAPID do dono da loja (gere com `npm run vapid:generate`).
  // Sem elas o push fica DESATIVADO e a loja continua funcionando normalmente.
  // A chave privada fica SOMENTE no backend; nunca é enviada ao frontend.
  VAPID_PUBLIC_KEY: z.string().optional().default(""),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  VAPID_SUBJECT: z.string().default("mailto:contato@mastoree.com.br"),

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
  /** Provider de pagamento efetivamente selecionado (normalizado). */
  paymentProvider: "mock" | "mercadopago" | "other";
  /** Mercado Pago selecionado E com todas as credenciais presentes. */
  isMercadoPagoEnabled: boolean;
  /** Credenciais do Mercado Pago ausentes (nomes das variaveis, sem valores). */
  mercadoPagoMissing: string[];
  /** Driver de storage normalizado: "local" ou "s3". */
  storageDriver: "local" | "s3";
  /** true quando o storage de objetos esta configurado. */
  isObjectStorageEnabled: boolean;
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

  const provider = (env.PAYMENT_PROVIDER || "mock").trim().toLowerCase();
  env.paymentProvider = provider === "mercadopago" ? "mercadopago" : provider === "mock" ? "mock" : "other";

  // Separacao explicita de segredos: cada credencial tem seu proprio nome. O
  // Access Token e o Webhook Secret NUNCA sao expostos; a Public Key e publica.
  const missing: string[] = [];
  if (!env.MERCADOPAGO_ACCESS_TOKEN.trim()) missing.push("MERCADOPAGO_ACCESS_TOKEN");
  if (!env.MERCADOPAGO_PUBLIC_KEY.trim()) missing.push("MERCADOPAGO_PUBLIC_KEY");
  if (!env.MERCADOPAGO_WEBHOOK_SECRET.trim()) missing.push("MERCADOPAGO_WEBHOOK_SECRET");
  // Sem URL publica o Mercado Pago nao consegue chamar o webhook de volta e o
  // pagamento nunca seria confirmado — por isso ela tambem e obrigatoria.
  if (!env.PUBLIC_API_URL.trim()) missing.push("PUBLIC_API_URL");
  env.mercadoPagoMissing = missing;
  env.isMercadoPagoEnabled = env.paymentProvider === "mercadopago" && missing.length === 0;

  // Guarda-corpo CRITICO: producao real NAO pode subir cobrando com o provider
  // `mock` (que nao processa dinheiro algum). Sem isto, uma variavel esquecida
  // faria a loja aceitar pedidos sem nunca cobrar. Falhamos rapido e claro.
  if (env.NODE_ENV === "production" && env.PAYMENT_ENV === "production" && env.paymentProvider !== "mercadopago") {
    // eslint-disable-next-line no-console
    console.error(
      `[MA STORE] PAYMENT_ENV=production exige PAYMENT_PROVIDER=mercadopago ` +
        `(valor atual: "${provider || "mock"}"). A API NAO vai iniciar em producao com pagamento simulado.`,
    );
    process.exit(1);
  }

  // Guarda-corpo: producao nao pode ficar restrita a localhost no CORS (a
  // vitrine real nao conseguiria chamar a API).
  if (
    env.NODE_ENV === "production" &&
    env.corsOrigins.some((origin) => /localhost|127\.0\.0\.1|\[::1\]/i.test(origin))
  ) {
    // eslint-disable-next-line no-console
    console.error(
      "[MA STORE] CORS_ORIGINS contem localhost em producao. " +
        "Defina o dominio real do frontend (ex.: https://www.seudominio.com.br).",
    );
    process.exit(1);
  }

  // Storage: se o driver de objetos foi escolhido, exigimos bucket/regiao.
  // Sem isso as imagens seriam gravadas em disco efemero silenciosamente.
  const storageDriver = env.STORAGE_DRIVER.trim().toLowerCase();
  if (storageDriver === "s3" && !env.STORAGE_S3_BUCKET.trim()) {
    const message =
      "[MA STORE] STORAGE_DRIVER=s3, mas STORAGE_S3_BUCKET nao foi definido. " +
      "Defina o bucket (e as credenciais) ou volte para STORAGE_DRIVER=local.";
    if (env.NODE_ENV === "production") {
      // eslint-disable-next-line no-console
      console.error(message);
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.warn(message);
  }

  if (env.paymentProvider === "mercadopago" && missing.length > 0) {
    const message =
      `[MA STORE] PAYMENT_PROVIDER=mercadopago, mas faltam credenciais: ${missing.join(", ")}. ` +
      "Os meios de pagamento online ficarao INDISPONIVEIS ate a configuracao correta.";
    // Em producao real, falhar rapido e mais seguro do que aceitar pedidos sem
    // conseguir cobrar. Em desenvolvimento apenas avisamos para nao travar o dev.
    if (env.NODE_ENV === "production" && env.PAYMENT_ENV === "production") {
      // eslint-disable-next-line no-console
      console.error(message);
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.warn(message);
  }

  env.storageDriver = storageDriver === "s3" ? "s3" : "local";
  env.isObjectStorageEnabled = env.storageDriver === "s3" && Boolean(env.STORAGE_S3_BUCKET.trim());

  // Guarda-corpo: em producao o disco do container costuma ser EFEMERO. Gravar
  // imagens em disco local faz os arquivos sumirem no proximo deploy/restart.
  // Nao travamos o boot (pode existir disco persistente montado em
  // STORAGE_LOCAL_DIR), mas avisamos de forma inequivoca.
  if (env.NODE_ENV === "production" && env.storageDriver === "local") {
    // eslint-disable-next-line no-console
    console.warn(
      "[MA STORE] AVISO DE PRODUCAO: STORAGE_DRIVER=local. Se o diretorio " +
        `${env.STORAGE_LOCAL_DIR} NAO estiver em um disco persistente, as imagens ` +
        "serao PERDIDAS a cada deploy/restart. Use STORAGE_DRIVER=s3 (recomendado) " +
        "ou monte um disco persistente nesse caminho.",
    );
  }

  return env;
}

export const env: Env = build();
