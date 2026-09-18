import { buildApp } from "./app.js";
import { checkDatabase, prisma } from "./db.js";
import { env } from "./env.js";

async function main() {
  const app = await buildApp();

  // Falha cedo se o banco nao estiver acessivel.
  const db = await checkDatabase();
  if (!db.connected) {
    app.log.error({ err: db.error }, "banco de dados indisponivel na inicializacao");
  } else {
    app.log.info({ latencyMs: db.latencyMs }, "banco de dados conectado");
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "encerrando aplicacao");
    try {
      await app.close();
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(
      { env: env.APP_ENV, payments: env.PAYMENT_ENV, version: env.APP_VERSION },
      `MA STORE API ouvindo em http://${env.HOST}:${env.PORT}`,
    );
  } catch (error) {
    app.log.error(error, "falha ao iniciar servidor");
    process.exit(1);
  }
}

void main();
