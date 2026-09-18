import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ok, parse } from "../../lib/http.js";
import * as cart from "./cart.service.js";

// Limite apenas sanitario: quem decide se a quantidade e valida e a regra de
// estoque (que responde 409 INSUFFICIENT_STOCK), nao a validacao de formato.
const addSchema = z.object({
  productId: z.string().min(1, "Produto obrigatorio."),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
});

const updateSchema = z.object({
  quantity: z.coerce.number().int().min(0).max(999),
});

const itemParam = z.object({ itemId: z.string().min(1) });

/** Carrinho do usuario autenticado. Toda regra de estoque e validada aqui. */
export async function cartRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request, reply) => {
    const result = await cart.getCart(request.authUser!.id);
    return ok(reply, result);
  });

  app.post("/items", async (request, reply) => {
    const input = parse(addSchema, request.body);
    const result = await cart.addItem(request.authUser!.id, input.productId, input.quantity);
    return ok(reply, result);
  });

  app.patch("/items/:itemId", async (request, reply) => {
    const { itemId } = parse(itemParam, request.params);
    const input = parse(updateSchema, request.body);
    const result = await cart.updateItem(request.authUser!.id, itemId, input.quantity);
    return ok(reply, result);
  });

  app.delete("/items/:itemId", async (request, reply) => {
    const { itemId } = parse(itemParam, request.params);
    const result = await cart.removeItem(request.authUser!.id, itemId);
    return ok(reply, result);
  });

  app.delete("/", async (request, reply) => {
    const result = await cart.clearCart(request.authUser!.id);
    return ok(reply, result);
  });
}
