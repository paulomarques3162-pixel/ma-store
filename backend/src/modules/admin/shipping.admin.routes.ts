import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { diffFields, writeAudit } from "../../lib/audit.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { created, ok, parse } from "../../lib/http.js";

const idParam = z.object({ id: z.string().min(1) });

const methodBody = z.object({
  name: z.string().trim().min(2, "Informe o nome da modalidade.").max(120),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  carrier: z.string().trim().max(120).optional().or(z.literal("")),
  price: z.coerce.number().min(0, "O valor do frete nao pode ser negativo."),
  freeAbove: z.coerce.number().min(0).optional().nullable(),
  minDays: z.coerce.number().int().min(0).max(90).default(1),
  maxDays: z.coerce.number().int().min(0).max(120).default(5),
  regions: z.array(z.string().length(2)).max(27).default([]),
  active: z.boolean().default(true),
  position: z.coerce.number().int().min(0).default(0),
});

/** Modalidades de frete: tudo configurado pelo admin, nada embutido no codigo. */
export async function shippingAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    const methods = await prisma.shippingMethod.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] });
    return ok(reply, methods);
  });

  app.post("/", async (request, reply) => {
    const input = parse(methodBody, request.body);
    if (input.maxDays < input.minDays) throw badRequest("O prazo maximo deve ser maior ou igual ao minimo.");

    const method = await prisma.shippingMethod.create({
      data: {
        name: input.name,
        description: input.description || null,
        carrier: input.carrier || null,
        price: input.price.toFixed(2),
        freeAbove: input.freeAbove != null ? input.freeAbove.toFixed(2) : null,
        minDays: input.minDays,
        maxDays: input.maxDays,
        regions: input.regions.map((r) => r.toUpperCase()),
        active: input.active,
        position: input.position,
      },
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "CREATE",
      entity: "ShippingMethod",
      entityId: method.id,
      after: { name: method.name, price: method.price },
      ip: request.ip,
      requestId: request.id,
    });

    return created(reply, method);
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(methodBody.partial(), request.body);

    const current = await prisma.shippingMethod.findUnique({ where: { id } });
    if (!current) throw notFound("Modalidade nao encontrada.");

    const minDays = input.minDays ?? current.minDays;
    const maxDays = input.maxDays ?? current.maxDays;
    if (maxDays < minDays) throw badRequest("O prazo maximo deve ser maior ou igual ao minimo.");

    const updated = await prisma.shippingMethod.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.carrier !== undefined ? { carrier: input.carrier || null } : {}),
        ...(input.price !== undefined ? { price: input.price.toFixed(2) } : {}),
        ...(input.freeAbove !== undefined ? { freeAbove: input.freeAbove != null ? input.freeAbove.toFixed(2) : null } : {}),
        ...(input.minDays !== undefined ? { minDays } : {}),
        ...(input.maxDays !== undefined ? { maxDays } : {}),
        ...(input.regions ? { regions: input.regions.map((r) => r.toUpperCase()) } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      },
    });

    const diff = diffFields(
      { name: current.name, price: String(current.price), active: current.active },
      {
        ...(input.name ? { name: input.name } : {}),
        ...(input.price !== undefined ? { price: String(input.price) } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    );

    await writeAudit({
      adminId: request.authUser!.id,
      action: "UPDATE",
      entity: "ShippingMethod",
      entityId: id,
      before: diff.before,
      after: diff.after,
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  app.post("/reorder", async (request, reply) => {
    const input = parse(
      z.object({ items: z.array(z.object({ id: z.string(), position: z.coerce.number().int().min(0) })).min(1) }),
      request.body,
    );

    await prisma.$transaction(
      input.items.map((item) => prisma.shippingMethod.update({ where: { id: item.id }, data: { position: item.position } })),
    );

    return ok(reply, { updated: input.items.length });
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const method = await prisma.shippingMethod.findUnique({
      where: { id },
      select: { name: true, _count: { select: { shipments: true } } },
    });
    if (!method) throw notFound("Modalidade nao encontrada.");

    if (method._count.shipments > 0) {
      const updated = await prisma.shippingMethod.update({ where: { id }, data: { active: false } });
      return ok(reply, { deleted: false, deactivated: true, method: updated });
    }

    await prisma.shippingMethod.delete({ where: { id } });
    await writeAudit({
      adminId: request.authUser!.id,
      action: "DELETE",
      entity: "ShippingMethod",
      entityId: id,
      before: { name: method.name },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, { deleted: true, deactivated: false });
  });
}
