import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { diffFields, writeAudit } from "../../lib/audit.js";
import { conflict, notFound } from "../../lib/errors.js";
import { created, ok, okPaginated, parse } from "../../lib/http.js";
import { paginate, parsePagination } from "../../lib/serialize.js";

const idParam = z.object({ id: z.string().min(1) });

const couponBody = z.object({
  code: z.string().trim().min(3, "Informe o codigo do cupom.").max(40).transform((v) => v.toUpperCase()),
  description: z.string().trim().max(200).optional().or(z.literal("")),
  type: z.enum(["PERCENT", "FIXED"]),
  value: z.coerce.number().positive("O valor do desconto deve ser maior que zero."),
  minOrderValue: z.coerce.number().min(0).optional().nullable(),
  maxUses: z.coerce.number().int().min(1).optional().nullable(),
  maxUsesPerUser: z.coerce.number().int().min(1).optional().nullable(),
  appliesToAll: z.boolean().optional().default(true),
  appliesToShipping: z.boolean().optional().default(false),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  active: z.boolean().optional().default(true),
  productIds: z.array(z.string()).optional().default([]),
  categoryIds: z.array(z.string()).optional().default([]),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().max(60).optional(),
  active: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true" || v === "1")),
});

/** CRUD de cupons. Todas as regras sao validadas no backend na hora da compra. */
export async function couponAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    const query = parse(listQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);

    const where = {
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search ? { code: { contains: query.search.toUpperCase() } } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.coupon.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          _count: { select: { usages: true, products: true, categories: true } },
        },
      }),
      prisma.coupon.count({ where }),
    ]);

    return okPaginated(
      reply,
      paginate(
        items.map((c) => ({ ...c, usageCount: c._count.usages, productsCount: c._count.products, categoriesCount: c._count.categories, _count: undefined })),
        total,
        page,
        perPage,
      ),
    );
  });

  app.get("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const coupon = await prisma.coupon.findUnique({
      where: { id },
      include: {
        products: { include: { product: { select: { id: true, name: true, sku: true } } } },
        categories: { include: { category: { select: { id: true, name: true } } } },
        usages: {
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { user: { select: { id: true, name: true, email: true } }, order: { select: { number: true } } },
        },
      },
    });
    if (!coupon) throw notFound("Cupom nao encontrado.");
    return ok(reply, coupon);
  });

  app.post("/", async (request, reply) => {
    const input = parse(couponBody, request.body);

    if (input.type === "PERCENT" && input.value > 100) {
      throw conflict("Um desconto percentual nao pode passar de 100%.");
    }

    const existing = await prisma.coupon.findUnique({ where: { code: input.code }, select: { id: true } });
    if (existing) throw conflict("Ja existe um cupom com este codigo.");

    const coupon = await prisma.coupon.create({
      data: {
        code: input.code,
        description: input.description || null,
        type: input.type,
        value: input.value.toFixed(2),
        minOrderValue: input.minOrderValue != null ? input.minOrderValue.toFixed(2) : null,
        maxUses: input.maxUses ?? null,
        maxUsesPerUser: input.maxUsesPerUser ?? null,
        appliesToAll: input.appliesToAll,
        appliesToShipping: input.appliesToShipping,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        active: input.active,
        products: { create: input.productIds.map((productId) => ({ productId })) },
        categories: { create: input.categoryIds.map((categoryId) => ({ categoryId })) },
      },
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "CREATE",
      entity: "Coupon",
      entityId: coupon.id,
      after: { code: coupon.code, type: coupon.type, value: coupon.value },
      ip: request.ip,
      requestId: request.id,
    });

    return created(reply, coupon);
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(couponBody.partial(), request.body);

    const current = await prisma.coupon.findUnique({ where: { id } });
    if (!current) throw notFound("Cupom nao encontrado.");

    if (input.code && input.code !== current.code) {
      const exists = await prisma.coupon.findUnique({ where: { code: input.code }, select: { id: true } });
      if (exists) throw conflict("Ja existe um cupom com este codigo.");
    }
    if (input.type === "PERCENT" && input.value && input.value > 100) {
      throw conflict("Um desconto percentual nao pode passar de 100%.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (input.productIds) {
        await tx.couponProduct.deleteMany({ where: { couponId: id } });
        if (input.productIds.length > 0) {
          await tx.couponProduct.createMany({ data: input.productIds.map((productId) => ({ couponId: id, productId })) });
        }
      }
      if (input.categoryIds) {
        await tx.couponCategory.deleteMany({ where: { couponId: id } });
        if (input.categoryIds.length > 0) {
          await tx.couponCategory.createMany({ data: input.categoryIds.map((categoryId) => ({ couponId: id, categoryId })) });
        }
      }

      return tx.coupon.update({
        where: { id },
        data: {
          ...(input.code ? { code: input.code } : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
          ...(input.type ? { type: input.type } : {}),
          ...(input.value !== undefined ? { value: input.value.toFixed(2) } : {}),
          ...(input.minOrderValue !== undefined ? { minOrderValue: input.minOrderValue != null ? input.minOrderValue.toFixed(2) : null } : {}),
          ...(input.maxUses !== undefined ? { maxUses: input.maxUses ?? null } : {}),
          ...(input.maxUsesPerUser !== undefined ? { maxUsesPerUser: input.maxUsesPerUser ?? null } : {}),
          ...(input.appliesToAll !== undefined ? { appliesToAll: input.appliesToAll } : {}),
          ...(input.appliesToShipping !== undefined ? { appliesToShipping: input.appliesToShipping } : {}),
          ...(input.startsAt !== undefined ? { startsAt: input.startsAt ? new Date(input.startsAt) : null } : {}),
          ...(input.endsAt !== undefined ? { endsAt: input.endsAt ? new Date(input.endsAt) : null } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
    });

    const diff = diffFields(
      { code: current.code, value: String(current.value), active: current.active, maxUses: current.maxUses },
      {
        ...(input.code ? { code: input.code } : {}),
        ...(input.value !== undefined ? { value: String(input.value) } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.maxUses !== undefined ? { maxUses: input.maxUses ?? null } : {}),
      },
    );

    await writeAudit({
      adminId: request.authUser!.id,
      action: "UPDATE",
      entity: "Coupon",
      entityId: id,
      before: diff.before,
      after: diff.after,
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  app.post("/:id/toggle", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const current = await prisma.coupon.findUnique({ where: { id }, select: { active: true, code: true } });
    if (!current) throw notFound("Cupom nao encontrado.");

    const updated = await prisma.coupon.update({ where: { id }, data: { active: !current.active } });

    await writeAudit({
      adminId: request.authUser!.id,
      action: updated.active ? "ACTIVATE" : "DEACTIVATE",
      entity: "Coupon",
      entityId: id,
      before: { active: current.active },
      after: { active: updated.active },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const coupon = await prisma.coupon.findUnique({
      where: { id },
      select: { code: true, _count: { select: { usages: true } } },
    });
    if (!coupon) throw notFound("Cupom nao encontrado.");

    if (coupon._count.usages > 0) {
      const updated = await prisma.coupon.update({ where: { id }, data: { active: false } });
      return ok(reply, { deleted: false, deactivated: true, coupon: updated });
    }

    await prisma.coupon.delete({ where: { id } });
    await writeAudit({
      adminId: request.authUser!.id,
      action: "DELETE",
      entity: "Coupon",
      entityId: id,
      before: { code: coupon.code },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, { deleted: true, deactivated: false });
  });
}
