import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, Icon, Input, Modal, Select, StatCard } from "@/components/ui";
import { AdminPageHeader, AdminTable, type AdminColumn } from "@/components/admin/kit";
import { applySeo } from "@/lib/seo";
import { api, envelopeExtras, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format";
import type { AuditLog } from "@/types/api";

type Section = "auditoria" | "webhooks";

type WebhookEvent = {
  id: string;
  provider: string;
  eventId: string;
  eventType: string;
  signatureValid: boolean;
  status: string;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
};

type FailingCheck = {
  id: string;
  name: string;
  category: string;
  status: string;
  endpoint: string | null;
  requestId: string | null;
  errorMessage: string | null;
  durationMs: number;
  createdAt: string;
};

/** Logs e auditoria: quem alterou o quê, webhooks recebidos e falhas do lab. */
export default function AdminLogsPage() {
  const [section, setSection] = useState<Section>("auditoria");
  const [detail, setDetail] = useState<AuditLog | null>(null);

  useEffect(() => {
    applySeo({ title: "Logs e auditoria", noindex: true, canonicalPath: "/admin/logs" });
  }, []);

  return (
    <div>
      <AdminPageHeader
        title="Logs e auditoria"
        subtitle="Rastreie alterações administrativas, webhooks e falhas do sistema."
      />

      <div className="tabs mb-5" role="tablist" aria-label="Seções">
        <button
          type="button"
          role="tab"
          aria-selected={section === "auditoria"}
          className={["tab", section === "auditoria" ? "tab--active" : ""].filter(Boolean).join(" ")}
          onClick={() => setSection("auditoria")}
        >
          Auditoria administrativa
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "webhooks"}
          className={["tab", section === "webhooks" ? "tab--active" : ""].filter(Boolean).join(" ")}
          onClick={() => setSection("webhooks")}
        >
          Webhooks e falhas
        </button>
      </div>

      {section === "auditoria" ? <AuditSection onOpen={setDetail} /> : <WebhooksSection />}

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.action} • ${detail.entity}` : ""}
        size="lg"
      >
        {detail ? (
          <div className="stack stack-4">
            <div className="spec-list">
              <div className="spec-list__row">
                <span className="spec-list__label">Administrador</span>
                <span className="spec-list__value">{detail.admin?.name ?? "—"}</span>
              </div>
              <div className="spec-list__row">
                <span className="spec-list__label">E-mail</span>
                <span className="spec-list__value">{detail.admin?.email ?? "—"}</span>
              </div>
              <div className="spec-list__row">
                <span className="spec-list__label">Registro</span>
                <span className="spec-list__value">{detail.entityId ?? "—"}</span>
              </div>
              <div className="spec-list__row">
                <span className="spec-list__label">Data</span>
                <span className="spec-list__value">{formatDateTime(detail.createdAt)}</span>
              </div>
              <div className="spec-list__row">
                <span className="spec-list__label">IP</span>
                <span className="spec-list__value">{detail.ip ?? "—"}</span>
              </div>
              <div className="spec-list__row">
                <span className="spec-list__label">requestId</span>
                <span className="spec-list__value" style={{ fontFamily: "var(--font-mono)" }}>
                  {detail.requestId ?? "—"}
                </span>
              </div>
            </div>

            <div className="grid grid-2">
              <div>
                <p className="field__label">Antes</p>
                <pre
                  style={{
                    background: "var(--color-surface-2)",
                    padding: "var(--space-3)",
                    borderRadius: 8,
                    fontSize: 12,
                    overflow: "auto",
                    maxHeight: 240,
                  }}
                >
                  {JSON.stringify(detail.before ?? {}, null, 2)}
                </pre>
              </div>
              <div>
                <p className="field__label">Depois</p>
                <pre
                  style={{
                    background: "var(--color-surface-2)",
                    padding: "var(--space-3)",
                    borderRadius: 8,
                    fontSize: 12,
                    overflow: "auto",
                    maxHeight: 240,
                  }}
                >
                  {JSON.stringify(detail.after ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function AuditSection({ onOpen }: { onOpen: (log: AuditLog) => void }) {
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);

  const logs = useQuery({
    queryKey: queryKeys.adminAuditLogs({ entity, action, page }),
    queryFn: () =>
      api.list<AuditLog[]>("/admin/audit-logs", {
        query: { entity: entity || undefined, action: action || undefined, page, perPage: 30 },
      }),
    placeholderData: (previous) => previous,
  });

  const columns: Array<AdminColumn<AuditLog>> = [
    {
      key: "when",
      header: "Quando",
      render: (log) => (
        <div>
          <div className="text-sm">{formatDateTime(log.createdAt)}</div>
          <div className="text-xs text-muted">{log.admin?.name ?? "—"}</div>
        </div>
      ),
    },
    {
      key: "action",
      header: "Ação",
      render: (log) => (
        <div>
          <Badge tone="accent">{log.action}</Badge>
          <div className="text-xs text-muted mt-1">{log.entity}</div>
        </div>
      ),
    },
    {
      key: "entity",
      header: "Registro",
      hideOnMobile: true,
      render: (log) => (
        <code className="text-xs text-subtle" style={{ overflowWrap: "anywhere" }}>
          {log.entityId ?? "—"}
        </code>
      ),
    },
    {
      key: "request",
      header: "requestId",
      hideOnMobile: true,
      render: (log) => (
        <code className="text-xs text-subtle">{log.requestId ?? "—"}</code>
      ),
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (log) => (
        <Button size="sm" variant="ghost" icon="eye" onClick={() => onOpen(log)}>
          Ver diff
        </Button>
      ),
    },
  ];

  return (
    <>
      <form className="admin-filters" onSubmit={(event) => event.preventDefault()}>
        <Input
          label="Entidade"
          value={entity}
          onChange={(event) => {
            setEntity(event.target.value);
            setPage(1);
          }}
          placeholder="Ex.: Product, Order, User"
        />
        <Input
          label="Ação"
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(1);
          }}
          placeholder="Ex.: UPDATE, DELETE"
        />
      </form>

      <AdminTable
        columns={columns}
        rows={logs.data?.data ?? []}
        loading={logs.isLoading}
        error={logs.error}
        requestId={errorRequestId(logs.error)}
        onRetry={() => void logs.refetch()}
        meta={logs.data?.meta}
        onPageChange={setPage}
        emptyTitle="Nenhuma alteração registrada"
        emptyText="Toda ação administrativa (preço, estoque, status, moderação) é registrada aqui."
        emptyIcon="clipboard"
      />
    </>
  );
}

function WebhooksSection() {
  const [page] = useState(1);

  const logs = useQuery({
    queryKey: queryKeys.adminLogs({ page }),
    queryFn: () => api.get<{ webhookEvents: WebhookEvent[]; failingChecks: FailingCheck[] }>("/admin/logs", { query: { page, perPage: 30 } }),
  });

  const webhooks = logs.data?.webhookEvents ?? [];
  const failing = logs.data?.failingChecks ?? [];

  const invalidSignatures = webhooks.filter((event) => !event.signatureValid).length;

  return (
    <>
      <div className="admin-stats mb-5">
        <StatCard label="Webhooks recebidos" value={webhooks.length} icon="link" />
        <StatCard
          label="Assinaturas inválidas"
          value={invalidSignatures}
          icon="shieldOff"
          tone={invalidSignatures > 0 ? "danger" : undefined}
        />
        <StatCard label="Falhas do laboratório" value={failing.length} icon="alertTriangle" tone={failing.length > 0 ? "warning" : undefined} />
      </div>

      <AdminTable
        columns={
          [
            {
              key: "event",
              header: "Evento",
              render: (event: WebhookEvent) => (
                <div>
                  <div className="text-sm">{event.eventType}</div>
                  <code className="text-xs text-muted">{event.eventId}</code>
                </div>
              ),
            },
            {
              key: "provider",
              header: "Provedor",
              render: (event: WebhookEvent) => <span className="text-sm">{event.provider}</span>,
            },
            {
              key: "signature",
              header: "Assinatura",
              render: (event: WebhookEvent) => (
                <Badge tone={event.signatureValid ? "success" : "danger"}>
                  {event.signatureValid ? "Válida" : "Inválida"}
                </Badge>
              ),
            },
            {
              key: "status",
              header: "Status",
              render: (event: WebhookEvent) => <Badge tone={event.status === "PROCESSED" ? "success" : event.status === "FAILED" ? "danger" : "neutral"}>{event.status}</Badge>,
            },
            {
              key: "when",
              header: "Recebido",
              hideOnMobile: true,
              render: (event: WebhookEvent) => <span className="text-xs text-muted">{formatDateTime(event.createdAt)}</span>,
            },
          ] as Array<AdminColumn<WebhookEvent>>
        }
        rows={webhooks}
        loading={logs.isLoading}
        error={logs.error}
        requestId={errorRequestId(logs.error)}
        onRetry={() => void logs.refetch()}
        emptyTitle="Nenhum webhook recebido"
        emptyText="Os eventos do gateway de pagamento aparecem aqui com a validade da assinatura."
        emptyIcon="link"
      />

      {failing.length > 0 ? (
        <Card className="mt-6">
          <h3 className="card__title mb-4">
            <Icon name="alertTriangle" size={16} /> Falhas de verificação recentes
          </h3>
          <div className="stack stack-3">
            {failing.map((check) => (
              <div key={check.id} className="stack stack-1">
                <div className="row row-between row-wrap">
                  <span className="text-sm">{check.name}</span>
                  <div className="row row-2">
                    <Badge tone={check.status === "FAIL" ? "danger" : "warning"}>{check.status}</Badge>
                    <span className="text-xs text-subtle">{formatDateTime(check.createdAt)}</span>
                  </div>
                </div>
                {check.errorMessage ? <p className="text-xs text-muted">{check.errorMessage}</p> : null}
                {check.requestId ? <code className="text-xs text-subtle">requestId: {check.requestId}</code> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <p className="text-xs text-subtle mt-5">
        Os logs de aplicação ficam no provedor de hospedagem. Cada erro carrega um <strong>requestId</strong> que
        correlaciona a resposta ao registro do servidor — nunca exibimos stack trace no navegador.
      </p>
    </>
  );
}

export { Select, envelopeExtras };
