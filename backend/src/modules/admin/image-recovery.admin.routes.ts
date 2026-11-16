import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../env.js";
import { badRequest } from "../../lib/errors.js";
import { created, ok, okPaginated, parse } from "../../lib/http.js";
import { writeAudit } from "../../lib/audit.js";
import { storageStatus } from "../../services/storage-provider.js";
import { getRecoverySummary, scanImageReferences, findDuplicateUrls } from "../../services/image-recovery/scanner.js";
import {
  buildRecoveryCsv,
  checkAsset,
  confirmAsset,
  getAsset,
  getRecoveryReport,
  listAssets,
  recoverAsset,
  setManualUpload,
  setManualUrl,
} from "../../services/image-recovery/recovery.service.js";
import {
  cancelJob,
  confirmJobItems,
  createJob,
  getJob,
  listJobs,
  pauseJob,
  resumeJob,
  runJob,
} from "../../services/image-recovery/job.service.js";

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(24),
  status: z.string().trim().max(30).optional(),
  type: z.string().trim().max(20).optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(20).optional(),
});

const confirmBody = z.object({
  action: z.enum(["replace", "keep", "cancel"]).default("replace"),
});

const manualUrlBody = z.object({
  url: z.string().trim().url("Informe uma URL valida (http/https).").max(2000),
});

const createJobBody = z.object({
  filter: z.string().trim().max(30).optional().default("recoverable"),
  search: z.string().trim().max(120).optional(),
  concurrency: z.coerce.number().int().min(1).max(8).optional(),
  autoConfirm: z.boolean().optional().default(false),
});

const confirmJobBody = z.object({
  itemIds: z.array(z.string().min(1)).max(500).optional(),
});

const heavyRateLimit = {
  rateLimit: {
    max: env.IMAGE_RECOVERY_RATE_LIMIT_MAX,
    timeWindow: "1 minute",
  },
} as const;

/**
 * Administracao > Midia > Recuperador de Imagens.
 *
 * Todas as rotas exigem role ADMIN (hook no escopo deste plugin). Nenhuma rota
 * aceita URL arbitraria alem de `manual-url`, que passa pelo mesmo guarda-corpo
 * SSRF (protocolo, DNS, IP privado, redirects).
 */
export async function imageRecoveryAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  // ---- Visao geral ---------------------------------------------------------
  app.get("/summary", async (_request, reply) => {
    const [summary, duplicates] = await Promise.all([getRecoverySummary(), findDuplicateUrls(5)]);
    return ok(reply, {
      ...summary,
      duplicatesSample: duplicates,
      storage: storageStatus(),
      limits: {
        maxMb: Math.min(env.IMAGE_RECOVERY_MAX_MB, env.UPLOAD_MAX_MB),
        timeoutMs: env.IMAGE_RECOVERY_TIMEOUT_MS,
        maxRedirects: env.IMAGE_RECOVERY_MAX_REDIRECTS,
        defaultConcurrency: env.IMAGE_RECOVERY_CONCURRENCY,
        recheckHours: env.IMAGE_RECOVERY_RECHECK_HOURS,
      },
    });
  });

  /** Auditoria: descobre referencias e cria/atualiza registros. Nao altera produtos. */
  app.post("/scan", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const result = await scanImageReferences();
    await writeAudit({
      adminId: request.authUser?.id,
      action: "IMAGE_RECOVERY_SCAN",
      entity: "ImageRecoveryAsset",
      after: { scanned: result.scanned, created: result.created, updated: result.updated },
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, result);
  });

  app.get("/duplicates", async (_request, reply) => {
    return ok(reply, await findDuplicateUrls(100));
  });

  // ---- Listagem / detalhe ---------------------------------------------------
  app.get("/assets", async (request, reply) => {
    const query = parse(listQuery, request.query);
    const result = await listAssets(query);
    return okPaginated(reply, result);
  });

  app.get("/assets/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    return ok(reply, await getAsset(id));
  });

  // ---- Acoes individuais ----------------------------------------------------
  app.post<{ Params: { id: string } }>("/assets/:id/check", { config: heavyRateLimit }, async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const asset = await checkAsset(id, request.authUser?.id);
    return ok(reply, asset);
  });

  app.post<{ Params: { id: string } }>("/assets/:id/recover", { config: heavyRateLimit }, async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const outcome = await recoverAsset(id, request.authUser?.id);
    await writeAudit({
      adminId: request.authUser?.id,
      action: "IMAGE_RECOVERY_RECOVER",
      entity: "ImageRecoveryAsset",
      entityId: id,
      after: { ok: outcome.ok, status: outcome.asset.status, newUrl: outcome.asset.newUrl },
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, outcome);
  });

  app.post<{ Params: { id: string } }>("/assets/:id/confirm", { config: heavyRateLimit }, async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const body = parse(confirmBody, request.body);
    const outcome = await confirmAsset(id, body.action, request.authUser?.id);
    await writeAudit({
      adminId: request.authUser?.id,
      action: `IMAGE_RECOVERY_${body.action.toUpperCase()}`,
      entity: "ImageRecoveryAsset",
      entityId: id,
      after: { status: outcome.asset.status, updatedTarget: outcome.updatedTarget },
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, outcome);
  });

  app.post<{ Params: { id: string } }>("/assets/:id/manual-url", { config: heavyRateLimit }, async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const body = parse(manualUrlBody, request.body);
    return ok(reply, await setManualUrl(id, body.url, request.authUser?.id));
  });

  app.post<{ Params: { id: string } }>("/assets/:id/manual-upload", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const file = await request.file();
    if (!file) throw badRequest("Envie um arquivo de imagem no campo 'file'.");
    const buffer = await file.toBuffer();
    return ok(reply, await setManualUpload(id, buffer, request.authUser?.id));
  });

  // ---- Relatorio ------------------------------------------------------------
  app.get("/report", async (request, reply) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(1000).optional().default(200) }).parse(request.query);
    return ok(reply, await getRecoveryReport(query.limit));
  });

  app.get("/report.csv", async (_request, reply) => {
    const csv = await buildRecoveryCsv();
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="recuperacao-de-imagens-${date}.csv"`)
      .send(csv);
  });

  // ---- Recuperacao em massa -------------------------------------------------
  app.post("/jobs", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = parse(createJobBody, request.body);
    const job = await createJob({ ...body, adminId: request.authUser?.id });
    // Dispara em background; o estado vive no banco e pode ser consultado.
    setImmediate(() => void runJob(job.id));
    return created(reply, job);
  });

  app.get("/jobs", async (request, reply) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(50).optional().default(20) }).parse(request.query);
    return ok(reply, await listJobs(query.limit));
  });

  app.get<{ Params: { id: string } }>("/jobs/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    return ok(reply, await getJob(id));
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/pause", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    return ok(reply, await pauseJob(id));
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/resume", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    return ok(reply, await resumeJob(id));
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/cancel", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    return ok(reply, await cancelJob(id));
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/confirm", { config: heavyRateLimit }, async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const body = parse(confirmJobBody, request.body ?? {});
    const result = await confirmJobItems(id, body.itemIds, request.authUser?.id);
    await writeAudit({
      adminId: request.authUser?.id,
      action: "IMAGE_RECOVERY_JOB_CONFIRM",
      entity: "ImageRecoveryJob",
      entityId: id,
      after: { confirmed: result.confirmedNow, failed: result.failedNow },
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, result);
  });
}
