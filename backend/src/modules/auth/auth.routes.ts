import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "../../env.js";
import { created, ok, parse } from "../../lib/http.js";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from "./auth.schemas.js";
import * as authService from "./auth.service.js";

function meta(request: FastifyRequest) {
  return {
    ip: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Rate limit mais rígido nas rotas sensiveis (anti brute-force).
  // Configuravel por ambiente para permitir suites de teste intensivas.
  const strict = {
    rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: env.AUTH_RATE_LIMIT_WINDOW },
  };

  app.post("/register", { config: strict }, async (request, reply) => {
    const input = parse(registerSchema, request.body);
    const result = await authService.register(input, meta(request));
    return created(reply, result);
  });

  app.post("/login", { config: strict }, async (request, reply) => {
    const input = parse(loginSchema, request.body);
    const result = await authService.login(input, meta(request));
    return ok(reply, result);
  });

  app.post("/refresh", { config: strict }, async (request, reply) => {
    const input = parse(refreshSchema, request.body);
    const result = await authService.refresh(input.refreshToken, meta(request));
    return ok(reply, result);
  });

  app.post("/logout", async (request, reply) => {
    const input = parse(logoutSchema, request.body ?? {});
    await authService.logout(request.authUser?.id, input.refreshToken);
    return ok(reply, { message: "Sessao encerrada." });
  });

  app.get("/me", { preHandler: app.authenticate }, async (request, reply) => {
    const user = await authService.me(request.authUser!.id);
    return ok(reply, user);
  });

  app.patch("/me", { preHandler: app.authenticate }, async (request, reply) => {
    const input = parse(updateProfileSchema, request.body);
    const user = await authService.updateProfile(request.authUser!.id, input);
    return ok(reply, user);
  });

  app.post("/change-password", { preHandler: app.authenticate, config: strict }, async (request, reply) => {
    const input = parse(changePasswordSchema, request.body);
    const result = await authService.changePassword(
      request.authUser!.id,
      input.currentPassword,
      input.newPassword,
    );
    return ok(reply, result);
  });

  app.post("/forgot-password", { config: strict }, async (request, reply) => {
    const input = parse(forgotPasswordSchema, request.body);
    const result = await authService.forgotPassword(input.email);
    return ok(reply, result);
  });

  app.post("/reset-password", { config: strict }, async (request, reply) => {
    const input = parse(resetPasswordSchema, request.body);
    const result = await authService.resetPassword(input.token, input.password);
    return ok(reply, result);
  });

  /** Sessoes ativas do usuario (sem expor tokens). */
  app.get("/sessions", { preHandler: app.authenticate }, async (request, reply) => {
    const { prisma } = await import("../../db.js");
    const sessions = await prisma.session.findMany({
      where: { userId: request.authUser!.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true, expiresAt: true },
      orderBy: { lastUsedAt: "desc" },
    });
    return ok(reply, sessions);
  });
}
