import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ok, parse } from "../../lib/http.js";
import * as cartService from "../cart/cart.service.js";
import * as shipping from "./shipping.service.js";

const cepSchema = z.object({ cep: z.string().trim().min(8, "CEP obrigatorio.") });

const quoteSchema = z.object({
  cep: z.string().trim().min(8, "Informe o CEP para calcular o frete."),
});

/** Frete: modalidades configuradas e calculo real por CEP. */
export async function shippingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/methods", async (_request, reply) => {
    const methods = await shipping.listShippingMethods();
    return ok(reply, methods);
  });

  app.get("/ufs", async (_request, reply) => ok(reply, shipping.UFS));

  /** Consulta CEP -> UF (nao inventa endereco: apenas a faixa/UF). */
  app.post("/cep", async (request, reply) => {
    const input = parse(cepSchema, request.body);
    const cep = shipping.normalizeCep(input.cep);
    return ok(reply, { cep, uf: shipping.cepToUf(cep) });
  });

  /** Cotacao baseada no carrinho real do cliente autenticado. */
  app.post("/quote", { preHandler: app.authenticate }, async (request, reply) => {
    const input = parse(quoteSchema, request.body);
    const cart = await cartService.getCart(request.authUser!.id);

    const hasShippableItems = cart.items.some((item) => item.product.hasShipping && item.quantity > 0);

    const result = await shipping.quote({
      cep: input.cep,
      subtotal: cart.summary.subtotal,
      hasShippableItems,
    });

    return ok(reply, {
      cep: shipping.normalizeCep(input.cep),
      region: result.region,
      required: result.required,
      subtotal: cart.summary.subtotal,
      options: result.options,
    });
  });

  /** Calcula o frete para um metodo especifico (usado no checkout). */
  app.post("/select", { preHandler: app.authenticate }, async (request, reply) => {
    const input = parse(
      z.object({ cep: z.string().trim().min(8), methodId: z.string().min(1) }),
      request.body,
    );
    const cart = await cartService.getCart(request.authUser!.id);
    const hasShippableItems = cart.items.some((item) => item.product.hasShipping && item.quantity > 0);

    const result = await shipping.quote({
      cep: input.cep,
      subtotal: cart.summary.subtotal,
      hasShippableItems,
    });

    const option = result.options.find((o) => o.id === input.methodId);
    if (!option) {
      const { notFound } = await import("../../lib/errors.js");
      throw notFound("Modalidade de frete indisponivel para este CEP.");
    }

    return ok(reply, { ...option, subtotal: cart.summary.subtotal, shippingCost: option.price });
  });
}
