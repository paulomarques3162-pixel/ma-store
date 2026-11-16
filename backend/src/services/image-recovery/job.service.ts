import { prisma } from "../../db.js";
import { env } from "../../env.js";
import { badRequest, notFound } from "../../lib/errors.js";
import type { ImageRecoveryJob, ImageRecoveryJobItem, Prisma } from "@prisma/client";
import { confirmAsset, recoverAsset } from "./recovery.service.js";

/**
 * Recuperacao em massa com estado PERSISTENTE no PostgreSQL.
 *
 * - concorrencia limitada (nunca centenas de requisicoes simultaneas);
 * - pausar / continuar / cancelar;
 * - retomada automatica apos restart do backend (Render);
 * - confirmacao individual ou por lote depois da pre-visualizacao;
 * - confirmacao automatica SO quando o admin escolhe isso na criacao.
 */

type Runtime = { paused: boolean; canceled: boolean; running: boolean };
const runtimes = new Map<string, Runtime>();

function runtime(jobId: string): Runtime {
  const existing = runtimes.get(jobId);
  if (existing) return existing;
  const created: Runtime = { paused: false, canceled: false, running: false };
  runtimes.set(jobId, created);
  return created;
}

export type CreateJobInput = {
  filter?: string;
  search?: string;
  concurrency?: number;
  autoConfirm?: boolean;
  adminId?: string | null;
};

export async function createJob(input: CreateJobInput): Promise<ImageRecoveryJob> {
  const filter = input.filter && input.filter !== "all" ? input.filter : "recoverable";
  const search = (input.search ?? "").trim();
  const concurrency = Math.max(1, Math.min(8, Math.floor(input.concurrency ?? env.IMAGE_RECOVERY_CONCURRENCY)));

  const where: Prisma.ImageRecoveryAssetWhereInput = {
    status: { in: filter === "redirect" ? ["REDIRECT"] : ["RECOVERABLE", "REDIRECT"] },
    ...(search
      ? {
          OR: [
            { label: { contains: search, mode: "insensitive" } },
            { currentUrl: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const assets = await prisma.imageRecoveryAsset.findMany({
    where,
    select: { id: true, label: true, currentUrl: true },
    orderBy: { updatedAt: "asc" },
    take: 500,
  });

  if (assets.length === 0) {
    throw badRequest("Nenhuma imagem recuperavel encontrada com os filtros informados. Execute a auditoria/verificacao antes.");
  }

  const job = await prisma.imageRecoveryJob.create({
    data: {
      status: "PENDING",
      filter,
      search: search || null,
      concurrency,
      autoConfirm: Boolean(input.autoConfirm),
      total: assets.length,
      adminId: input.adminId ?? null,
      items: {
        create: assets.map((asset) => ({
          assetId: asset.id,
          label: asset.label,
          originalUrl: asset.currentUrl,
          status: "PENDING",
        })),
      },
    },
  });

  return job;
}

export async function getJob(id: string) {
  const job = await prisma.imageRecoveryJob.findUnique({
    where: { id },
    include: { items: { orderBy: { createdAt: "asc" }, take: 500 } },
  });
  if (!job) throw notFound("Processo de recuperacao nao encontrado.");
  return serializeJob(job);
}

export function serializeJob(job: ImageRecoveryJob & { items?: ImageRecoveryJobItem[] }) {
  const percent = job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0;
  return {
    id: job.id,
    status: job.status,
    filter: job.filter,
    search: job.search,
    concurrency: job.concurrency,
    autoConfirm: job.autoConfirm,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    skipped: job.skipped,
    percent,
    error: job.error,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    items: (job.items ?? []).map((item) => ({
      id: item.id,
      assetId: item.assetId,
      label: item.label,
      originalUrl: item.originalUrl,
      status: item.status,
      result: item.result,
      message: item.message,
      newUrl: item.newUrl,
      publicId: item.publicId,
    })),
  };
}

export async function listJobs(limit = 20) {
  const jobs = await prisma.imageRecoveryJob.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(50, Math.max(1, limit)),
  });
  return jobs.map((job) => serializeJob(job));
}

/** Seleciona o proximo item PENDENTE de forma atomica (claim). */
async function claimNextItem(jobId: string): Promise<ImageRecoveryJobItem | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = await prisma.imageRecoveryJobItem.findFirst({
      where: { jobId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return null;

    const claimed = await prisma.imageRecoveryJobItem.updateMany({
      where: { id: candidate.id, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
    if (claimed.count === 1) return { ...candidate, status: "PROCESSING" };
  }
  return null;
}

async function processItem(
  job: ImageRecoveryJob,
  item: ImageRecoveryJobItem,
): Promise<{ status: "AWAITING_CONFIRMATION" | "CONFIRMED" | "SKIPPED" | "FAILED"; result: string; message: string; newUrl: string | null; publicId: string | null }> {
  if (!item.assetId) {
    return { status: "SKIPPED", result: "SKIPPED", message: "Referencia removida.", newUrl: null, publicId: null };
  }

  const outcome = await recoverAsset(item.assetId, job.adminId);
  if (!outcome.ok) {
    return {
      status: "FAILED",
      result: outcome.asset.status,
      message: outcome.message,
      newUrl: null,
      publicId: null,
    };
  }

  const newUrl = outcome.asset.newUrl;
  const publicId = outcome.asset.publicId;

  if (job.autoConfirm) {
    const confirmed = await confirmAsset(item.assetId, "replace", job.adminId);
    return {
      status: "CONFIRMED",
      result: "CONFIRMED",
      message: confirmed.message,
      newUrl,
      publicId,
    };
  }

  return {
    status: "AWAITING_CONFIRMATION",
    result: "RECOVERED",
    message: "Recuperada e aguardando confirmacao em lote.",
    newUrl,
    publicId,
  };
}

/**
 * Executa/retoma um job. A funcao e idempotente: itens ja processados nao sao
 * repetidos, permitindo continuar depois de um restart.
 */
export async function runJob(jobId: string): Promise<void> {
  const state = runtime(jobId);

  if (state.running) return;
  state.running = true;
  state.paused = false;
  state.canceled = false;

  try {
    const job = await prisma.imageRecoveryJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    if (job.status === "CANCELED" || job.status === "COMPLETED" || job.status === "FAILED") {
      state.canceled = job.status === "CANCELED";
      return;
    }

    await prisma.imageRecoveryJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: job.startedAt ?? new Date(), finishedAt: null, error: null, heartbeatAt: new Date() },
    });

    const shouldStop = () => {
      if (state.paused || state.canceled) return true;
      return false;
    };

    // Cada worker puxa o proximo item atomico. `runPool` limita a concorrencia.
    const workers = Array.from({ length: job.concurrency }, async () => {
      for (;;) {
        if (shouldStop()) return;
        // Pausa/cancelamento solicitado em OUTRA instancia/aba: consulta o DB
        // periodicamente (a cada item) para refletir a vontade do admin.
        const fresh = await prisma.imageRecoveryJob.findUnique({
          where: { id: jobId },
          select: { status: true },
        });
        if (!fresh || fresh.status === "PAUSED" || fresh.status === "CANCELED") {
          state.paused = fresh?.status === "PAUSED";
          state.canceled = fresh?.status === "CANCELED";
          return;
        }
        if (fresh.status === "COMPLETED" || fresh.status === "FAILED") return;

        const item = await claimNextItem(jobId);
        if (!item) return;

        let outcome: Awaited<ReturnType<typeof processItem>>;
        try {
          outcome = await processItem(job, item);
        } catch (error) {
          outcome = {
            status: "FAILED",
            result: "FAILED",
            message: error instanceof Error ? error.message : "Erro inesperado na recuperacao.",
            newUrl: null,
            publicId: null,
          };
        }

        await prisma.$transaction([
          prisma.imageRecoveryJobItem.update({
            where: { id: item.id },
            data: {
              status: outcome.status,
              result: outcome.result,
              message: outcome.message,
              newUrl: outcome.newUrl,
              publicId: outcome.publicId,
              processedAt: new Date(),
            },
          }),
          prisma.imageRecoveryJob.update({
            where: { id: jobId },
            data: {
              processed: { increment: 1 },
              ...(outcome.status === "FAILED"
                ? { failed: { increment: 1 } }
                : outcome.status === "SKIPPED"
                  ? { skipped: { increment: 1 } }
                  : { succeeded: { increment: 1 } }),
              heartbeatAt: new Date(),
            },
          }),
        ]);
      }
    });

    await Promise.all(workers);

    const fresh = await prisma.imageRecoveryJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });

    if (fresh?.status === "PAUSED" || state.paused) {
      await prisma.imageRecoveryJob.update({
        where: { id: jobId },
        data: { status: "PAUSED", heartbeatAt: new Date() },
      });
      return;
    }
    if (fresh?.status === "CANCELED" || state.canceled) return;

    const remaining = await prisma.imageRecoveryJobItem.count({ where: { jobId, status: "PENDING" } });
    if (remaining === 0) {
      await prisma.imageRecoveryJob.update({
        where: { id: jobId },
        data: { status: "COMPLETED", finishedAt: new Date(), heartbeatAt: new Date() },
      });
    }
  } catch (error) {
    await prisma.imageRecoveryJob
      .update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          error: error instanceof Error ? error.message : "Erro inesperado no processo em massa.",
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);
  } finally {
    state.running = false;
  }
}

export async function pauseJob(id: string) {
  const job = await prisma.imageRecoveryJob.findUnique({ where: { id } });
  if (!job) throw notFound("Processo de recuperacao nao encontrado.");
  if (job.status !== "RUNNING" && job.status !== "PENDING") {
    throw badRequest("Somente processos em execucao podem ser pausados.");
  }
  runtime(id).paused = true;
  await prisma.imageRecoveryJob.update({ where: { id }, data: { status: "PAUSED", heartbeatAt: new Date() } });
  return getJob(id);
}

export async function resumeJob(id: string) {
  const job = await prisma.imageRecoveryJob.findUnique({ where: { id } });
  if (!job) throw notFound("Processo de recuperacao nao encontrado.");
  if (job.status !== "PAUSED" && job.status !== "PENDING" && job.status !== "RUNNING") {
    throw badRequest("Este processo nao pode ser retomado.");
  }
  // Itens travados em PROCESSING por um restart voltam para a fila.
  await prisma.imageRecoveryJobItem.updateMany({
    where: { jobId: id, status: "PROCESSING" },
    data: { status: "PENDING" },
  });
  const state = runtime(id);
  state.paused = false;
  state.canceled = false;
  await prisma.imageRecoveryJob.update({ where: { id }, data: { status: "RUNNING" } });
  void runJob(id);
  return getJob(id);
}

export async function cancelJob(id: string) {
  const job = await prisma.imageRecoveryJob.findUnique({ where: { id } });
  if (!job) throw notFound("Processo de recuperacao nao encontrado.");
  if (job.status === "COMPLETED") throw badRequest("Processo ja concluido.");
  runtime(id).canceled = true;
  await prisma.imageRecoveryJob.update({
    where: { id },
    data: { status: "CANCELED", finishedAt: new Date(), heartbeatAt: new Date() },
  });
  await prisma.imageRecoveryJobItem.updateMany({
    where: { jobId: id, status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "SKIPPED", message: "Processo cancelado pelo administrador." },
  });
  return getJob(id);
}

/**
 * Confirmacao por lote depois da pre-visualizacao.
 * Sem `itemIds`, confirma TODOS os itens aguardando confirmacao.
 */
export async function confirmJobItems(id: string, itemIds?: string[], adminId?: string | null) {
  const job = await prisma.imageRecoveryJob.findUnique({ where: { id } });
  if (!job) throw notFound("Processo de recuperacao nao encontrado.");

  const items = await prisma.imageRecoveryJobItem.findMany({
    where: {
      jobId: id,
      status: "AWAITING_CONFIRMATION",
      ...(itemIds && itemIds.length > 0 ? { id: { in: itemIds } } : {}),
    },
  });
  if (items.length === 0) throw badRequest("Nenhum item aguardando confirmacao neste processo.");

  let confirmed = 0;
  let failed = 0;
  for (const item of items) {
    if (!item.assetId) continue;
    try {
      await confirmAsset(item.assetId, "replace", adminId ?? job.adminId);
      await prisma.imageRecoveryJobItem.update({
        where: { id: item.id },
        data: { status: "CONFIRMED", result: "CONFIRMED", message: "Substituicao confirmada pelo administrador.", processedAt: new Date() },
      });
      confirmed += 1;
    } catch (error) {
      failed += 1;
      await prisma.imageRecoveryJobItem.update({
        where: { id: item.id },
        data: {
          status: "FAILED",
          result: "FAILED",
          message: error instanceof Error ? error.message : "Falha ao confirmar a substituicao.",
        },
      });
    }
  }

  if (confirmed > 0) {
    await prisma.imageRecoveryJob.update({
      where: { id },
      data: { heartbeatAt: new Date() },
    });
  }

  const result = await getJob(id);
  return { ...result, confirmedNow: confirmed, failedNow: failed };
}

/**
 * Retomada apos restart/deploy: jobs marcados como RUNNING voltam a executar e
 * itens travados em PROCESSING retornam para PENDING. Job PAUSED continua
 * pausado (respeita a decisao do admin).
 */
export async function resumeInterruptedJobs(): Promise<{ resumed: number; reset: number }> {
  const interrupted = await prisma.imageRecoveryJob.findMany({
    where: { status: "RUNNING" },
    select: { id: true },
  });

  let reset = 0;
  for (const job of interrupted) {
    const result = await prisma.imageRecoveryJobItem.updateMany({
      where: { jobId: job.id, status: "PROCESSING" },
      data: { status: "PENDING" },
    });
    reset += result.count;
    void runJob(job.id);
  }

  return { resumed: interrupted.length, reset };
}
