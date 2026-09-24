import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { diffFields, writeAudit } from "../../lib/audit.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { created, ok, okPaginated, parse } from "../../lib/http.js";
import { paginate, parsePagination } from "../../lib/serialize.js";
import { deleteLocalUpload } from "../../services/storage.js";
import * as catalog from "../catalog/catalog.service.js";
import {
  createProductSchema,
  listProductQuery,
  updateProductSchema,
  updateStockSchema,
} from "../catalog/catalog.schemas.js";

const idParam = z.object({ id: z.string().min(1) });

/** CRUD administrativo de produtos. Toda alteracao vai para a auditoria. */
export async function productAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    const query = parse(
      listProductQuery.extend({
        includeInactive: z
          .enum(["true", "false", "1", "0"])
          .optional()
          .transform((v) => v === "true" || v === "1"),
        lowStock: z
          .enum(["true", "false", "1", "0"])
          .optional()
          .transform((v) => v === "true" || v === "1"),
      }),
      request.query,
    );
    const { page, perPage, skip, take } = parsePagination(query);

    const where = catalog.buildPublicWhere({ ...query });
    if (query.includeInactive) delete (where as { active?: boolean }).active;

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: catalog.buildOrderBy(query.sort),
        skip,
        take,
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          price: true,
          comparePrice: true,
          costPrice: true,
          volume: true,
          stock: true,
          reservedStock: true,
          soldStock: true,
          minStock: true,
          hasShipping: true,
          allowCoupon: true,
          isLaunch: true,
          isFeatured: true,
          isBestSeller: true,
          active: true,
          isDemo: true,
          createdAt: true,
          updatedAt: true,
          brand: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          images: { select: { id: true, url: true, alt: true, position: true }, orderBy: { position: "asc" }, take: 1 },
        },
      }),
      prisma.product.count({ where }),
    ]);

    return okPaginated(reply, paginate(items, total, page, perPage));
  });

  app.get("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { position: "asc" } },
        brand: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      },
    });
    if (!product) throw notFound("Produto nao encontrado.");
    return ok(reply, product);
  });

  app.post("/", async (request, reply) => {
    const input = parse(createProductSchema, request.body);

    // SKU opcional: quando não informado, o backend gera um código único.
    const sku = input.sku?.trim() || catalog.generateSku(input.name);
    const skuExists = await prisma.product.findUnique({ where: { sku }, select: { id: true } });
    if (skuExists) throw conflict("Ja existe um produto com este SKU.");

    const slug = await catalog.uniqueSlug(input.name, "product");

    const product = await prisma.product.create({
      data: {
        name: input.name,
        slug,
        sku,
        shortDescription: input.shortDescription || null,
        description: input.description || null,
        brandId: input.brandId || null,
        categoryId: input.categoryId || null,
        price: input.price,
        comparePrice: input.comparePrice ?? null,
        costPrice: input.costPrice ?? null,
        volume: input.volume || null,
        weightGrams: input.weightGrams ?? null,
        stock: input.stock,
        minStock: input.minStock,
        hasShipping: input.hasShipping,
        allowCoupon: input.allowCoupon,
        isLaunch: input.isLaunch,
        isFeatured: input.isFeatured,
        isBestSeller: input.isBestSeller,
        active: input.active,
        metaTitle: input.metaTitle || null,
        metaDescription: input.metaDescription || null,
        images: {
          create: input.images.map((image, index) => ({
            url: image.url,
            alt: image.alt ?? input.name,
            position: image.position ?? index,
            focalPoint: image.focalPoint ?? "center",
          })),
        },
      },
      include: { images: true },
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "CREATE",
      entity: "Product",
      entityId: product.id,
      after: { name: product.name, sku: product.sku, price: product.price, stock: product.stock },
      ip: request.ip,
      requestId: request.id,
    });

    return created(reply, product);
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(updateProductSchema, request.body);

    const current = await prisma.product.findUnique({ where: { id }, include: { images: true } });
    if (!current) throw notFound("Produto nao encontrado.");

    if (input.sku && input.sku !== current.sku) {
      const skuExists = await prisma.product.findUnique({ where: { sku: input.sku }, select: { id: true } });
      if (skuExists) throw conflict("Ja existe um produto com este SKU.");
    }

    const slug =
      input.name && input.name !== current.name
        ? await catalog.uniqueSlug(input.name, "product", id)
        : current.slug;

    const { images, ...fields } = input;

    const updated = await prisma.$transaction(async (tx) => {
      if (images) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        if (images.length > 0) {
          await tx.productImage.createMany({
            data: images.map((image, index) => ({
              productId: id,
              url: image.url,
              alt: image.alt ?? input.name ?? current.name,
              position: image.position ?? index,
              focalPoint: image.focalPoint ?? "center",
            })),
          });
        }
      }

      return tx.product.update({
        where: { id },
        data: {
          ...(fields.name ? { name: fields.name, slug } : {}),
          ...(fields.sku ? { sku: fields.sku } : {}),
          ...(fields.shortDescription !== undefined ? { shortDescription: fields.shortDescription || null } : {}),
          ...(fields.description !== undefined ? { description: fields.description || null } : {}),
          ...(fields.brandId !== undefined ? { brandId: fields.brandId || null } : {}),
          ...(fields.categoryId !== undefined ? { categoryId: fields.categoryId || null } : {}),
          ...(fields.price ? { price: fields.price } : {}),
          ...(fields.comparePrice !== undefined ? { comparePrice: fields.comparePrice ?? null } : {}),
          ...(fields.costPrice !== undefined ? { costPrice: fields.costPrice ?? null } : {}),
          ...(fields.volume !== undefined ? { volume: fields.volume || null } : {}),
          ...(fields.weightGrams !== undefined ? { weightGrams: fields.weightGrams ?? null } : {}),
          ...(fields.stock !== undefined ? { stock: fields.stock } : {}),
          ...(fields.minStock !== undefined ? { minStock: fields.minStock } : {}),
          ...(fields.hasShipping !== undefined ? { hasShipping: fields.hasShipping } : {}),
          ...(fields.allowCoupon !== undefined ? { allowCoupon: fields.allowCoupon } : {}),
          ...(fields.isLaunch !== undefined ? { isLaunch: fields.isLaunch } : {}),
          ...(fields.isFeatured !== undefined ? { isFeatured: fields.isFeatured } : {}),
          ...(fields.isBestSeller !== undefined ? { isBestSeller: fields.isBestSeller } : {}),
          ...(fields.active !== undefined ? { active: fields.active } : {}),
          ...(fields.metaTitle !== undefined ? { metaTitle: fields.metaTitle || null } : {}),
          ...(fields.metaDescription !== undefined ? { metaDescription: fields.metaDescription || null } : {}),
        },
        include: { images: { orderBy: { position: "asc" } } },
      });
    });

    // Remove do disco os arquivos que deixaram de ser referenciados (best-effort,
    // executado DEPOIS do commit do banco para nunca deixar o produto sem imagem).
    if (images) {
      const kept = new Set(images.map((image) => image.url));
      await Promise.all(
        current.images.filter((image) => !kept.has(image.url)).map((image) => deleteLocalUpload(image.url)),
      );
    }

    const diff = diffFields(
      {
        name: current.name,
        sku: current.sku,
        price: String(current.price),
        stock: current.stock,
        active: current.active,
        categoryId: current.categoryId,
        brandId: current.brandId,
      },
      {
        ...(input.name ? { name: input.name } : {}),
        ...(input.sku ? { sku: input.sku } : {}),
        ...(input.price ? { price: input.price } : {}),
        ...(input.stock !== undefined ? { stock: input.stock } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId ?? null } : {}),
        ...(input.brandId !== undefined ? { brandId: input.brandId ?? null } : {}),
      },
    );

    await writeAudit({
      adminId: request.authUser!.id,
      action: "UPDATE",
      entity: "Product",
      entityId: id,
      before: diff.before,
      after: diff.after,
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  app.patch("/:id/stock", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(updateStockSchema, request.body);

    const current = await prisma.product.findUnique({
      where: { id },
      select: { id: true, name: true, stock: true, minStock: true, reservedStock: true, soldStock: true },
    });
    if (!current) throw notFound("Produto nao encontrado.");

    if (input.stock < current.reservedStock) {
      throw badRequest(
        `Nao e possivel definir estoque menor que o reservado (${current.reservedStock} unidade(s) em pedidos aguardando pagamento).`,
      );
    }

    const updated = await prisma.product.update({
      where: { id },
      data: { stock: input.stock, ...(input.minStock !== undefined ? { minStock: input.minStock } : {}) },
      select: { id: true, name: true, stock: true, minStock: true, reservedStock: true, soldStock: true },
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "UPDATE_STOCK",
      entity: "Product",
      entityId: id,
      before: { stock: current.stock, minStock: current.minStock },
      after: { stock: input.stock, minStock: input.minStock ?? current.minStock, reason: input.reason ?? null },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  app.post("/:id/duplicate", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const source = await prisma.product.findUnique({ where: { id }, include: { images: true } });
    if (!source) throw notFound("Produto nao encontrado.");

    const name = `${source.name} (copia)`;
    const slug = await catalog.uniqueSlug(name, "product");
    const sku = `${source.sku}-COPY-${Date.now().toString().slice(-5)}`;

    const copy = await prisma.product.create({
      data: {
        name,
        slug,
        sku,
        shortDescription: source.shortDescription,
        description: source.description,
        brandId: source.brandId,
        categoryId: source.categoryId,
        price: source.price,
        comparePrice: source.comparePrice,
        costPrice: source.costPrice,
        volume: source.volume,
        weightGrams: source.weightGrams,
        stock: 0,
        minStock: source.minStock,
        hasShipping: source.hasShipping,
        allowCoupon: source.allowCoupon,
        isLaunch: source.isLaunch,
        isFeatured: false,
        isBestSeller: false,
        active: false,
        metaTitle: source.metaTitle,
        metaDescription: source.metaDescription,
        images: {
          create: source.images.map((image) => ({
            url: image.url,
            alt: image.alt,
            position: image.position,
            focalPoint: image.focalPoint,
          })),
        },
      },
      include: { images: true },
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "DUPLICATE",
      entity: "Product",
      entityId: copy.id,
      before: { sourceId: source.id, sourceName: source.name },
      after: { name: copy.name, sku: copy.sku },
      ip: request.ip,
      requestId: request.id,
    });

    return created(reply, copy);
  });

  /**
   * Desativa (soft delete) por padrao - o historico de pedidos continua valido.
   * Use ?hard=true para excluir de verdade (bloqueado se houver pedidos).
   */
  app.delete("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const hard = (request.query as { hard?: string })?.hard === "true";

    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        active: true,
        images: { select: { url: true } },
        _count: { select: { orderItems: true, cartItems: true } },
      },
    });
    if (!product) throw notFound("Produto nao encontrado.");

    if (hard) {
      if (product._count.orderItems > 0) {
        throw badRequest(
          "Este produto ja foi vendido e nao pode ser excluido. Desative-o para retira-lo da loja.",
        );
      }
      await prisma.$transaction([
        prisma.cartItem.deleteMany({ where: { productId: id } }),
        prisma.favorite.deleteMany({ where: { productId: id } }),
        prisma.product.delete({ where: { id } }),
      ]);

      // Limpa os arquivos do produto excluído (best-effort, após o commit).
      await Promise.all(product.images.map((image) => deleteLocalUpload(image.url)));

      await writeAudit({
        adminId: request.authUser!.id,
        action: "DELETE",
        entity: "Product",
        entityId: id,
        before: { name: product.name },
        ip: request.ip,
        requestId: request.id,
      });

      return ok(reply, { deleted: true, hard: true });
    }

    await prisma.product.update({ where: { id }, data: { active: false } });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "DEACTIVATE",
      entity: "Product",
      entityId: id,
      before: { active: product.active },
      after: { active: false },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, { deleted: true, hard: false, active: false });
  });
}
