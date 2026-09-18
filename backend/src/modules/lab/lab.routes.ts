import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { notFound } from "../../lib/errors.js";
import { created, ok, okPaginated, parse } from "../../lib/http.js";
import { paginate, parsePagination } from "../../lib/serialize.js";
import { runSuite } from "./lab.service.js";

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(50).optional().default(10),
});

/**
 * LABORATORIO / TESTES.
 *
 * Executa a suite de verificacoes reais (API + banco + fluxo de compra) e
 * grava tudo em `test_runs` / `test_results`. Stack trace so e devolvido em
 * ambiente nao-producao.
 */
export async function labRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  /** Lista execucoes anteriores. */
  app.get("/runs", async (request, reply) => {
    const query = parse(listQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);

    const [runs, total] = await Promise.all([
      prisma.testRun.findMany({
        orderBy: { startedAt: "desc" },
        skip,
        take,
        include: { _count: { select: { results: true } }, results: { select: { status: true } } },
      }),
      prisma.testRun.count(),
    ]);

    return okPaginated(
      reply,
      paginate(
        runs.map((run) => {
          const summary = { pass: 0, warn: 0, fail: 0 };
          for (const result of run.results) {
            if (result.status === "PASS") summary.pass += 1;
            else if (result.status === "WARN") summary.warn += 1;
            else summary.fail += 1;
          }
          return {
            id: run.id,
            suite: run.suite,
            status: run.status,
            environment: run.environment,
            durationMs: run.durationMs,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            total: run._count.results,
            summary,
          };
        }),
        total,
        page,
        perPage,
      ),
    );
  });

  /** Detalhe de uma execucao, com todos os resultados. */
  app.get("/runs/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const run = await prisma.testRun.findUnique({
      where: { id },
      include: { results: { orderBy: [{ category: "asc" }, { createdAt: "asc" }] } },
    });
    if (!run) throw notFound("Execucao de testes nao encontrada.");

    return ok(reply, {
      ...run,
      results: run.results.map((result) => ({
        ...result,
        // Stack trace apenas para admin em ambiente autorizado.
        stackTrace: run.environment === "production" ? null : result.stackTrace,
      })),
    });
  });

  /** Checklists disponiveis no laboratorio. */
  app.get("/checklists", async (_request, reply) =>
    ok(reply, {
      categories: [
        { id: "infra", label: "Infraestrutura e API" },
        { id: "banco", label: "Banco de dados, migrations, indices e transacoes" },
        { id: "autenticacao", label: "Cadastro, login e sessoes" },
        { id: "seguranca", label: "Autorizacao, tokens e protecao de dados" },
        { id: "catalogo", label: "Produtos, categorias, busca e filtros" },
        { id: "carrinho", label: "Carrinho e validacao de estoque" },
        { id: "cupom", label: "Cupons e regras de desconto" },
        { id: "frete", label: "Modalidades e calculo de frete" },
        { id: "pedido", label: "Checkout, numeracao e idempotencia" },
        { id: "concorrencia", label: "Condicoes de corrida e integridade de estoque" },
        { id: "pagamento", label: "Pagamentos, sandbox, webhooks e idempotencia" },
        { id: "admin", label: "Painel administrativo e auditoria" },
        { id: "mensagens", label: "Central de mensagens" },
        { id: "notificacoes", label: "Notificacoes" },
        { id: "avaliacoes", label: "Avaliacoes e feedback" },
        { id: "cms", label: "Conteudo, banners e tema" },
        { id: "performance", label: "Latencia e desempenho" },
      ],
    }),
  );

  /**
   * Executa a suite completa.
   * ATENCAO: cria dados marcados como [TESTE]/isDemo e os remove ao final.
   */
  app.post("/run", async (request, reply) => {
    const result = await runSuite(app, request.authUser!.id);
    return created(reply, result);
  });
}
