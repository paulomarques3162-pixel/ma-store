import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/tokens.js";

function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

async function loadUser(request: FastifyRequest, token: string) {
  // Token malformado/expirado vira 401 (nunca 500).
  let payload: ReturnType<typeof verifyAccessToken>;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw unauthorized("Sessao expirada ou invalida. Entre novamente.");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      role: true,
      email: true,
      name: true,
      status: true,
      mustChangePassword: true,
    },
  });

  if (!user) throw unauthorized("Sessao invalida. Entre novamente.");
  if (user.status === "BLOCKED") throw forbidden("Sua conta esta bloqueada. Fale com o atendimento.");

  request.authUser = {
    id: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
  };

  return user;
}

/**
 * Hooks de autenticacao/autorizacao.
 *
 * Toda validacao acontece no backend (nunca confiamos no frontend), e as rotas
 * administrativas exigem role ADMIN.
 */
export async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest("authUser", undefined);

  /** Exige token valido. */
  app.decorate("authenticate", async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
    const token = extractBearer(request);
    if (!token) throw unauthorized();
    await loadUser(request, token);
  });

  /** Tenta autenticar, mas nao falha quando nao ha token (rotas mistas). */
  app.decorate("optionalAuth", async function optionalAuth(request: FastifyRequest, _reply: FastifyReply) {
    const token = extractBearer(request);
    if (!token) return;
    try {
      await loadUser(request, token);
    } catch {
      // Rota mista: sem sessao valida, segue como visitante.
      request.authUser = undefined;
    }
  });

  /** Exige token valido + role ADMIN. */
  app.decorate("requireAdmin", async function requireAdmin(request: FastifyRequest, _reply: FastifyReply) {
    const token = extractBearer(request);
    if (!token) throw unauthorized();

    const user = await loadUser(request, token);
    if (user.role !== "ADMIN") {
      throw forbidden("Area restrita a administradores.");
    }
  });
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
