import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { created, ok, okPaginated, parse } from "../../lib/http.js";
import { paginate, parsePagination } from "../../lib/serialize.js";
import * as orders from "./order.service.js";

const addressSchema = z.object({
  cep: z.string().trim().min(8, "CEP obrigatorio.").max(9),
  street: z.string().trim().min(2, "Informe a rua.").max(160),
  number: z.string().trim().min(1, "Informe o numero.").max(20),
  complement: z.string().trim().max(80).optional().or(z.literal("")),
  district: z.string().trim().min(2, "Informe o bairro.").max(120),
  city: z.string().trim().min(2, "Informe a cidade.").max(120),
  state: z.string().trim().length(2, "Use a sigla do estado (ex: SP).").toUpperCase(),
});

const createOrderSchema = z.object({
  addressId: z.string().optional(),
  address: addressSchema.optional(),
  shippingMethodId: z.string().optional(),
  couponCode: z.string().trim().max(40).optional().or(z.literal("")),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "BOLETO", "MANUAL"]),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

const statusQuery = z.object({
  status: z
    .enum(["AWAITING_PAYMENT", "PAYMENT_REVIEW", "PAID", "PREPARING", "SHIPPED", "DELIVERED", "CANCELED", "REFUNDED"])
    .optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(50).optional().default(10),
  status: statusQuery.shape.status,
});

const idParam = z.object({ id: z.string().min(1) });

/** Pedidos do cliente autenticado. */
export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/summary", async (request, reply) => {
    const summary = await orders.myOrdersSummary(request.authUser!.id);
    return ok(reply, summary);
  });

  app.post("/", async (request, reply) => {
    const input = parse(createOrderSchema, request.body);
    const idempotencyKey =
      (request.headers["x-idempotency-key"] as string | undefined) ??
      (input.addressId ? `${request.authUser!.id}:${Date.now()}` : undefined);

    const result = await orders.createOrder(request.authUser!.id, {
      ...input,
      couponCode: input.couponCode || undefined,
      notes: input.notes || undefined,
      address: input.address
        ? { ...input.address, complement: input.address.complement || undefined }
        : undefined,
      idempotencyKey,
    });

    return created(reply, result.order);
  });

  app.get("/", async (request, reply) => {
    const query = parse(listQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);
    const { items, total } = await orders.listMyOrders(request.authUser!.id, skip, take, query.status);
    return okPaginated(reply, paginate(items, total, page, perPage));
  });

  app.get("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const order = await orders.getMyOrder(request.authUser!.id, id);
    return ok(reply, order);
  });

  /** Comprovante do pedido: dados imutaveis, pronto para imprimir/PDF. */
  app.get("/:id/receipt", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const receipt = await orders.getOrderReceipt(request.authUser!.id, id, false);
    return ok(reply, receipt);
  });

  app.post("/:id/cancel", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const body = parse(z.object({ reason: z.string().trim().max(300).optional() }).default({}), request.body ?? {});
    const order = await orders.cancelMyOrder(request.authUser!.id, id, body.reason);
    return ok(reply, order);
  });
}
