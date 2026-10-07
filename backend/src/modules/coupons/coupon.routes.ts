import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { ok, parse } from "../../lib/http.js";
import { decimalToNumber } from "../../lib/serialize.js";
import * as cartService from "../cart/cart.service.js";
import { validateCoupon } from "./coupon.service.js";

const validateSchema = z.object({
  code: z.string().trim().min(1, "Informe o codigo do cupom.").max(40),
  shippingCost: z.coerce.number().min(0).optional().default(0),
});

/** Validacao de cupom contra o carrinho atual do cliente. */
export async function couponRoutes(app: FastifyInstance): Promise<void> {
  app.post("/validate", { preHandler: app.authenticate }, async (request, reply) => {
    const input = parse(validateSchema, request.body);
    const cart = await cartService.getCart(request.authUser!.id);

    const result = await validateCoupon({
      code: input.code,
      userId: request.authUser!.id,
      subtotal: cart.summary.subtotal,
      shippingCost: input.shippingCost,
      items: cart.items.map((item) => ({
        productId: item.product.id,
        categoryId: item.product.category?.id ?? null,
        allowCoupon: item.product.allowCoupon,
        quantity: item.quantity,
        unitPrice: decimalToNumber(item.product.price),
      })),
    });

    const total = Math.max(
      0,
      Number((cart.summary.subtotal - result.discount).toFixed(2)),
    );

    return ok(reply, {
      valid: true,
      code: result.code,
      type: result.type,
      value: result.value,
      discount: result.discount,
      shippingDiscount: result.shippingDiscount,
      appliesToShipping: result.appliesToShipping,
      subtotal: cart.summary.subtotal,
      total,
    });
  });
}

/** Lista cupons disponiveis para o cliente (sem revelar regras internas). */
export async function publicCouponRoutes(app: FastifyInstance): Promise<void> {
  app.get("/available", async (_request, reply) => {
    const now = new Date();
    const coupons = await prisma.coupon.findMany({
      where: {
        active: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      select: { code: true, description: true, type: true, value: true, minOrderValue: true, endsAt: true },
      take: 20,
      orderBy: { createdAt: "desc" },
    });

    return ok(
      reply,
      coupons.map((c) => ({
        code: c.code,
        description: c.description,
        type: c.type,
        value: decimalToNumber(c.value),
        minOrderValue: c.minOrderValue ? decimalToNumber(c.minOrderValue) : null,
        endsAt: c.endsAt,
      })),
    );
  });
}
