import type { Role, User } from "@prisma/client";
import { prisma } from "../../db.js";
import { env } from "../../env.js";
import { conflict, notFound, unauthorized, validationError } from "../../lib/errors.js";
import { randomToken, sha256, safeEqual } from "../../lib/crypto.js";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../../lib/password.js";
import { signAccessToken } from "../../lib/tokens.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export type SessionMeta = { ip?: string | null; userAgent?: string | null };

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

/** Serializa o usuario sem NENHUM campo sensivel (nunca expor passwordHash). */
export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

async function createSession(user: Pick<User, "id" | "role">, meta: SessionMeta) {
  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: sha256(refreshToken),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 250) ?? null,
      expiresAt,
    },
  });

  const accessToken = signAccessToken({ sub: user.id, role: user.role, sid: session.id });

  return { accessToken, refreshToken, expiresAt, sessionId: session.id };
}

export async function register(input: RegisterInput, meta: SessionMeta) {
  const strength = validatePasswordStrength(input.password);
  if (!strength.ok) throw validationError(strength.message ?? "Senha fraca.");

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw conflict("Ja existe uma conta com este e-mail. Tente entrar ou recuperar a senha.");
  }

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone || null,
      passwordHash: await hashPassword(input.password),
      role: "CLIENT",
      status: "ACTIVE",
    },
  });

  const tokens = await createSession(user, meta);
  return { user: toSafeUser(user), ...tokens };
}

export async function login(input: LoginInput, meta: SessionMeta) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Mensagem generica: nao revelamos se o e-mail existe.
  const invalidCredentials = unauthorized("E-mail ou senha incorretos.");

  if (!user) throw invalidCredentials;

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw unauthorized(`Conta temporariamente bloqueada por tentativas. Tente novamente em ${minutes} min.`);
  }

  const valid = await verifyPassword(input.password, user.passwordHash);

  if (!valid) {
    const failedLoginCount = user.failedLoginCount + 1;
    const shouldLock = failedLoginCount >= MAX_FAILED_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
      },
    });
    throw shouldLock
      ? unauthorized("Conta temporariamente bloqueada por tentativas. Tente novamente em 15 min.")
      : invalidCredentials;
  }

  if (user.status === "BLOCKED") {
    throw unauthorized("Sua conta esta bloqueada. Fale com o atendimento.");
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const tokens = await createSession(updated, meta);
  return { user: toSafeUser(updated), ...tokens };
}

/** Rotaciona o refresh token: revoga o antigo e emite um novo par. */
export async function refresh(refreshToken: string, meta: SessionMeta) {
  const tokenHash = sha256(refreshToken);
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: tokenHash },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw unauthorized("Sessao expirada. Entre novamente.");
  }
  if (session.user.status === "BLOCKED") {
    throw unauthorized("Sua conta esta bloqueada. Fale com o atendimento.");
  }

  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

  const tokens = await createSession(session.user, meta);
  return { user: toSafeUser(session.user), ...tokens };
}

export async function logout(userId: string | undefined, refreshToken?: string) {
  if (refreshToken) {
    await prisma.session.updateMany({
      where: { refreshTokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return;
  }
  if (userId) {
    await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("Usuario nao encontrado.");
  return toSafeUser(user);
}

export async function updateProfile(userId: string, data: { name?: string; phone?: string }) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.name ? { name: data.name } : {}),
      ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
    },
  });
  return toSafeUser(user);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("Usuario nao encontrado.");

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw validationError("A senha atual esta incorreta.");

  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) throw validationError(strength.message ?? "Senha fraca.");

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
    }),
    prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  return { message: "Senha alterada. Entre novamente com a nova senha." };
}

/**
 * Inicia a recuperacao de senha. A resposta e SEMPRE generica para nao revelar
 * se o e-mail existe. Em desenvolvimento/teste devolvemos o token para permitir
 * testar o fluxo sem servidor de e-mail configurado.
 */
export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });

  const genericMessage =
    "Se este e-mail estiver cadastrado, enviaremos as instrucoes de recuperacao.";

  if (!user) return { message: genericMessage, devToken: null as string | null };

  const token = randomToken(40);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  // Em producao, o token sai por e-mail (SMTP). Nunca na resposta HTTP.
  return {
    message: genericMessage,
    devToken: env.isProduction ? null : token,
  };
}

export async function resetPassword(token: string, password: string) {
  const tokenHash = sha256(token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw validationError("Token invalido ou expirado. Solicite um novo link.");
  }

  const strength = validatePasswordStrength(password);
  if (!strength.ok) throw validationError(strength.message ?? "Senha fraca.");

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  return { message: "Senha redefinida com sucesso. Entre com a nova senha." };
}

export { safeEqual };
