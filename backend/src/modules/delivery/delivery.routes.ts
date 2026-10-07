import type { FastifyInstance } from "fastify";
import { parse } from "../../lib/http.js";
import * as delivery from "../../services/delivery.js";
import { readDeliveryProof, saveDeliveryProof } from "../../services/delivery-proof.js";
import {
  confirmDeliverySchema,
  driverListQuery,
  failDeliverySchema,
  startDeliverySchema,
} from "./delivery.schemas.js";

const idParam = (params: unknown) => (params as { id: string }).id;

/**
 * API do ENTREGADOR (motoboy).
 *
 * - `GET /my` e as acoes (start/photo/confirm/fail) exigem role DELIVERY_PERSON
 *   e usam SEMPRE o `driverId` da sessao (nunca aceitam driverId do frontend).
 * - `GET /:id` e `GET /:id/proof` permitem ADMIN ou o proprio entregador.
 */
export async function deliveryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/my", { preHandler: app.requireDeliveryPerson }, async (request, reply) => {
    const query = parse(driverListQuery, request.query);
    const rows = await delivery.listDriverDeliveries(request.authUser!.id, query.status);
    return reply.send({ data: { deliveries: rows, counters: delivery.driverCounters(rows) } });
  });

  app.get("/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const viewer = { id: request.authUser!.id, role: request.authUser!.role };
    const result = await delivery.getDeliveryForViewer(idParam(request.params), viewer);
    return reply.send({ data: delivery.toPublicDelivery(result) });
  });

  app.get("/:id/proof", { preHandler: app.authenticate }, async (request, reply) => {
    const viewer = { id: request.authUser!.id, role: request.authUser!.role };
    const ref = await delivery.getProofRef(idParam(request.params), viewer);
    const { buffer, mime } = await readDeliveryProof(ref);
    return reply
      .header("Cache-Control", "private, no-store")
      .type(mime)
      .send(buffer);
  });

  app.post("/:id/start", { preHandler: app.requireDeliveryPerson }, async (request, reply) => {
    const input = parse(startDeliverySchema, request.body ?? {});
    const result = await delivery.startDelivery({
      deliveryId: idParam(request.params),
      driverId: request.authUser!.id,
      location: input,
      ip: request.ip,
    });
    request.log.info({ event: "delivery_started", deliveryId: result.id }, "delivery_started");
    return reply.send({ data: result });
  });

  /** Upload da foto da prova (multipart, campo `file`). */
  app.post("/:id/photo", { preHandler: app.requireDeliveryPerson }, async (request, reply) => {
    const deliveryId = idParam(request.params);
    await delivery.validateDeliveryForPhoto(deliveryId, request.authUser!.id);

    const file = await request.file();
    if (!file) {
      return reply.status(422).send({ error: { code: "PROOF_REQUIRED", message: "Envie a foto no campo 'file'." } });
    }
    const buffer = await file.toBuffer();
    const saved = await saveDeliveryProof(deliveryId, buffer);
    return reply.status(201).send({ data: { proofPhotoRef: saved.ref } });
  });

  app.post("/:id/confirm", { preHandler: app.requireDeliveryPerson }, async (request, reply) => {
    const input = parse(confirmDeliverySchema, request.body);
    const result = await delivery.confirmDelivery({
      deliveryId: idParam(request.params),
      driverId: request.authUser!.id,
      recipientName: input.recipientName,
      recipientDocumentLast4: input.recipientDocumentLast4 ?? null,
      notes: input.notes ?? null,
      proofPhotoRef: input.proofPhotoRef ?? "",
      location: {
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        locationAccuracy: input.locationAccuracy ?? null,
      },
      ip: request.ip,
    });
    request.log.info({ event: "delivery_confirmed", deliveryId: result.id }, "delivery_confirmed");
    return reply.send({ data: result });
  });

  app.post("/:id/fail", { preHandler: app.requireDeliveryPerson }, async (request, reply) => {
    const input = parse(failDeliverySchema, request.body);
    const result = await delivery.failDelivery({
      deliveryId: idParam(request.params),
      driverId: request.authUser!.id,
      reason: input.reason,
      notes: input.notes ?? null,
      location: {
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        locationAccuracy: input.locationAccuracy ?? null,
      },
      ip: request.ip,
    });
    request.log.info({ event: "delivery_failed", deliveryId: result.id, reason: input.reason }, "delivery_failed");
    return reply.send({ data: result });
  });
}
