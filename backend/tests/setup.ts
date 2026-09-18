/**
 * Configuracao de ambiente para os testes.
 *
 * Roda ANTES de cada arquivo de teste importar `src/app.ts`, garantindo que a
 * validacao de env (src/env.ts) veja uma configuracao coerente e que o Prisma
 * aponte para o banco de TESTE - nunca para o de desenvolvimento.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://mastore:devpassword@127.0.0.1:5432/mastore_test?schema=public";

process.env.NODE_ENV = "test";
process.env.APP_ENV = "test";
process.env.APP_VERSION = "test";
process.env.DATABASE_URL = TEST_DATABASE_URL;

process.env.JWT_SECRET ??= "segredo-de-teste-com-mais-de-32-caracteres-ok";
process.env.JWT_ACCESS_TTL = "15m";
process.env.SESSION_TTL_DAYS = "30";

process.env.PAYMENT_ENV = "sandbox";
process.env.PAYMENT_PROVIDER = "mock";
process.env.WEBHOOK_SECRET = "segredo-de-webhook-para-testes";
process.env.PAYMENT_EXPIRES_MINUTES = "60";

process.env.CORS_ORIGINS = "http://localhost:5173";
// Silencioso por padrao; rode com LOG_LEVEL=error para depurar falhas da suite.
process.env.LOG_LEVEL ??= "silent";
process.env.RATE_LIMIT_MAX = "100000";
process.env.RATE_LIMIT_WINDOW = "1 minute";
// A suite faz muitas chamadas de autenticacao em sequencia: sem isso o
// anti brute-force (correto em producao) bloquearia os proprios testes.
process.env.AUTH_RATE_LIMIT_MAX = "100000";
process.env.AUTH_RATE_LIMIT_WINDOW = "1 minute";
