import { buildApp } from "./app.js";
import { checkDatabase, prisma } from "./db.js";
import { env } from "./env.js";
import { installNationalShippingTable } from "./shipping-local/bootstrap/prisma-store.js";
import { resumeInterruptedJobs } from "./services/image-recovery/job.service.js";

async function main() {
  const app = await buildApp();

  // Sinaliza (sem mascarar) o risco de armazenamento local em produção: o disco
  // do container é efêmero, então uploads podem sumir a cada restart/deploy.
  // A solução persistente é usar um storage de objetos (S3/Cloudinary) ou um
  // disco persistente — a interface `saveUpload` já está preparada para isso.
  if (env.APP_ENV === "production" && env.STORAGE_DRIVER === "local") {
    app.log.warn(
      "STORAGE_DRIVER=local em produção: imagens enviadas podem ser perdidas em restart/deploy. Configure um storage persistente.",
    );
  }

  // Falha cedo se o banco nao estiver acessivel.
  const db = await checkDatabase();
  if (!db.connected) {
    app.log.error({ err: db.error }, "banco de dados indisponivel na inicializacao");
  } else {
    app.log.info({ latencyMs: db.latencyMs }, "banco de dados conectado");

    // Tabela nacional de frete pre-cadastrada: idempotente, preserva o que o
    // administrador ja editou e nunca impede o servidor de subir.
    if (env.SHIPPING_NATIONAL_TABLE) {
      try {
        const result = await installNationalShippingTable(prisma);
        app.log.info(
          {
            skipped: result.skipped,
            reason: result.reason,
            methodsCreated: result.methodsCreated,
            zonesCreated: result.zonesCreated,
            rulesCreated: result.rulesCreated,
            settingsCreated: result.settingsCreated,
          },
          result.skipped
            ? "tabela nacional de frete nao aplicada (configuracao personalizada detectada)"
            : "tabela nacional de frete verificada/instalada",
        );
      } catch (error) {
        app.log.error({ err: error }, "falha ao instalar a tabela nacional de frete");
      }
    }
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

  // Recuperador de imagens: retoma processos em massa interrompidos por
  // restart/deploy. O estado vive no PostgreSQL; nada depende de disco local.
  if (db.connected) {
    try {
      const resumed = await resumeInterruptedJobs();
      if (resumed.resumed > 0) {
        app.log.info(resumed, "processos de recuperacao de imagens retomados");
      }
    } catch (error) {
      app.log.error({ err: error }, "falha ao retomar processos de recuperacao de imagens");
    }
  }

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
