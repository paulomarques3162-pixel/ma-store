import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { deliveryError, notFound, validationError } from "../lib/errors.js";
import { decimalToNumber } from "../lib/serialize.js";
import { DELIVERED_ORDER_STATUS } from "../lib/order-status.js";
import { writeAudit } from "../lib/audit.js";
import { proofRefBelongsToDelivery } from "./delivery-proof.js";

/**
 * Modulo de entrega / motoboy.
 *
 * Regras centrais:
 *  - autorizacao SEMPRE no backend: entregador acessa apenas a propria entrega;
 *  - preco/status/entregador/pedido nunca vem do frontend;
 *  - transicoes de status sao atomicas (`updateMany` condicional) e idempotentes;
 *  - toda mudanca relevante gera um DeliveryEvent (historico auditavel);
 *  - ao concluir/falhar, o status do PEDIDO e atualizado na mesma transacao.
 */

export const DELIVERY_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
] as const;
export type DeliveryStatusValue = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_FAILURE_REASONS = [
  "CLIENTE_AUSENTE",
  "ENDERECO_NAO_LOCALIZADO",
  "RECUSA_DO_RECEBEDOR",
  "AREA_INACESSIVEL",
  "PROBLEMA_DE_ACESSO",
  "OUTRO",
] as const;
export type DeliveryFailureReasonValue = (typeof DELIVERY_FAILURE_REASONS)[number];

export const ORDER_STATUS_OUT_FOR_DELIVERY = "Saiu para Entrega";
export const ORDER_STATUS_READY = "Pronto para Envio";
export const ORDER_STATUS_PREPARING = "Empacotando Produto";

type Geo = {
  latitude?: number | null;
  longitude?: number | null;
  locationAccuracy?: number | null;
};

/* -------------------------------------------------------------------------- */
/* Serializacao                                                               */
/* -------------------------------------------------------------------------- */

type DeliveryWithRelations = Prisma.DeliveryGetPayload<{
  include: { pedido: true; driver: { select: { id: true; name: true; phone: true } }; events: true };
}>;

type Endereco = {
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string | null;
  bairro?: string;
  cidade?: string;
  uf?: string;
};

/** Entrega no formato consumido pelo entregador (somente dados necessarios). */
export function toPublicDelivery(delivery: DeliveryWithRelations) {
  const endereco = (delivery.pedido.enderecoCompleto ?? {}) as Endereco;
  return {
    id: delivery.id,
    pedidoId: delivery.pedidoId,
    orderNumber: delivery.pedidoId,
    status: delivery.status,
    cliente: {
      nome: delivery.pedido.clienteNome,
      telefone: delivery.pedido.clienteWhatsapp,
    },
    endereco: {
      cep: endereco.cep ?? null,
      logradouro: endereco.logradouro ?? null,
      numero: endereco.numero ?? null,
      complemento: endereco.complemento ?? null,
      bairro: endereco.bairro ?? null,
      cidade: endereco.cidade ?? null,
      uf: endereco.uf ?? null,
    },
    itens: Array.isArray(delivery.pedido.produtosCarrinho) ? delivery.pedido.produtosCarrinho : [],
    observacoes: delivery.notes,
    failureReason: delivery.failureReason,
    recipientName: delivery.recipientName,
    hasProof: Boolean(delivery.proofPhotoUrl),
    proofEndpoint: delivery.proofPhotoUrl ? `/api/delivery/${delivery.id}/proof` : null,
    latitude: delivery.latitude === null ? null : decimalToNumber(delivery.latitude),
    longitude: delivery.longitude === null ? null : decimalToNumber(delivery.longitude),
    locationAccuracy: delivery.locationAccuracy === null ? null : decimalToNumber(delivery.locationAccuracy),
    assignedAt: delivery.assignedAt?.toISOString() ?? null,
    startedAt: delivery.startedAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    driver: delivery.driver ? { id: delivery.driver.id, name: delivery.driver.name, phone: delivery.driver.phone } : null,
    events: delivery.events.map((event) => ({
      id: event.id,
      status: event.status,
      notes: event.notes,
      failureReason: event.failureReason,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/** Versao enxuta para listagens (sem historico/coordenadas). */
export function toDeliveryListItem(delivery: DeliveryWithRelations) {
  const endereco = (delivery.pedido.enderecoCompleto ?? {}) as Endereco;
  return {
    id: delivery.id,
    pedidoId: delivery.pedidoId,
    orderNumber: delivery.pedidoId,
    status: delivery.status,
    clienteNome: delivery.pedido.clienteNome,
    endereco: `${endereco.logradouro ?? ""}, ${endereco.numero ?? ""}`.trim().replace(/,\s*$/, ""),
    bairro: endereco.bairro ?? null,
    cidade: endereco.cidade ?? null,
    cep: endereco.cep ?? null,
    observacoes: delivery.notes,
    driver: delivery.driver ? { id: delivery.driver.id, name: delivery.driver.name } : null,
    createdAt: delivery.createdAt.toISOString(),
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                  */
/* -------------------------------------------------------------------------- */

const deliveryInclude = {
  pedido: true,
  driver: { select: { id: true, name: true, phone: true } },
  events: { orderBy: { createdAt: "asc" as const } },
};

async function getRaw(deliveryId: string): Promise<DeliveryWithRelations> {
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId }, include: deliveryInclude });
  if (!delivery) throw deliveryError("DELIVERY_NOT_FOUND", "Entrega nao encontrada.");
  return delivery;
}

/** Entregas do entregador autenticado (nunca aceita driverId do cliente). */
export async function listDriverDeliveries(driverId: string, status?: string) {
  const where: Prisma.DeliveryWhereInput = {
    driverId,
    ...(status && (DELIVERY_STATUSES as readonly string[]).includes(status)
      ? { status: status as DeliveryStatusValue }
      : {}),
  };
  const rows = await prisma.delivery.findMany({
    where,
    include: deliveryInclude,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return rows.map(toDeliveryListItem);
}

export function driverCounters(rows: Array<{ status: string }>) {
  return {
    pending: rows.filter((row) => row.status === "PENDING").length,
    assigned: rows.filter((row) => row.status === "ASSIGNED").length,
    outForDelivery: rows.filter((row) => row.status === "OUT_FOR_DELIVERY").length,
    delivered: rows.filter((row) => row.status === "DELIVERED").length,
    failed: rows.filter((row) => row.status === "FAILED").length,
    total: rows.length,
  };
}

/** Busca uma entrega garantindo que o solicitante e ADMIN ou o proprio driver. */
export async function getDeliveryForViewer(
  deliveryId: string,
  viewer: { id: string; role: string },
): Promise<DeliveryWithRelations> {
  const delivery = await getRaw(deliveryId);
  if (viewer.role !== "ADMIN" && delivery.driverId !== viewer.id) {
    throw deliveryError("NOT_AUTHORIZED", "Voce nao tem acesso a esta entrega.");
  }
  return delivery;
}

/* -------------------------------------------------------------------------- */
/* Atribuicao (ADMIN)                                                         */
/* -------------------------------------------------------------------------- */

async function assertEligibleDriver(driverId: string) {
  const driver = await prisma.user.findUnique({
    where: { id: driverId },
    select: { id: true, name: true, role: true, status: true },
  });
  if (!driver) throw deliveryError("DRIVER_NOT_FOUND", "Entregador nao encontrado.");
  if (driver.role !== "DELIVERY_PERSON") {
    throw deliveryError("INVALID_DRIVER", "O usuario selecionado nao e um entregador.");
  }
  if (driver.status !== "ACTIVE") {
    throw deliveryError("INVALID_DRIVER", "O entregador selecionado esta desativado.");
  }
  return driver;
}

async function notifyDriver(driverId: string, pedidoId: number) {
  try {
    await prisma.notification.create({
      data: {
        userId: driverId,
        type: "SYSTEM",
        title: "Nova entrega atribuida",
        body: `O pedido #${pedidoId} foi atribuido a voce.`,
        link: "/motoboy/entregas",
      },
    });
  } catch {
    /* notificacao e best-effort: nunca quebra a atribuicao */
  }
}

/** Cria (se necessario) a entrega do pedido e atribui ao entregador. */
export async function assignDelivery(input: {
  pedidoId: number;
  driverId: string;
  adminId: string;
  ip?: string | null;
  requestId?: string | null;
}) {
  const driver = await assertEligibleDriver(input.driverId);
  const pedido = await prisma.pedido.findUnique({
    where: { id: input.pedidoId },
    select: { id: true, statusAtual: true },
  });
  if (!pedido) throw notFound("Pedido nao encontrado.");
  if (pedido.statusAtual === DELIVERED_ORDER_STATUS) {
    throw deliveryError("DELIVERY_ALREADY_COMPLETED", "Este pedido ja foi entregue.");
  }

  const existing = await prisma.delivery.findUnique({ where: { pedidoId: input.pedidoId } });
  if (existing?.status === "DELIVERED") {
    throw deliveryError("DELIVERY_ALREADY_COMPLETED", "Esta entrega ja foi concluida.");
  }

  const previousDriverId = existing?.driverId ?? null;
  const reassigned = Boolean(previousDriverId && previousDriverId !== input.driverId);

  const delivery = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.delivery.update({
          where: { id: existing.id },
          data: {
            driverId: input.driverId,
            status: "ASSIGNED",
            assignedAt: new Date(),
            startedAt: null,
            deliveredAt: null,
            failureReason: null,
          },
        })
      : await tx.delivery.create({
          data: { pedidoId: input.pedidoId, driverId: input.driverId, status: "ASSIGNED", assignedAt: new Date() },
        });

    await tx.deliveryEvent.create({
      data: {
        deliveryId: saved.id,
        status: "ASSIGNED",
        notes: reassigned ? "Entrega reatribuida." : "Entrega atribuida.",
        createdBy: input.adminId,
      },
    });

    return tx.delivery.findUniqueOrThrow({ where: { id: saved.id }, include: deliveryInclude });
  });

  if (reassigned) {
    await writeAudit({
      adminId: input.adminId,
      action: "delivery_reassigned",
      entity: "Delivery",
      entityId: delivery.id,
      before: { driverId: previousDriverId },
      after: { driverId: input.driverId },
      ip: input.ip,
      requestId: input.requestId,
    });
  } else {
    await writeAudit({
      adminId: input.adminId,
      action: "delivery_assigned",
      entity: "Delivery",
      entityId: delivery.id,
      after: { driverId: input.driverId, pedidoId: input.pedidoId },
      ip: input.ip,
      requestId: input.requestId,
    });
  }

  await notifyDriver(driver.id, input.pedidoId);
  return toPublicDelivery(delivery);
}

/* -------------------------------------------------------------------------- */
/* Inicio (entregador)                                                        */
/* -------------------------------------------------------------------------- */

export async function startDelivery(input: {
  deliveryId: string;
  driverId: string;
  location?: Geo;
  ip?: string | null;
}) {
  const delivery = await getRaw(input.deliveryId);
  if (delivery.driverId !== input.driverId) {
    throw deliveryError("NOT_AUTHORIZED", "Esta entrega nao pertence a voce.");
  }
  if (delivery.status === "DELIVERED") {
    throw deliveryError("DELIVERY_ALREADY_COMPLETED", "Esta entrega ja foi concluida.");
  }
  if (delivery.status === "CANCELLED") {
    throw deliveryError("INVALID_STATUS", "Esta entrega foi cancelada.");
  }

  const now = new Date();
  const location = input.location ?? {};
  const updated = await prisma.$transaction(async (tx) => {
    // Transicao atomica: so sai de ASSIGNED uma vez. Idempotente em OUT_FOR_DELIVERY.
    const changed = await tx.delivery.updateMany({
      where: { id: delivery.id, driverId: input.driverId, status: "ASSIGNED" },
      data: {
        status: "OUT_FOR_DELIVERY",
        startedAt: now,
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
        locationAccuracy: location.locationAccuracy ?? null,
      },
    });

    if (changed.count > 0) {
      await tx.deliveryEvent.create({
        data: {
          deliveryId: delivery.id,
          status: "OUT_FOR_DELIVERY",
          latitude: location.latitude ?? null,
          longitude: location.longitude ?? null,
          locationAccuracy: location.locationAccuracy ?? null,
          createdBy: input.driverId,
        },
      });
      if (delivery.pedido.statusAtual !== ORDER_STATUS_OUT_FOR_DELIVERY && delivery.pedido.statusAtual !== DELIVERED_ORDER_STATUS) {
        await tx.pedido.update({ where: { id: delivery.pedidoId }, data: { statusAtual: ORDER_STATUS_OUT_FOR_DELIVERY } });
      }
    }

    return tx.delivery.findUniqueOrThrow({ where: { id: delivery.id }, include: deliveryInclude });
  });

  if (updated.status !== "OUT_FOR_DELIVERY") {
    throw deliveryError("INVALID_STATUS", "Nao foi possivel iniciar esta entrega.");
  }

  await writeAudit({
    adminId: input.driverId,
    action: "delivery_started",
    entity: "Delivery",
    entityId: delivery.id,
    ip: input.ip,
  });
  return toPublicDelivery(updated);
}

/* -------------------------------------------------------------------------- */
/* Confirmacao (entregador) — transacional e idempotente                      */
/* -------------------------------------------------------------------------- */

export async function confirmDelivery(input: {
  deliveryId: string;
  driverId: string;
  recipientName: string;
  notes?: string | null;
  recipientDocumentLast4?: string | null;
  proofPhotoRef: string;
  location?: Geo;
  ip?: string | null;
}) {
  const recipientName = (input.recipientName ?? "").trim();
  if (recipientName.length < 2) {
    throw deliveryError("RECIPIENT_NAME_REQUIRED", "Informe quem recebeu a entrega.");
  }
  if (recipientName.length > 160) {
    throw deliveryError("RECIPIENT_NAME_REQUIRED", "Nome do recebedor muito longo.");
  }
  if (!input.proofPhotoRef) {
    throw deliveryError("PROOF_REQUIRED", "Envie a foto da entrega.");
  }

  const delivery = await getRaw(input.deliveryId);
  if (delivery.driverId !== input.driverId) {
    throw deliveryError("NOT_AUTHORIZED", "Esta entrega nao pertence a voce.");
  }

  // Idempotencia: se ja esta concluida, devolve o mesmo resultado (sem duplicar).
  if (delivery.status === "DELIVERED") return toPublicDelivery(delivery);
  if (delivery.status !== "OUT_FOR_DELIVERY" && delivery.status !== "ASSIGNED") {
    throw deliveryError("INVALID_STATUS", "Esta entrega nao pode ser confirmada no status atual.");
  }

  // A foto precisa ter sido enviada PARA esta entrega.
  if (!proofRefBelongsToDelivery(input.proofPhotoRef, delivery.id)) {
    throw deliveryError("PROOF_REQUIRED", "Foto da entrega invalida. Envie novamente.");
  }

  const now = new Date();
  const location = input.location ?? {};
  const notes = input.notes?.trim().slice(0, 500) || null;

  const result = await prisma.$transaction(async (tx) => {
    // Transicao condicional: evita dupla confirmacao / concorrencia.
    const changed = await tx.delivery.updateMany({
      where: { id: delivery.id, driverId: input.driverId, status: { in: ["OUT_FOR_DELIVERY", "ASSIGNED"] } },
      data: {
        status: "DELIVERED",
        deliveredAt: now,
        recipientName,
        recipientDocumentLast4: input.recipientDocumentLast4?.trim().slice(0, 4) || null,
        proofPhotoUrl: input.proofPhotoRef,
        notes,
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
        locationAccuracy: location.locationAccuracy ?? null,
        failureReason: null,
      },
    });

    if (changed.count > 0) {
      await tx.deliveryEvent.create({
        data: {
          deliveryId: delivery.id,
          status: "DELIVERED",
          latitude: location.latitude ?? null,
          longitude: location.longitude ?? null,
          locationAccuracy: location.locationAccuracy ?? null,
          notes: `Recebido por ${recipientName}`,
          createdBy: input.driverId,
        },
      });
      // Integra com o pedido: status Entregue + quem recebeu + data (server time).
      await tx.pedido.update({
        where: { id: delivery.pedidoId },
        data: { statusAtual: DELIVERED_ORDER_STATUS, recebidoPor: recipientName, dataEntrega: now },
      });
    }

    return tx.delivery.findUniqueOrThrow({ where: { id: delivery.id }, include: deliveryInclude });
  });

  await writeAudit({
    adminId: input.driverId,
    action: "delivery_confirmed",
    entity: "Delivery",
    entityId: delivery.id,
    after: { recipientName },
    ip: input.ip,
  });
  return toPublicDelivery(result);
}

/* -------------------------------------------------------------------------- */
/* Falha (entregador)                                                         */
/* -------------------------------------------------------------------------- */

export async function failDelivery(input: {
  deliveryId: string;
  driverId: string;
  reason: DeliveryFailureReasonValue;
  notes?: string | null;
  location?: Geo;
  ip?: string | null;
}) {
  if (!(DELIVERY_FAILURE_REASONS as readonly string[]).includes(input.reason)) {
    throw deliveryError("FAILURE_REASON_REQUIRED", "Informe o motivo da nao entrega.");
  }
  const notes = input.notes?.trim().slice(0, 500) || null;
  if (input.reason === "OUTRO" && (!notes || notes.length < 3)) {
    throw deliveryError("FAILURE_REASON_REQUIRED", "Descreva o motivo da nao entrega.");
  }

  const delivery = await getRaw(input.deliveryId);
  if (delivery.driverId !== input.driverId) {
    throw deliveryError("NOT_AUTHORIZED", "Esta entrega nao pertence a voce.");
  }
  if (delivery.status === "DELIVERED") {
    throw deliveryError("DELIVERY_ALREADY_COMPLETED", "Esta entrega ja foi concluida.");
  }
  if (delivery.status === "FAILED") return toPublicDelivery(delivery);
  if (delivery.status !== "OUT_FOR_DELIVERY" && delivery.status !== "ASSIGNED") {
    throw deliveryError("INVALID_STATUS", "Esta entrega nao pode ser marcada como nao entregue.");
  }

  const location = input.location ?? {};
  const result = await prisma.$transaction(async (tx) => {
    const changed = await tx.delivery.updateMany({
      where: { id: delivery.id, driverId: input.driverId, status: { in: ["OUT_FOR_DELIVERY", "ASSIGNED"] } },
      data: {
        status: "FAILED",
        failureReason: input.reason,
        notes,
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
        locationAccuracy: location.locationAccuracy ?? null,
      },
    });

    if (changed.count > 0) {
      await tx.deliveryEvent.create({
        data: {
          deliveryId: delivery.id,
          status: "FAILED",
          failureReason: input.reason,
          notes,
          latitude: location.latitude ?? null,
          longitude: location.longitude ?? null,
          locationAccuracy: location.locationAccuracy ?? null,
          createdBy: input.driverId,
        },
      });
      // Pedido volta para o fluxo administrativo de envio.
      await tx.pedido.update({ where: { id: delivery.pedidoId }, data: { statusAtual: ORDER_STATUS_READY } });
    }

    return tx.delivery.findUniqueOrThrow({ where: { id: delivery.id }, include: deliveryInclude });
  });

  await writeAudit({
    adminId: input.driverId,
    action: "delivery_failed",
    entity: "Delivery",
    entityId: delivery.id,
    after: { reason: input.reason },
    ip: input.ip,
  });
  return toPublicDelivery(result);
}

/* -------------------------------------------------------------------------- */
/* Consultas administrativas                                                  */
/* -------------------------------------------------------------------------- */

export async function listAdminDeliveries(filters: { status?: string; driverId?: string; page: number; perPage: number }) {
  const where: Prisma.DeliveryWhereInput = {
    ...(filters.status && (DELIVERY_STATUSES as readonly string[]).includes(filters.status)
      ? { status: filters.status as DeliveryStatusValue }
      : {}),
    ...(filters.driverId ? { driverId: filters.driverId } : {}),
  };
  const skip = (filters.page - 1) * filters.perPage;
  const [rows, total] = await Promise.all([
    prisma.delivery.findMany({
      where,
      include: deliveryInclude,
      orderBy: { createdAt: "desc" },
      skip,
      take: filters.perPage,
    }),
    prisma.delivery.count({ where }),
  ]);
  return { items: rows.map(toDeliveryListItem), total, page: filters.page, perPage: filters.perPage };
}

/** Pedidos prontos para envio e ainda sem entrega (para atribuicao no admin). */
export async function listPendingAssignmentPedidos() {
  return prisma.pedido.findMany({
    where: { statusAtual: ORDER_STATUS_READY, delivery: null },
    select: {
      id: true,
      clienteNome: true,
      statusAtual: true,
      enderecoCompleto: true,
      criadoEm: true,
    },
    orderBy: { criadoEm: "asc" },
    take: 100,
  });
}

export async function getDeliveryPublicById(deliveryId: string) {
  return toPublicDelivery(await getRaw(deliveryId));
}

/** Prova de entrega: retorna a referencia privada (para servir o arquivo). */
export async function getProofRef(deliveryId: string, viewer: { id: string; role: string }) {
  const delivery = await getDeliveryForViewer(deliveryId, viewer);
  if (!delivery.proofPhotoUrl) throw deliveryError("DELIVERY_NOT_FOUND", "Esta entrega nao possui prova.");
  return delivery.proofPhotoUrl;
}

export async function validateDeliveryForPhoto(deliveryId: string, driverId: string) {
  const delivery = await getRaw(deliveryId);
  if (delivery.driverId !== driverId) {
    throw deliveryError("NOT_AUTHORIZED", "Esta entrega nao pertence a voce.");
  }
  if (delivery.status === "DELIVERED") {
    throw deliveryError("DELIVERY_ALREADY_COMPLETED", "Esta entrega ja foi concluida.");
  }
  if (delivery.status !== "OUT_FOR_DELIVERY" && delivery.status !== "ASSIGNED") {
    throw deliveryError("INVALID_STATUS", "Nao e possivel enviar foto no status atual.");
  }
  return delivery;
}

/* -------------------------------------------------------------------------- */
/* Relatorio de entregas por entregador                                       */
/* -------------------------------------------------------------------------- */

export type DeliveryReportRow = {
  driverId: string | null;
  driverName: string;
  total: number;
  delivered: number;
  failed: number;
  inProgress: number;
  /** Concluidas / (concluidas + falhas), em %. 0 quando ainda nao decididas. */
  successRate: number;
};

export type DeliveryReport = {
  from: string | null;
  to: string | null;
  rows: DeliveryReportRow[];
  totals: { total: number; delivered: number; failed: number; inProgress: number };
};

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

/**
 * Agrega entregas por entregador no periodo (por data de criacao da entrega).
 * Conta concluidas, falhas e em andamento, alem da taxa de sucesso.
 * Sem N+1: uma consulta agregada + uma busca de nomes.
 */
export async function reportDeliveriesByDriver(filters: { from?: Date | null; to?: Date | null }): Promise<DeliveryReport> {
  const from = filters.from ? startOfDay(filters.from) : null;
  const to = filters.to ? endOfDay(filters.to) : null;

  const where: Prisma.DeliveryWhereInput = from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};

  const grouped = await prisma.delivery.groupBy({
    by: ["driverId", "status"],
    where,
    _count: { _all: true },
  });

  const byDriver = new Map<string, DeliveryReportRow>();
  for (const row of grouped) {
    const key = row.driverId ?? "__unassigned__";
    const entry =
      byDriver.get(key) ??
      ({ driverId: row.driverId, driverName: "", total: 0, delivered: 0, failed: 0, inProgress: 0, successRate: 0 } as DeliveryReportRow);
    const count = row._count._all;
    entry.total += count;
    if (row.status === "DELIVERED") entry.delivered += count;
    else if (row.status === "FAILED") entry.failed += count;
    else if (row.status === "ASSIGNED" || row.status === "OUT_FOR_DELIVERY") entry.inProgress += count;
    byDriver.set(key, entry);
  }

  const driverIds = [...byDriver.values()]
    .map((entry) => entry.driverId)
    .filter((id): id is string => Boolean(id));
  const users = driverIds.length
    ? await prisma.user.findMany({ where: { id: { in: driverIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((user) => [user.id, user.name]));

  const rows = [...byDriver.values()]
    .map((entry) => {
      const decided = entry.delivered + entry.failed;
      return {
        ...entry,
        driverName: entry.driverId ? (nameById.get(entry.driverId) ?? "Entregador removido") : "Nao atribuido",
        successRate: decided > 0 ? Math.round((entry.delivered / decided) * 100) : 0,
      };
    })
    .sort((a, b) => b.total - a.total || a.driverName.localeCompare(b.driverName));

  const totals = rows.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      delivered: acc.delivered + row.delivered,
      failed: acc.failed + row.failed,
      inProgress: acc.inProgress + row.inProgress,
    }),
    { total: 0, delivered: 0, failed: 0, inProgress: 0 },
  );

  return { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null, rows, totals };
}
