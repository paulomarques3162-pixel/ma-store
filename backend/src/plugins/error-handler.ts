import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { env } from "../env.js";

/** Resposta de erro padrao: o cliente nunca ve stack trace nem detalhe interno. */
type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
};

function zodDetails(error: ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(raiz)",
    message: issue.message,
  }));
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Recurso nao encontrado.",
        requestId: request.id,
      },
    } satisfies ErrorBody);
  });

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // 1. Erro de negocio previsto
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, requestId: request.id }, error.technical ?? error.message);
      } else {
        request.log.warn({ requestId: request.id, code: error.code }, error.message);
      }
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      } satisfies ErrorBody);
    }

    // 2. Erro de validacao do Zod vindo de qualquer rota
    if (error instanceof ZodError) {
      request.log.warn({ requestId: request.id, issues: error.issues.length }, "validacao falhou");
      return reply.status(422).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Dados invalidos. Verifique os campos e tente novamente.",
          details: zodDetails(error),
          requestId: request.id,
        },
      } satisfies ErrorBody);
    }

    // 3. Rate limit do Fastify
    if ((error as FastifyError & { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Muitas tentativas. Aguarde alguns instantes e tente novamente.",
          requestId: request.id,
        },
      } satisfies ErrorBody);
    }

    // 4. Erros conhecidos do Prisma mapeados para mensagens amigaveis
    const prismaCode = (error as { code?: string }).code;
    if (prismaCode === "P2002") {
      return reply.status(409).send({
        error: {
          code: "CONFLICT",
          message: "Este registro ja existe.",
          requestId: request.id,
        },
      } satisfies ErrorBody);
    }
    if (prismaCode === "P2025") {
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Registro nao encontrado.",
          requestId: request.id,
        },
      } satisfies ErrorBody);
    }

    // 5. Erro inesperado: loga o tecnico, devolve mensagem generica + requestId
    const status = (error as FastifyError).statusCode ?? 500;
    request.log.error(
      {
        requestId: request.id,
        err: { message: error.message, stack: error.stack },
        url: request.url,
        method: request.method,
      },
      "erro nao tratado",
    );

    return reply.status(status >= 400 && status < 600 ? status : 500).send({
      error: {
        code: "INTERNAL_ERROR",
        message:
          env.isProduction || status >= 500
            ? "Nao foi possivel concluir a operacao. Tente novamente."
            : error.message,
        requestId: request.id,
      },
    } satisfies ErrorBody);
  });
}
