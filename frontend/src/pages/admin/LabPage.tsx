import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Icon, LoadingBlock, StatCard, Tabs } from "@/components/ui";
import { AdminPageHeader, AdminTable, type AdminColumn } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, errorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format";
import type { LabCheck, TestRun } from "@/types/api";

type Checklist = { id: string; label: string };

/**
 * Laboratório de testes.
 *
 * Executa a suíte real do backend (API + banco), mostra PASS/WARN/FAIL com tempo,
 * endpoint e `requestId`, e mantém o histórico das execuções. Os dados criados
 * pela suíte são marcados como teste e removidos ao final pelo próprio backend.
 */
export default function AdminLabPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ runId: string; status: string; results: LabCheck[]; summary: { total: number; pass: number; warn: number; fail: number; durationMs: number } } | null>(null);

  const checklists = useQuery({
    queryKey: queryKeys.labChecklists,
    queryFn: () => api.get<{ categories: Checklist[] }>("/admin/lab/checklists"),
    staleTime: 10 * 60_000,
  });

  const runs = useQuery({
    queryKey: queryKeys.labRuns({ page: 1 }),
    queryFn: () => api.list<TestRun[]>("/admin/lab/runs", { query: { perPage: 10 } }),
  });

  const runDetail = useQuery({
    queryKey: queryKeys.labRun(selectedRun ?? ""),
    queryFn: () => api.get<TestRun>(`/admin/lab/runs/${selectedRun}`),
    enabled: Boolean(selectedRun),
  });

  useEffect(() => {
    applySeo({ title: "Laboratório de testes", noindex: true, canonicalPath: "/admin/testes" });
  }, []);

  const execute = useMutation({
    mutationFn: () =>
      api.post<{ runId: string; status: string; results: LabCheck[]; summary: { total: number; pass: number; warn: number; fail: number; durationMs: number } }>("/admin/lab/run"),
    onSuccess: (result) => {
      setLastResult(result);
      setSelectedRun(result.runId);
      void queryClient.invalidateQueries({ queryKey: ["admin", "lab"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminDashboard });

      if (result.summary.fail > 0) {
        toast.error("Testes concluídos com falhas", `${result.summary.fail} verificação(ões) falharam.`);
      } else if (result.summary.warn > 0) {
        toast.warning("Testes concluídos com avisos", `${result.summary.warn} aviso(s) encontrado(s).`);
      } else {
        toast.success("Tudo certo!", `${result.summary.pass} verificações passaram.`);
      }
    },
    onError: (error) => toast.error("Não foi possível executar a suíte", errorMessage(error)),
  });

  const results = lastResult?.results ?? runDetail.data?.results ?? [];
  const summary = lastResult?.summary ?? runDetail.data?.summary;

  const columns: Array<AdminColumn<TestRun>> = [
    {
      key: "run",
      header: "Execução",
      render: (run) => (
        <div>
          <button type="button" className="btn btn--link btn--sm" onClick={() => setSelectedRun(run.id)}>
            {formatDateTime(run.startedAt)}
          </button>
          <div className="text-xs text-muted">
            {run.environment} • {run.durationMs ?? 0} ms
          </div>
        </div>
      ),
    },
    {
      key: "result",
      header: "Resultado",
      render: (run) => (
        <Badge tone={run.status === "PASS" ? "success" : run.status === "WARN" ? "warning" : "danger"}>
          {run.status === "PASS" ? "Passou" : run.status === "WARN" ? "Atenção" : "Falhou"}
        </Badge>
      ),
    },
    {
      key: "summary",
      header: "Resumo",
      hideOnMobile: true,
      render: (run) => (
        <span className="text-xs text-muted">
          {run.summary ? `${run.summary.pass} ok • ${run.summary.warn} avisos • ${run.summary.fail} falhas` : `${run.total ?? 0} verificações`}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (run) => (
        <Button size="sm" variant="ghost" icon="eye" onClick={() => setSelectedRun(run.id)}>
          Ver detalhes
        </Button>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Laboratório de testes"
        subtitle="Valide a plataforma antes de divulgar. A suíte roda contra a API e o banco de verdade."
        actions={
          <Button icon="flask" loading={execute.isPending} onClick={() => execute.mutate()}>
            {execute.isPending ? "Executando…" : "Executar suíte completa"}
          </Button>
        }
      />

      <Alert tone="info" title="Como a suíte funciona">
        Ela cria dados marcados como <strong>[TESTE]</strong>, executa as verificações e remove tudo ao final.
        Nenhum produto real é alterado. As verificações incluem autenticação, segurança, carrinho, cupom, frete,
        pedido, concorrência de estoque, pagamento, webhooks e desempenho.
      </Alert>

      {summary ? (
        <div className="admin-stats mt-5 mb-5">
          <StatCard label="Total" value={summary.total} icon="clipboard" />
          <StatCard label="Passaram" value={summary.pass} icon="checkCircle" tone="success" />
          <StatCard label="Atenção" value={summary.warn} icon="alertTriangle" tone="warning" />
          <StatCard label="Falharam" value={summary.fail} icon="xCircle" tone={summary.fail > 0 ? "danger" : undefined} />
        </div>
      ) : null}

      {execute.isPending ? <LoadingBlock label="Executando as verificações…" /> : null}

      {results.length > 0 ? (
        <div className="stack stack-2 mb-8">
          {results.map((result, index) => (
            <Card key={`${result.name}-${index}`} padded={false}>
              <div className="row row-4" style={{ padding: "var(--space-4)", alignItems: "flex-start" }}>
                <span
                  className="empty-state__icon"
                  style={{
                    width: 40,
                    height: 40,
                    margin: 0,
                    background:
                      result.status === "PASS"
                        ? "var(--color-success-bg)"
                        : result.status === "WARN"
                          ? "var(--color-warning-bg)"
                          : "var(--color-danger-bg)",
                    color:
                      result.status === "PASS"
                        ? "var(--color-success)"
                        : result.status === "WARN"
                          ? "var(--color-warning)"
                          : "var(--color-danger)",
                  }}
                >
                  <Icon name={result.status === "PASS" ? "checkCircle" : result.status === "WARN" ? "alertTriangle" : "xCircle"} size={19} />
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row row-between row-wrap">
                    <p className="text-sm text-strong">{result.name}</p>
                    <div className="row row-2">
                      <Badge tone="neutral">{result.category}</Badge>
                      <span className="text-xs text-subtle">{result.durationMs} ms</span>
                    </div>
                  </div>

                  {result.endpoint ? (
                    <code className="text-xs text-subtle" style={{ display: "block", marginTop: 4 }}>
                      {result.endpoint}
                    </code>
                  ) : null}

                  {result.errorMessage ? (
                    <p className="text-xs mt-2" style={{ color: result.status === "FAIL" ? "var(--color-danger)" : "var(--color-warning)" }}>
                      {result.errorMessage}
                    </p>
                  ) : null}

                  {result.requestId ? (
                    <p className="text-xs text-subtle mt-1">requestId: {result.requestId}</p>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <Tabs
        ariaLabel="Histórico do laboratório"
        value="historico"
        onChange={() => undefined}
        tabs={[{ value: "historico", label: "Histórico de execuções" }]}
      />

      <div className="mt-4">
        <AdminTable
          columns={columns}
          rows={runs.data?.data ?? []}
          loading={runs.isLoading}
          error={runs.error}
          onRetry={() => void runs.refetch()}
          emptyTitle="Nenhuma execução registrada"
          emptyText="Rode a suíte para ter um diagnóstico completo da plataforma."
          emptyIcon="flask"
          emptyAction={
            <Button icon="flask" loading={execute.isPending} onClick={() => execute.mutate()}>
              Executar agora
            </Button>
          }
        />
      </div>

      {checklists.data?.categories?.length ? (
        <Card className="mt-6">
          <h3 className="card__title mb-4">Áreas verificadas</h3>
          <div className="row row-2 row-wrap">
            {checklists.data.categories.map((category) => (
              <Badge key={category.id} tone="neutral">
                {category.label}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
