import type { Role } from "@prisma/client";

declare module "fastify" {
  interface FastifyRequest {
    /** Usuario autenticado (preenchido por authenticate/optionalAuth). */
    authUser?: {
      id: string;
      role: Role;
      email: string;
      name: string;
      sessionId?: string;
    };
  }

  interface FastifyContextConfig {
    /** Marca a rota como publica mesmo tendo hook de autenticacao global. */
    public?: boolean;
  }
}

export {};
