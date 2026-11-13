import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { writeAudit } from "../../lib/audit.js";
import { ok, parse } from "../../lib/http.js";
import { interestRuleSchema } from "../catalog/catalog.schemas.js";
import { centsToAmount, computeInterest, normalizePayer, normalizeType, ruleFromRow } from "../../services/interest.js";

const DEFAULT_ID = "default";

/**
 * Configuração PADRÃO de juros (aplicada a produtos sem regra individual) e
 * simulação de parcelas para o painel. Apenas ADMIN (hook global do admin).
 */
export async function interestAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    const row = await prisma.interestRule.findUnique({ where: { id: DEFAULT_ID } });
    if (!row) {
      return ok(reply, {
        id: DEFAULT_ID,
        enabled: false,
        type: "PERCENT_MONTHLY",
        rate: 0,
        payer: "CUSTOMER",
        maxInstallments: 1,
        minInstallmentValue: null,
      });
    }
    const rule = ruleFromRow(row);
    return ok(reply, { id: DEFAULT_ID, ...rule });
  });

  app.put("/", async (request, reply) => {
    const input = parse(interestRuleSchema, request.body);
    const data = {
      enabled: input.enabled,
      type: input.type,
      rate: new Prisma.Decimal(input.rate),
      payer: input.payer,
      maxInstallments: input.maxInstallments,
      minInstallmentValue: input.minInstallmentValue === null ? null : new Prisma.Decimal(input.minInstallmentValue),
    };

    const row = await prisma.interestRule.upsert({
      where: { id: DEFAULT_ID },
      create: { id: DEFAULT_ID, ...data },
      update: data,
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "UPSERT",
      entity: "InterestRule",
      entityId: DEFAULT_ID,
      after: {
        enabled: row.enabled,
        type: row.type,
        rate: String(row.rate),
        payer: row.payer,
        maxInstallments: row.maxInstallments,
        minInstallmentValue: row.minInstallmentValue === null ? null : String(row.minInstallmentValue),
      },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, { id: DEFAULT_ID, ...ruleFromRow(row) });
  });

  /** Simulação exata (mesma função do pedido) para a prévia do painel. */
  app.post("/simulate", async (request, reply) => {
    const input = parse(
      z.object({
        principal: z.coerce.number().min(0).max(10_000_000),
        installments: z.coerce.number().int().min(1).max(24).default(1),
        method: z.enum(["PIX", "CREDIT_CARD", "BOLETO", "COMBINAR"]).default("CREDIT_CARD"),
        rule: interestRuleSchema.optional(),
      }),
      request.body,
    );

    const rule = input.rule
      ? {
          enabled: input.rule.enabled,
          type: normalizeType(input.rule.type),
          rate: input.rule.rate,
          payer: normalizePayer(input.rule.payer),
          maxInstallments: input.rule.maxInstallments,
          minInstallmentValue: input.rule.minInstallmentValue,
        }
      : { enabled: false, type: "PERCENT_MONTHLY" as const, rate: 0, payer: "CUSTOMER" as const, maxInstallments: 1, minInstallmentValue: null };

    const plan = computeInterest({
      principalCents: Math.round(input.principal * 100),
      installments: input.installments,
      method: input.method,
      rule,
    });

    return ok(reply, {
      applied: plan.applied,
      reason: plan.reason,
      type: plan.type,
      rate: plan.rate,
      payer: plan.payer,
      installments: plan.installments,
      principal: centsToAmount(plan.principalCents),
      interest: centsToAmount(plan.interestCents),
      total: centsToAmount(plan.customerCents),
      installmentValue: centsToAmount(plan.installmentCents),
      merchantAbsorbed: centsToAmount(plan.merchantAbsorbedCents),
    });
  });
}
