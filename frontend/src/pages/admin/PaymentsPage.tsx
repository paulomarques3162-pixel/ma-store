import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Input, Select, StatCard } from "@/components/ui";
import { AdminPageHeader, AdminTable, RowActions, type AdminColumn } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { PAYMENT_METHOD, PAYMENT_STATUS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, envelopeExtras, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { PaymentMethod, PaymentStatus } from "@/types/api";

type PaymentRow = {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  provider: string;
  providerRef: string | null;
  expiresAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  order: { id: string; number: string; user: { name: string; email: string } };
  _count: { attempts: number };
};

/** Pagamentos: acompanhamento, ambiente atual e expiração de pendentes. */
export default function AdminPaymentsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<PaymentStatus | "">("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    applySeo({ title: "Pagamentos", noindex: true, canonicalPath: "/admin/pagamentos" });
  }, []);

  const payments = useQuery({
    queryKey: queryKeys.adminPayments({ status, method, page }),
    queryFn: () =>
      api.list<PaymentRow[]>("/admin/payments", {
        query: { status: status || undefined, method: method || undefined, page, perPage: 20 },
      }),
    placeholderData: (previous) => previous,
  });

  const environment = (envelopeExtras(payments.data?.data).environment as string | undefined) ?? "sandbox";
  const summary = (envelopeExtras(payments.data?.data).summary as Array<{ status: PaymentStatus; count: number; amount: number }> | undefined) ?? [];

  const expireStale = useMutation({
    mutationFn: () => api.post<{ expired: number }>("/admin/payments/expire-stale"),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "payments"] });
      toast.success("Processado", `${result.expired} pagamento(s) vencido(s) expirado(s).`);
    },
    onError: (error) => toast.error("Não foi possível processar", errorMessage(error)),
  });

  const columns: Array<AdminColumn<PaymentRow>> = [
    {
      key: "order",
      header: "Pedido",
      render: (payment) => (
        <div>
          <Link to={`/admin/pedidos/${payment.order.id}`} className="text-sm text-strong">
            {payment.order.number}
          </Link>
          <div className="text-xs text-muted">{payment.order.user?.name}</div>
        </div>
      ),
    },
    {
      key: "method",
      header: "Método",
      render: (payment) => <span className="text-sm">{PAYMENT_METHOD[payment.method]}</span>,
    },
    {
      key: "amount",
      header: "Valor",
      align: "right",
      render: (payment) => <span className="text-sm text-strong tabular">{formatCurrency(payment.amount)}</span>,
    },
    {
      key: "provider",
      header: "Referência",
      hideOnMobile: true,
      render: (payment) => (
        <div className="text-xs text-muted">
          <div>{payment.provider}</div>
          <div style={{ fontFamily: "var(--font-mono)" }}>{payment.providerRef ?? "—"}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (payment) => <Badge tone={PAYMENT_STATUS[payment.status].tone}>{PAYMENT_STATUS[payment.status].label}</Badge>,
    },
    {
      key: "dates",
      header: "Criado / aprovado",
      hideOnMobile: true,
      render: (payment) => (
        <div className="text-xs text-muted">
          <div>{formatDateTime(payment.createdAt)}</div>
          <div>{payment.approvedAt ? formatDateTime(payment.approvedAt) : `expira ${payment.expiresAt ? formatDateTime(payment.expiresAt) : "—"}`}</div>
        </div>
      ),
    },
    {
      key: "attempts",
      header: "Tentativas",
      align: "right",
      render: (payment) => <span className="text-sm text-muted">{payment._count.attempts}</span>,
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (payment) => (
        <RowActions>
          <Link to={`/admin/pedidos/${payment.order.id}`} className="btn btn--ghost btn--sm">
            Abrir pedido
          </Link>
        </RowActions>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Pagamentos"
        subtitle="Acompanhe as transações e o ambiente em uso."
        actions={
          <Button variant="ghost" icon="refresh" onClick={() => expireStale.mutate()} loading={expireStale.isPending}>
            Expirar vencidos
          </Button>
        }
      />

      <Alert tone={environment === "production" ? "danger" : "warning"} title={environment === "production" ? "Ambiente de PRODUÇÃO" : "Ambiente de TESTE (sandbox)"}>
        {environment === "production"
          ? "As transações são reais. Confira as credenciais do gateway antes de continuar."
          : "Nenhuma cobrança real é feita neste ambiente. Use o sandbox para validar o fluxo antes de ativar a produção."}
      </Alert>

      {summary.length > 0 ? (
        <div className="admin-stats mt-5 mb-5">
          {summary.slice(0, 4).map((item) => (
            <StatCard
              key={item.status}
              label={PAYMENT_STATUS[item.status]?.label ?? item.status}
              value={formatCurrency(item.amount)}
              hint={`${item.count} pagamento(s)`}
              icon="creditCard"
            />
          ))}
        </div>
      ) : null}

      <form className="admin-filters" onSubmit={(event) => event.preventDefault()}>
        <Select
          label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as PaymentStatus | "");
            setPage(1);
          }}
          placeholder="Todos"
          options={Object.entries(PAYMENT_STATUS).map(([value, config]) => ({ value, label: config.label }))}
        />
        <Select
          label="Método"
          value={method}
          onChange={(event) => {
            setMethod(event.target.value as PaymentMethod | "");
            setPage(1);
          }}
          placeholder="Todos"
          options={Object.entries(PAYMENT_METHOD).map(([value, label]) => ({ value, label }))}
        />
        <Input label=" " value="" onChange={() => undefined} style={{ visibility: "hidden", width: 1 }} />
      </form>

      <AdminTable
        columns={columns}
        rows={payments.data?.data ?? []}
        loading={payments.isLoading}
        error={payments.error}
        requestId={errorRequestId(payments.error)}
        onRetry={() => void payments.refetch()}
        meta={payments.data?.meta}
        onPageChange={setPage}
        emptyTitle="Nenhum pagamento registrado"
        emptyText="Os pagamentos aparecem aqui assim que houver pedidos."
        emptyIcon="creditCard"
      />

      <Alert tone="info" title="Dados sensíveis protegidos">
        O sistema guarda apenas a referência do provedor. Números de cartão nunca são armazenados — nem exibidos no
        painel.
      </Alert>
    </div>
  );
}
