import { prisma } from "../db.js";
import { conflict, deliveryError, validationError } from "../lib/errors.js";
import { hashPassword, validatePasswordStrength } from "../lib/password.js";

/**
 * Gerenciamento de entregadores (ADMIN).
 *
 * Entregadores sao usuarios com role DELIVERY_PERSON. Criamos/ativamos de forma
 * explicita; NUNCA apagamos fisicamente quem possui historico de entregas —
 * apenas desativamos (`status = BLOCKED` ou `active = false` via status).
 */

export type DriverInput = {
  name: string;
  email: string;
  phone?: string | null;
  password?: string;
  status?: "ACTIVE" | "BLOCKED" | "PENDING";
};

export async function listDrivers() {
  const drivers = await prisma.user.findMany({
    where: { role: "DELIVERY_PERSON" },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      mustChangePassword: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { deliveries: true } },
    },
  });
  return drivers.map((driver) => ({
    id: driver.id,
    name: driver.name,
    email: driver.email,
    phone: driver.phone,
    status: driver.status,
    mustChangePassword: driver.mustChangePassword,
    lastLoginAt: driver.lastLoginAt?.toISOString() ?? null,
    createdAt: driver.createdAt.toISOString(),
    deliveriesCount: driver._count.deliveries,
  }));
}

export async function createDriver(input: DriverInput) {
  const email = input.email.trim().toLowerCase();
  const password = input.password ?? "";
  const strength = validatePasswordStrength(password);
  if (!strength.ok) throw validationError(strength.message ?? "Senha invalida.");

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw conflict("Ja existe um usuario com este e-mail.");

  const driver = await prisma.user.create({
    data: {
      name: input.name.trim(),
      email,
      phone: input.phone?.trim() || null,
      passwordHash: await hashPassword(password),
      role: "DELIVERY_PERSON",
      status: input.status ?? "ACTIVE",
      // Senha definida pelo admin: exigimos troca no primeiro acesso.
      mustChangePassword: true,
    },
    select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true },
  });
  return { ...driver, createdAt: driver.createdAt.toISOString(), deliveriesCount: 0, mustChangePassword: true, lastLoginAt: null };
}

async function getDriver(id: string) {
  const driver = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, status: true },
  });
  if (!driver) throw deliveryError("DRIVER_NOT_FOUND", "Entregador nao encontrado.");
  if (driver.role !== "DELIVERY_PERSON") throw deliveryError("INVALID_DRIVER", "Este usuario nao e um entregador.");
  return driver;
}

export async function updateDriver(id: string, input: Partial<DriverInput>) {
  await getDriver(id);
  const data: { name?: string; phone?: string | null; status?: "ACTIVE" | "BLOCKED" | "PENDING" } = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.phone !== undefined) data.phone = input.phone?.trim() || null;
  if (input.status !== undefined) data.status = input.status;

  return prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, phone: true, status: true },
  });
}

/** Desativa sem apagar o historico (nunca delete fisico). */
export async function deactivateDriver(id: string) {
  await getDriver(id);
  return prisma.user.update({
    where: { id },
    data: { status: "BLOCKED" },
    select: { id: true, name: true, status: true },
  });
}

export async function resetDriverPassword(id: string, newPassword: string) {
  await getDriver(id);
  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) throw validationError(strength.message ?? "Senha invalida.");

  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
    }),
    // Derruba sessoes antigas do entregador.
    prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  return { updated: true, id };
}
