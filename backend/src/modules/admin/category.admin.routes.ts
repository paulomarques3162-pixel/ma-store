import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { diffFields, writeAudit } from "../../lib/audit.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { created, ok, parse } from "../../lib/http.js";
import * as catalog from "../catalog/catalog.service.js";
import { createCategorySchema, createBrandSchema, updateCategorySchema, updateBrandSchema } from "../catalog/catalog.schemas.js";

const idParam = z.object({ id: z.string().min(1) });

export async function categoryAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    const categories = await prisma.category.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: { _count: { select: { products: true } } },
    });
    return ok(
      reply,
      categories.map((c) => ({ ...c, productCount: c._count.products, _count: undefined })),
    );
  });

  app.post("/", async (request, reply) => {
    const input = parse(createCategorySchema, request.body);
    const slug = input.slug ? await catalog.uniqueSlug(input.slug, "category") : await catalog.uniqueSlug(input.name, "category");

    const category = await prisma.category.create({
      data: {
        name: input.name,
        slug,
        description: input.description || null,
        imageUrl: input.imageUrl || null,
        parentId: input.parentId || null,
        position: input.position,
        active: input.active,
      },
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "CREATE",
      entity: "Category",
      entityId: category.id,
      after: { name: category.name, slug: category.slug },
      ip: request.ip,
      requestId: request.id,
    });

    return created(reply, category);
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(updateCategorySchema, request.body);

    const current = await prisma.category.findUnique({ where: { id } });
    if (!current) throw notFound("Categoria nao encontrada.");

    if (input.parentId && input.parentId === id) {
      throw badRequest("Uma categoria nao pode ser pai dela mesma.");
    }

    const slug =
      (input.slug && input.slug !== current.slug) || (input.name && input.name !== current.name)
        ? await catalog.uniqueSlug(input.slug || input.name || current.name, "category", id)
        : current.slug;

    const updated = await prisma.category.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name, slug } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl || null } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId || null } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });

    const diff = diffFields(
      { name: current.name, active: current.active, position: current.position, parentId: current.parentId },
      {
        ...(input.name ? { name: input.name } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId ?? null } : {}),
      },
    );

    await writeAudit({
      adminId: request.authUser!.id,
      action: "UPDATE",
      entity: "Category",
      entityId: id,
      before: diff.before,
      after: diff.after,
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  app.post("/reorder", async (request, reply) => {
    const input = parse(z.object({ items: z.array(z.object({ id: z.string(), position: z.coerce.number().int().min(0) })).min(1) }), request.body);

    await prisma.$transaction(
      input.items.map((item) => prisma.category.update({ where: { id: item.id }, data: { position: item.position } })),
    );

    return ok(reply, { updated: input.items.length });
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const category = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (!category) throw notFound("Categoria nao encontrada.");

    if (category._count.products > 0 || category._count.children > 0) {
      const updated = await prisma.category.update({ where: { id }, data: { active: false } });
      await writeAudit({
        adminId: request.authUser!.id,
        action: "DEACTIVATE",
        entity: "Category",
        entityId: id,
        before: { active: category.active },
        after: { active: false, reason: "possui produtos ou subcategorias" },
        ip: request.ip,
        requestId: request.id,
      });
      return ok(reply, { deleted: false, deactivated: true, category: updated });
    }

    await prisma.category.delete({ where: { id } });
    await writeAudit({
      adminId: request.authUser!.id,
      action: "DELETE",
      entity: "Category",
      entityId: id,
      before: { name: category.name },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, { deleted: true, deactivated: false });
  });
}

export async function brandAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    const brands = await prisma.brand.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });
    return ok(reply, brands.map((b) => ({ ...b, productCount: b._count.products, _count: undefined })));
  });

  app.post("/", async (request, reply) => {
    const input = parse(createBrandSchema, request.body);
    const slug = input.slug ? await catalog.uniqueSlug(input.slug, "brand") : await catalog.uniqueSlug(input.name, "brand");

    const brand = await prisma.brand.create({
      data: { name: input.name, slug, logoUrl: input.logoUrl || null, active: input.active },
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "CREATE",
      entity: "Brand",
      entityId: brand.id,
      after: { name: brand.name },
      ip: request.ip,
      requestId: request.id,
    });

    return created(reply, brand);
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(updateBrandSchema, request.body);

    const current = await prisma.brand.findUnique({ where: { id } });
    if (!current) throw notFound("Marca nao encontrada.");

    const slug =
      (input.slug && input.slug !== current.slug) || (input.name && input.name !== current.name)
        ? await catalog.uniqueSlug(input.slug || input.name || current.name, "brand", id)
        : current.slug;

    const updated = await prisma.brand.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name, slug } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl || null } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "UPDATE",
      entity: "Brand",
      entityId: id,
      before: { name: current.name, active: current.active },
      after: { name: updated.name, active: updated.active },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const brand = await prisma.brand.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
    if (!brand) throw notFound("Marca nao encontrada.");

    if (brand._count.products > 0) {
      const updated = await prisma.brand.update({ where: { id }, data: { active: false } });
      return ok(reply, { deleted: false, deactivated: true, brand: updated });
    }

    await prisma.brand.delete({ where: { id } });
    await writeAudit({
      adminId: request.authUser!.id,
      action: "DELETE",
      entity: "Brand",
      entityId: id,
      before: { name: brand.name },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, { deleted: true, deactivated: false });
  });
}
