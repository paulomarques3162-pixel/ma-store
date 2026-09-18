import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";
import { serialize } from "./serialize.js";

type AuditInput = {
  adminId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  requestId?: string | null;
};

/**
 * Auditoria administrativa.
 *
 * Toda alteracao feita pelo admin grava quem fez, o que mudou (antes/depois),
 * IP e requestId. Isso permite descobrir alteracoes indevidas depois.
 * Falha na auditoria NAO derruba a operacao principal, mas e logada.
 */
export async function writeAudit(
  input: AuditInput,
  client: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<void> {
  try {
    await client.adminAuditLog.create({
      data: {
        adminId: input.adminId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        before: input.before === undefined ? undefined : (serialize(input.before) as Prisma.InputJsonValue),
        after: input.after === undefined ? undefined : (serialize(input.after) as Prisma.InputJsonValue),
        ip: input.ip ?? null,
        requestId: input.requestId ?? null,
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[audit] falha ao registrar auditoria:", error);
  }
}

/** Diff superficial campo-a-campo para registrar apenas o que mudou. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};

  for (const key of Object.keys(after) as Array<keyof T>) {
    const oldValue = before[key];
    const newValue = after[key];
    if (String(oldValue ?? "") !== String(newValue ?? "")) {
      changedBefore[key] = oldValue;
      changedAfter[key] = newValue;
    }
  }

  return { before: changedBefore, after: changedAfter };
}
