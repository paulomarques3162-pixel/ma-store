import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ok, parse } from "../../lib/http.js";
import { shippingQuoteSchema } from "../../lib/validation.js";
import { handleLocalEngineStatus, handleLocalQuote } from "../../shipping-local/http/handlers.js";
import { quoteShipping } from "../../services/shipping/index.js";
import * as cartService from "../cart/cart.service.js";
import * as shipping from "./shipping.service.js";

const cepSchema = z.object({ cep: z.string().trim().min(8, "CEP obrigatorio.") });

const quoteSchema = z.object({
  cep: z.string().trim().min(8, "Informe o CEP para calcular o frete."),
});

/** Frete: modalidades configuradas e calculo real por CEP. */
export async function shippingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Motor de frete do Guest Checkout (PUBLICO).
   * Entrada: { cep, items: [{ id, nome, quantidade, peso_unitario }] }.
   * Saida no padrao unico: { success, options, warnings, pesoTotal }.
   */
  app.post("/", async (request, reply) => {
    const input = parse(shippingQuoteSchema, request.body);
    const result = await quoteShipping({
      cep: input.cep,
      items: input.items.map((item) => ({
        id: item.id,
        nome: item.nome ?? "",
        quantidade: item.quantidade,
        peso_unitario: item.peso_unitario ?? 0,
      })),
    });

    // Loga avisos de integracoes externas (ex.: Correios indisponivel) sem
    // nunca registrar tokens, headers ou dados sensiveis.
    if (result.warnings.length > 0) {
      request.log.warn({ cep: result.cep, warnings: result.warnings }, "Frete com avisos de integracao");
    }

    return reply.status(200).send({
      success: result.success,
      cep: result.cep,
      pesoTotal: result.pesoTotal,
      options: result.options,
      warnings: result.warnings,
      retryable: result.retryable,
    });
  });

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

  /**
   * Cotacao de frete.
   *
   * Dois contratos coexistem NO MESMO caminho `/api/shipping/quote`:
   *  - Shipping Engine PROPRIO (novo, publico): body com `destinationZipCode`
   *    + `items[{productId, quantity}]`; o backend busca peso/regra no banco;
   *  - legado (carrinho do usuario autenticado): body com `cep`.
   * O contrato e distinguido pela presenca de `destinationZipCode`.
   */
  app.post("/quote", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    // Contrato do motor proprio: itens informados (cep/destinationZipCode + items).
    if (body && typeof body === "object" && Array.isArray(body.items)) {
      return handleLocalQuote(request, reply);
    }

    // ---- Contrato legado (carrinho do usuario autenticado) -----------------
    await app.authenticate(request, reply);
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

  /** Status do motor proprio (publico, sem segredos) para o checkout decidir. */
  app.get("/engine/status", handleLocalEngineStatus);

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
