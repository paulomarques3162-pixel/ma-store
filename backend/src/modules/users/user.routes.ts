import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { notFound } from "../../lib/errors.js";
import { created, ok, parse } from "../../lib/http.js";

const addressBody = z.object({
  label: z.string().trim().max(60).optional().or(z.literal("")),
  cep: z.string().trim().min(8, "CEP obrigatorio.").max(9),
  street: z.string().trim().min(2, "Informe a rua.").max(160),
  number: z.string().trim().min(1, "Informe o numero.").max(20),
  complement: z.string().trim().max(80).optional().or(z.literal("")),
  district: z.string().trim().min(2, "Informe o bairro.").max(120),
  city: z.string().trim().min(2, "Informe a cidade.").max(120),
  state: z.string().trim().length(2, "Use a sigla do estado (ex: SP).").toUpperCase(),
  isDefault: z.boolean().optional().default(false),
});

const idParam = z.object({ id: z.string().min(1) });

/** Enderecos do cliente (a compra exige conta). */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/me/addresses", async (request, reply) => {
    const addresses = await prisma.address.findMany({
      where: { userId: request.authUser!.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return ok(reply, addresses);
  });

  app.post("/me/addresses", async (request, reply) => {
    const input = parse(addressBody, request.body);
    const userId = request.authUser!.id;

    const address = await prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId } });
      const shouldBeDefault = input.isDefault || count === 0;

      if (shouldBeDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }

      return tx.address.create({
        data: {
          userId,
          label: input.label || null,
          cep: input.cep,
          street: input.street,
          number: input.number,
          complement: input.complement || null,
          district: input.district,
          city: input.city,
          state: input.state,
          isDefault: shouldBeDefault,
        },
      });
    });

    return created(reply, address);
  });

  app.patch("/me/addresses/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(addressBody.partial(), request.body);
    const userId = request.authUser!.id;

    const existing = await prisma.address.findFirst({ where: { id, userId }, select: { id: true } });
    if (!existing) throw notFound("Endereco nao encontrado.");

    const address = await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.update({
        where: { id },
        data: {
          ...(input.label !== undefined ? { label: input.label || null } : {}),
          ...(input.cep ? { cep: input.cep } : {}),
          ...(input.street ? { street: input.street } : {}),
          ...(input.number ? { number: input.number } : {}),
          ...(input.complement !== undefined ? { complement: input.complement || null } : {}),
          ...(input.district ? { district: input.district } : {}),
          ...(input.city ? { city: input.city } : {}),
          ...(input.state ? { state: input.state } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        },
      });
    });

    return ok(reply, address);
  });

  app.delete("/me/addresses/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const result = await prisma.address.deleteMany({ where: { id, userId: request.authUser!.id } });
    if (result.count === 0) throw notFound("Endereco nao encontrado.");
    return ok(reply, { deleted: true });
  });

  app.post("/me/addresses/:id/default", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const userId = request.authUser!.id;

    const existing = await prisma.address.findFirst({ where: { id, userId }, select: { id: true } });
    if (!existing) throw notFound("Endereco nao encontrado.");

    await prisma.$transaction([
      prisma.address.updateMany({ where: { userId }, data: { isDefault: false } }),
      prisma.address.update({ where: { id }, data: { isDefault: true } }),
    ]);

    return ok(reply, { isDefault: true });
  });
}
