import type { FastifyInstance } from "fastify";
import { writeAudit } from "../../lib/audit.js";
import { ok, parse } from "../../lib/http.js";
import * as delivery from "../../services/delivery.js";
import { readDeliveryProof } from "../../services/delivery-proof.js";
import { adminDeliveryQuery, assignSchema, deliveryReportQuery, reassignSchema } from "../delivery/delivery.schemas.js";

const idParam = (params: unknown) => (params as { id: string }).id;

/** Gestao administrativa de entregas (somente ADMIN). */
export async function deliveryAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  app.get("/", async (request, reply) => {
    const query = parse(adminDeliveryQuery, request.query);
    const result = await delivery.listAdminDeliveries(query);
    return ok(reply, {
      success: true,
      deliveries: result.items,
      meta: {
        page: result.page,
        perPage: result.perPage,
        total: result.total,
        totalPages: Math.ceil(result.total / result.perPage),
      },
    });
  });

  /** Relatorio de entregas por entregador (periodo opcional). */
  app.get("/report", async (request, reply) => {
    const query = parse(deliveryReportQuery, request.query);
    const report = await delivery.reportDeliveriesByDriver({
      from: query.from ? new Date(`${query.from}T00:00:00`) : null,
      to: query.to ? new Date(`${query.to}T00:00:00`) : null,
    });
    return ok(reply, { success: true, ...report });
  });

  /** Pedidos prontos para envio e ainda sem entrega. */
  app.get("/pending", async (_request, reply) => {
    const pedidos = await delivery.listPendingAssignmentPedidos();
    return ok(reply, { success: true, pedidos });
  });

  app.get("/:id", async (request, reply) => {
    const item = await delivery.getDeliveryPublicById(idParam(request.params));
    return ok(reply, { success: true, delivery: item });
  });

  app.get("/:id/proof", async (request, reply) => {
    const ref = await delivery.getProofRef(idParam(request.params), { id: request.authUser!.id, role: "ADMIN" });
    const { buffer, mime } = await readDeliveryProof(ref);
    return reply.header("Cache-Control", "private, no-store").type(mime).send(buffer);
  });

  /** Atribui (ou reatribui) a entrega de um pedido a um entregador. */
  app.post("/assign", async (request, reply) => {
    const input = parse(assignSchema, request.body);
    const result = await delivery.assignDelivery({
      pedidoId: input.pedidoId,
      driverId: input.driverId,
      adminId: request.authUser!.id,
      ip: request.ip,
      requestId: request.id,
    });
    request.log.info({ event: "delivery_assigned", deliveryId: result.id }, "delivery_assigned");
    return ok(reply, { success: true, delivery: result });
  });

  app.post("/:id/reassign", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const input = parse(reassignSchema, request.body);
    const current = await delivery.getDeliveryPublicById(id);
    const result = await delivery.assignDelivery({
      pedidoId: current.pedidoId,
      driverId: input.driverId,
      adminId: request.authUser!.id,
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, { success: true, delivery: result });
  });

  /** Auditoria explicita ao visualizar a prova (quando aplicavel). */
  app.post("/:id/proof-viewed", async (request, reply) => {
    await writeAudit({
      adminId: request.authUser!.id,
      action: "proof_viewed",
      entity: "Delivery",
      entityId: idParam(request.params),
      ip: request.ip,
      requestId: request.id,
    });
    return ok(reply, { success: true });
  });
}
