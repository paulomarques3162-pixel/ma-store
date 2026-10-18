import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { ok, parse } from "../../lib/http.js";
import { decimalToNumber } from "../../lib/serialize.js";
import { centsToAmount, computeCartInterest, loadInterestRules } from "../../services/interest.js";

/**
 * Cotação PÚBLICA de juros/encargos.
 *
 * O preço unitário vem SEMPRE do banco (nunca do corpo da requisição) e o
 * cálculo é feito com a mesma função usada na criação do pedido. Serve para o
 * produto e o checkout exibirem, de forma transparente, o total e as parcelas
 * que o backend realmente cobrará.
 */
const quoteSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().min(1).max(999),
      }),
    )
    .min(1)
    .max(100),
  method: z.enum(["PIX", "CREDIT_CARD", "BOLETO", "COMBINAR"]).default("COMBINAR"),
  installments: z.coerce.number().int().min(1).max(24).default(1),
});

export async function interestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/quote", async (request, reply) => {
    const input = parse(quoteSchema, request.body);
    const ids = [...new Set(input.items.map((item) => item.productId))];

    const products = await prisma.product.findMany({
      where: { id: { in: ids }, active: true },
      select: { id: true, price: true },
    });
    const priceById = new Map(products.map((product) => [product.id, decimalToNumber(product.price)]));
    const priced = input.items.filter((item) => priceById.has(item.productId));

    if (priced.length === 0) {
      reply.header("Cache-Control", "no-store");
      return ok(reply, { applied: false, installments: 1, subtotal: 0, interest: 0, total: 0, merchantAbsorbed: 0, lines: [] });
    }

    const rules = await loadInterestRules(priced.map((item) => item.productId));
    const result = computeCartInterest({
      items: priced.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: priceById.get(item.productId)!,
      })),
      installments: input.installments,
      method: input.method,
      rules,
    });

    reply.header("Cache-Control", "no-store");
    return ok(reply, {
      applied: result.applied,
      installments: result.installments,
      subtotal: centsToAmount(result.subtotalCents),
      interest: centsToAmount(result.interestCents),
      total: centsToAmount(result.totalCents),
      merchantAbsorbed: centsToAmount(result.merchantAbsorbedCents),
      lines: result.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        subtotal: centsToAmount(line.principalCents),
        interest: centsToAmount(line.plan.customerCents - line.plan.principalCents),
        total: centsToAmount(line.plan.customerCents),
        applied: line.plan.applied,
        reason: line.plan.reason,
        type: line.plan.type,
        rate: line.plan.rate,
        payer: line.plan.payer,
        installments: line.plan.installments,
        installmentValue: centsToAmount(line.plan.installmentCents),
      })),
    });
  });
}
