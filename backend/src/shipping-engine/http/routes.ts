import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { isShippingError } from "../domain/errors.js";
import type { ShippingQuoteService } from "../application/quote.service.js";
import { buildOpenApiDocument } from "./openapi.js";
import { providerParamSchema, shippingQuoteRequestSchema } from "./schemas.js";

export type ShippingEngineHttpOptions = {
  service: ShippingQuoteService;
  version?: string;
};

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (isShippingError(error)) {
    return reply.status(error.httpStatus).send({
      success: false,
      error: { code: error.code, message: error.message },
    });
  }
  if (error instanceof ZodError) {
    return reply.status(400).send({
      success: false,
      error: { code: "INVALID_REQUEST", message: "Requisição inválida.", details: error.issues },
    });
  }
  return reply.status(500).send({
    success: false,
    error: { code: "SERVICE_UNAVAILABLE", message: "Não foi possível calcular o frete agora." },
  });
}

/**
 * Rotas HTTP do motor. Montadas em `/api/v1/shipping` SEM substituir as rotas
 * legadas `/api/shipping` (coexistência durante a migração).
 */
export async function registerShippingEngineRoutes(
  app: FastifyInstance,
  options: ShippingEngineHttpOptions,
): Promise<void> {
  const { service } = options;

  app.post("/quotes", async (request, reply) => {
    try {
      const body = shippingQuoteRequestSchema.parse(request.body);
      const result = await service.quote(body);
      return reply.send({
        success: result.success,
        data: {
          quotes: result.quotes,
          warnings: result.warnings,
          errors: result.errors,
          meta: result.meta,
        },
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/validate", async (request, reply) => {
    try {
      const body = shippingQuoteRequestSchema.parse(request.body);
      const normalized = service.validate(body);
      return reply.send({ success: true, data: normalized });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/providers", async (_request, reply) => {
    try {
      return reply.send({ success: true, data: { providers: await service.listProviders() } });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/services", async (_request, reply) => {
    try {
      return reply.send({ success: true, data: { services: await service.listServices() } });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/health", async (_request, reply) => {
    try {
      const health = await service.health();
      return reply.send(health);
    } catch {
      return reply.status(503).send({ status: "degraded", providers: {} });
    }
  });

  app.get("/providers/:provider/health", async (request, reply) => {
    try {
      const { provider } = providerParamSchema.parse(request.params);
      return reply.send(await service.providerHealth(provider));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/providers/:provider/test", async (request, reply) => {
    try {
      const { provider } = providerParamSchema.parse(request.params);
      return reply.send({ success: true, data: await service.providerTest(provider) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/openapi.json", async (_request, reply) => {
    return reply.send(buildOpenApiDocument(options.version ?? "1.0.0"));
  });
}
