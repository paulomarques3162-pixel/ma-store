import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notFound } from "../../lib/errors.js";
import { ok, parse } from "../../lib/http.js";
import { adminUpdatePedidoSchema } from "../../lib/validation.js";
import { ADMIN_ORDER_STATUSES } from "../../lib/order-status.js";
import * as orders from "../../services/orders.js";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.string().trim().max(100).optional(),
  search: z.string().trim().max(120).optional(),
});

// O `Pedido` (Guest Checkout) usa id inteiro autoincremental. Aceitamos o
// parametro como string e validamos o formato aqui para responder 404 (e nao
// 422 "Dados invalidos") quando a URL trouxer um id de OUTRO modelo, como o
// cuid textual do modelo `Order` — foi exatamente o que a tela de pagamentos
// fazia antes da correcao de navegacao.
const idParam = z.object({ id: z.string().trim().min(1) });

function parsePedidoId(raw: string): number {
  if (!/^\d+$/.test(raw)) throw notFound("Pedido não encontrado.");
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound("Pedido não encontrado.");
  return id;
}

/**
 * Gestao de pedidos Guest no painel.
 * TODAS as rotas exigem autenticacao + role ADMIN.
 */
export async function pedidoAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  app.get("/", async (request, reply) => {
    const query = parse(listQuery, request.query);
    const result = await orders.listPedidos({
      page: query.page,
      perPage: query.perPage,
      status: query.status,
      search: query.search,
    });
    return ok(reply, {
      success: true,
      pedidos: result.data,
      meta: {
        page: result.page,
        perPage: result.perPage,
        total: result.total,
        totalPages: Math.ceil(result.total / result.perPage),
      },
      statuses: ADMIN_ORDER_STATUSES,
    });
  });

  app.get("/:id", async (request, reply) => {
    const { id: rawId } = parse(idParam, request.params);
    const id = parsePedidoId(rawId);
    const pedido = await orders.getPedidoById(id);
    return ok(reply, { success: true, pedido });
  });

  /**
   * Atualiza o status. Regra obrigatoria:
   * "Entregue" exige `recebido_por` e grava `data_entrega = now()`.
   */
  app.patch("/:id", async (request, reply) => {
    const { id: rawId } = parse(idParam, request.params);
    const id = parsePedidoId(rawId);
    const input = parse(adminUpdatePedidoSchema, request.body);
    const pedido = await orders.updatePedidoStatus(id, {
      status_atual: input.status_atual,
      recebido_por: input.recebido_por || undefined,
      frete_valor: input.frete_valor,
    });
    return ok(reply, { success: true, pedido });
  });
}
