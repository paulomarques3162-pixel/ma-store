import type { FastifyReply } from "fastify";
import type { ZodTypeAny, z } from "zod";
import type { Paginated } from "./serialize.js";
import { serialize } from "./serialize.js";

/**
 * Helpers de resposta.
 *
 * Envelope unico: sucesso -> `{ data, meta? }`; erro -> tratado globalmente.
 * Todo payload passa por `serialize` para virar JSON puro (Decimal -> number).
 */
export function ok<T>(reply: FastifyReply, data: T, status = 200) {
  return reply.status(status).send({ data: serialize(data) });
}

export function created<T>(reply: FastifyReply, data: T) {
  return ok(reply, data, 201);
}

export function okPaginated<T>(reply: FastifyReply, paginated: Paginated<T>) {
  return reply.status(200).send({
    data: serialize(paginated.data),
    meta: paginated.meta,
  });
}

export function noContent(reply: FastifyReply) {
  return reply.status(204).send();
}

/** Valida o body/query/params com Zod. Erros viram VALIDATION_ERROR (422). */
export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(value);
}
