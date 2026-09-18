import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ConfirmDialog, Select, StarPicker } from "@/components/ui";
import { AdminPageHeader, AdminTable, RowActions, type AdminColumn } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { FEEDBACK_TYPE, MODERATION_STATUS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, envelopeExtras, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format";
import type { Feedback, ModerationStatus, Review } from "@/types/api";

type Section = "avaliacoes" | "feedbacks";

/** Moderação de avaliações de produto e feedbacks dos clientes. */
export default function AdminFeedbacksPage() {
  const [section, setSection] = useState<Section>("avaliacoes");

  useEffect(() => {
    applySeo({ title: "Avaliações e feedbacks", noindex: true, canonicalPath: "/admin/feedbacks" });
  }, []);

  return (
    <div>
      <AdminPageHeader
        title="Avaliações e feedbacks"
        subtitle="Modere o conteúdo antes de ele aparecer na loja."
      />

      <div className="tabs mb-5" role="tablist" aria-label="Seções">
        <button
          type="button"
          role="tab"
          aria-selected={section === "avaliacoes"}
          className={["tab", section === "avaliacoes" ? "tab--active" : ""].filter(Boolean).join(" ")}
          onClick={() => setSection("avaliacoes")}
        >
          Avaliações de produto
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "feedbacks"}
          className={["tab", section === "feedbacks" ? "tab--active" : ""].filter(Boolean).join(" ")}
          onClick={() => setSection("feedbacks")}
        >
          Feedbacks
        </button>
      </div>

      {section === "avaliacoes" ? <ReviewsSection /> : <FeedbacksSection />}
    </div>
  );
}

function ReviewsSection() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ModerationStatus | "">("PENDING");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Review | null>(null);

  const reviews = useQuery({
    queryKey: queryKeys.adminReviews({ status, page }),
    queryFn: () =>
      api.list<Review[]>("/admin/reviews", {
        query: { status: status || undefined, page, perPage: 20 },
      }),
    placeholderData: (previous) => previous,
  });

  const counts = (envelopeExtras(reviews.data?.data).statusCounts as Record<string, number> | undefined) ?? {};

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["admin", "reviews"] });

  const moderate = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: ModerationStatus }) =>
      api.patch(`/admin/reviews/${id}`, { status: nextStatus }),
    onSuccess: (_data, variables) => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminDashboard });
      toast.success(variables.nextStatus === "APPROVED" ? "Avaliação publicada" : "Avaliação ocultada");
    },
    onError: (error) => toast.error("Não foi possível moderar", errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/reviews/${id}`),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      toast.success("Avaliação excluída");
    },
    onError: (error) => toast.error("Não foi possível excluir", errorMessage(error)),
  });

  const columns: Array<AdminColumn<Review>> = [
    {
      key: "product",
      header: "Produto",
      render: (review) => (
        <div style={{ minWidth: 0 }}>
          <div className="text-sm text-strong clamp-1">{review.product?.name ?? "—"}</div>
          {review.order ? <div className="text-xs text-muted">Pedido {review.order.number}</div> : null}
        </div>
      ),
    },
    {
      key: "customer",
      header: "Cliente",
      render: (review) => (
        <div>
          <div className="text-sm">{review.user?.name ?? "—"}</div>
          <div className="text-xs text-muted">{review.user?.email ?? ""}</div>
        </div>
      ),
    },
    {
      key: "rating",
      header: "Nota",
      render: (review) => <StarPicker value={review.rating} onChange={() => undefined} label="Nota enviada pelo cliente" />,
    },
    {
      key: "comment",
      header: "Comentário",
      hideOnMobile: true,
      render: (review) => (
        <div style={{ maxWidth: 320 }}>
          {review.title ? <div className="text-sm text-strong clamp-1">{review.title}</div> : null}
          <div className="text-xs text-muted clamp-2">{review.comment ?? "Sem comentário"}</div>
          <div className="text-xs text-subtle mt-1">{formatDateTime(review.createdAt)}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (review) => <Badge tone={MODERATION_STATUS[review.status].tone}>{MODERATION_STATUS[review.status].label}</Badge>,
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (review) => (
        <RowActions>
          {review.status !== "APPROVED" ? (
            <Button size="sm" variant="ghost" icon="check" onClick={() => moderate.mutate({ id: review.id, nextStatus: "APPROVED" })}>
              Publicar
            </Button>
          ) : null}
          {review.status !== "REJECTED" ? (
            <Button size="sm" variant="ghost" icon="eyeOff" onClick={() => moderate.mutate({ id: review.id, nextStatus: "REJECTED" })}>
              Ocultar
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" icon="trash" iconOnly onClick={() => setDeleteTarget(review)}>
            Excluir
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <div className="admin-filters">
        <Select
          label="Situação"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as ModerationStatus | "");
            setPage(1);
          }}
          placeholder="Todas"
          options={Object.entries(MODERATION_STATUS).map(([value, config]) => ({ value, label: config.label }))}
        />
        <div className="row row-3" style={{ alignItems: "flex-end", paddingBottom: 4 }}>
          <Badge tone="warning">Aguardando: {counts["PENDING"] ?? 0}</Badge>
          <Badge tone="success">Publicadas: {counts["APPROVED"] ?? 0}</Badge>
          <Badge tone="danger">Ocultas: {counts["REJECTED"] ?? 0}</Badge>
        </div>
      </div>

      <AdminTable
        columns={columns}
        rows={reviews.data?.data ?? []}
        loading={reviews.isLoading}
        error={reviews.error}
        requestId={errorRequestId(reviews.error)}
        onRetry={() => void reviews.refetch()}
        meta={reviews.data?.meta}
        onPageChange={setPage}
        emptyTitle="Nenhuma avaliação encontrada"
        emptyText="As avaliações aparecem aqui depois que um cliente avalia um produto recebido."
        emptyIcon="star"
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir avaliação"
        message="A avaliação será removida definitivamente. Prefira “Ocultar” para preservar o histórico de moderação."
        confirmLabel="Excluir"
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

function FeedbacksSection() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ModerationStatus | "">("PENDING");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);

  const feedbacks = useQuery({
    queryKey: queryKeys.adminFeedbacks({ status, type, page }),
    queryFn: () =>
      api.list<Feedback[]>("/admin/feedbacks", {
        query: { status: status || undefined, type: type || undefined, page, perPage: 20 },
      }),
    placeholderData: (previous) => previous,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["admin", "feedbacks"] });

  const moderate = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: ModerationStatus }) =>
      api.patch(`/admin/feedbacks/${id}`, { status: nextStatus }),
    onSuccess: () => {
      invalidate();
      toast.success("Feedback atualizado");
    },
    onError: (error) => toast.error("Não foi possível moderar", errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/feedbacks/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success("Feedback excluído");
    },
    onError: (error) => toast.error("Não foi possível excluir", errorMessage(error)),
  });

  const columns: Array<AdminColumn<Feedback>> = [
    {
      key: "type",
      header: "Assunto",
      render: (feedback) => <span className="text-sm">{FEEDBACK_TYPE[feedback.type]}</span>,
    },
    {
      key: "customer",
      header: "Cliente",
      render: (feedback) => (
        <div>
          <div className="text-sm">{feedback.user?.name ?? "Visitante"}</div>
          <div className="text-xs text-muted">{feedback.user?.email ?? feedback.contact ?? ""}</div>
        </div>
      ),
    },
    {
      key: "rating",
      header: "Nota",
      align: "right",
      render: (feedback) => <span className="text-sm">{feedback.rating ? `${feedback.rating}/5` : "—"}</span>,
    },
    {
      key: "comment",
      header: "Comentário",
      hideOnMobile: true,
      render: (feedback) => (
        <div style={{ maxWidth: 320 }}>
          <div className="text-xs text-muted clamp-2">{feedback.comment ?? "Sem comentário"}</div>
          <div className="text-xs text-subtle mt-1">{formatDateTime(feedback.createdAt)}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (feedback) => <Badge tone={MODERATION_STATUS[feedback.status].tone}>{MODERATION_STATUS[feedback.status].label}</Badge>,
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (feedback) => (
        <RowActions>
          <Link to="/admin/mensagens" className="btn btn--ghost btn--sm">
            Responder
          </Link>
          <Button size="sm" variant="ghost" icon="check" iconOnly onClick={() => moderate.mutate({ id: feedback.id, nextStatus: "APPROVED" })}>
            Aprovar
          </Button>
          <Button size="sm" variant="ghost" icon="trash" iconOnly onClick={() => remove.mutate(feedback.id)}>
            Excluir
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <div className="admin-filters">
        <Select
          label="Situação"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as ModerationStatus | "");
            setPage(1);
          }}
          placeholder="Todas"
          options={Object.entries(MODERATION_STATUS).map(([value, config]) => ({ value, label: config.label }))}
        />
        <Select
          label="Assunto"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
          placeholder="Todos"
          options={Object.entries(FEEDBACK_TYPE).map(([value, label]) => ({ value, label }))}
        />
      </div>

      <AdminTable
        columns={columns}
        rows={feedbacks.data?.data ?? []}
        loading={feedbacks.isLoading}
        error={feedbacks.error}
        requestId={errorRequestId(feedbacks.error)}
        onRetry={() => void feedbacks.refetch()}
        meta={feedbacks.data?.meta}
        onPageChange={setPage}
        emptyTitle="Nenhum feedback encontrado"
        emptyText="Os feedbacks enviados pelos clientes aparecem aqui para moderação."
        emptyIcon="message"
      />
    </>
  );
}
