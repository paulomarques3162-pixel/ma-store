import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Icon,
  LoadingBlock,
  Select,
  StarPicker,
  Tabs,
} from "@/components/ui";
import { useToast } from "@/hooks";
import { EMPTY_MESSAGES, FEEDBACK_TYPE, MODERATION_STATUS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, errorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import type { Feedback, FeedbackType, Review } from "@/types/api";

type Tab = "avaliar" | "meus" | "pendentes";

/** Avaliações de produto (só após compra entregue) e feedback geral. */
export default function FeedbackPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("avaliar");

  useEffect(() => {
    applySeo({ title: "Avaliações e feedback", noindex: true, canonicalPath: "/feedback" });
  }, []);

  /* --------------------------------------------------- produtos a avaliar */
  const pending = useQuery({
    queryKey: queryKeys.pendingReviews,
    queryFn: () => api.get<Array<{ orderId: string; orderNumber: string; productId: string; productName: string }>>("/reviews/pending"),
  });

  const myReviews = useQuery({
    queryKey: queryKeys.myReviews,
    queryFn: () => api.get<Review[]>("/reviews/mine"),
  });

  const myFeedback = useQuery({
    queryKey: queryKeys.myFeedback,
    queryFn: () => api.get<Feedback[]>("/feedback/mine"),
  });

  /* ------------------------------------------------------- formulários */
  const [reviewForm, setReviewForm] = useState<{ productId: string; orderId: string; rating: number; title: string; comment: string } | null>(null);

  const submitReview = useMutation({
    mutationFn: (payload: { productId: string; orderId: string; rating: number; title: string; comment: string }) =>
      api.post(`/products/${payload.productId}/reviews`, {
        rating: payload.rating,
        title: payload.title || undefined,
        comment: payload.comment || undefined,
        orderId: payload.orderId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingReviews });
      void queryClient.invalidateQueries({ queryKey: queryKeys.myReviews });
      setReviewForm(null);
      toast.success("Avaliação enviada", "Ela aparece no site após a moderação.");
    },
    onError: (error) => toast.error("Não foi possível enviar a avaliação", errorMessage(error)),
  });

  const [feedback, setFeedback] = useState<{ type: FeedbackType; rating: number; comment: string; contact: string }>({
    type: "EXPERIENCE",
    rating: 0,
    comment: "",
    contact: "",
  });

  const submitFeedback = useMutation({
    mutationFn: () =>
      api.post("/feedback", {
        type: feedback.type,
        rating: feedback.rating || undefined,
        comment: feedback.comment || undefined,
        contact: feedback.contact || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myFeedback });
      setFeedback({ type: "EXPERIENCE", rating: 0, comment: "", contact: "" });
      toast.success("Obrigado pelo seu feedback!");
    },
    onError: (error) => toast.error("Não foi possível enviar", errorMessage(error)),
  });

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Avaliações e feedback" }]} />

      <div className="page-header">
        <div>
          <h1 className="page-header__title">Avaliações e feedback</h1>
          <p className="page-header__subtitle">
            Sua opinião ajuda outros clientes e melhora o atendimento da loja.
          </p>
        </div>
      </div>

      <Tabs
        ariaLabel="Seções de avaliação"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "avaliar", label: "Avaliar produtos", badge: pending.data?.length },
          { value: "meus", label: "Minhas avaliações", badge: myReviews.data?.length },
          { value: "pendentes", label: "Meus feedbacks", badge: myFeedback.data?.length },
        ]}
      />

      <div className="mt-6 stack stack-5">
        {/* ------------------------------------------------------ AVALIAR */}
        {tab === "avaliar" ? (
          <>
            <Card className="stack stack-4">
              <h2 className="text-lg">Avaliar um produto recebido</h2>
              <Alert tone="info">
                Só é possível avaliar produtos que já foram entregues. Assim que seu pedido for marcado como entregue,
                ele aparece aqui.
              </Alert>

              {pending.isLoading ? (
                <LoadingBlock size="md" label="Carregando produtos…" />
              ) : (pending.data ?? []).length === 0 ? (
                <p className="text-sm text-muted">
                  Nenhum produto aguardando avaliação no momento.
                </p>
              ) : (
                <div className="stack stack-2">
                  {(pending.data ?? []).map((item) => (
                    <div key={`${item.orderId}-${item.productId}`} className="option-item" style={{ cursor: "default" }}>
                      <span className="option-item__content">
                        <span className="option-item__title">{item.productName}</span>
                        <span className="option-item__hint">Pedido {item.orderNumber}</span>
                      </span>
                      <Button
                        size="sm"
                        icon="star"
                        onClick={() =>
                          setReviewForm({
                            productId: item.productId,
                            orderId: item.orderId,
                            rating: 5,
                            title: "",
                            comment: "",
                          })
                        }
                      >
                        Avaliar
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Formulário de avaliação */}
            {reviewForm ? (
              <Card className="stack stack-4">
                <div className="row row-between">
                  <h2 className="text-lg">Sua avaliação</h2>
                  <Button variant="ghost" size="sm" icon="close" iconOnly onClick={() => setReviewForm(null)}>
                    Fechar
                  </Button>
                </div>

                <div className="field">
                  <span className="field__label">Sua nota</span>
                  <StarPicker value={reviewForm.rating} onChange={(rating) => setReviewForm({ ...reviewForm, rating })} />
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="review-title">
                    Título
                  </label>
                  <input
                    id="review-title"
                    className="input"
                    value={reviewForm.title}
                    maxLength={120}
                    placeholder="Resuma sua experiência"
                    onChange={(event) => setReviewForm({ ...reviewForm, title: event.target.value })}
                  />
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="review-comment">
                    Comentário
                  </label>
                  <textarea
                    id="review-comment"
                    className="textarea"
                    value={reviewForm.comment}
                    maxLength={2000}
                    placeholder="Conte como foi com o produto"
                    onChange={(event) => setReviewForm({ ...reviewForm, comment: event.target.value })}
                  />
                </div>

                <div className="row row-end">
                  <Button
                    onClick={() => submitReview.mutate(reviewForm)}
                    loading={submitReview.isPending}
                    disabled={reviewForm.rating < 1}
                  >
                    Enviar avaliação
                  </Button>
                </div>
              </Card>
            ) : null}

            <Card className="stack stack-4">
              <h2 className="text-lg">Feedback sobre a loja</h2>
              <p className="text-sm text-muted">
                Conte como foi sua experiência de compra, a entrega ou o atendimento.
              </p>

              <Select
                label="Assunto"
                value={feedback.type}
                onChange={(event) => setFeedback({ ...feedback, type: event.target.value as FeedbackType })}
                options={Object.entries(FEEDBACK_TYPE).map(([value, label]) => ({ value, label }))}
              />

              <div className="field">
                <span className="field__label">Nota (opcional)</span>
                <StarPicker value={feedback.rating} onChange={(rating) => setFeedback({ ...feedback, rating })} />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="feedback-comment">
                  Comentário
                </label>
                <textarea
                  id="feedback-comment"
                  className="textarea"
                  value={feedback.comment}
                  maxLength={2000}
                  placeholder="Escreva seu feedback"
                  onChange={(event) => setFeedback({ ...feedback, comment: event.target.value })}
                />
              </div>

              <div className="row row-end">
                <Button
                  onClick={() => submitFeedback.mutate()}
                  loading={submitFeedback.isPending}
                  disabled={!feedback.comment.trim()}
                >
                  Enviar feedback
                </Button>
              </div>
            </Card>
          </>
        ) : null}

        {/* ------------------------------------------------- MINHAS AVALIAÇÕES */}
        {tab === "meus" ? (
          myReviews.isLoading ? (
            <LoadingBlock size="md" label="Carregando avaliações…" />
          ) : (myReviews.data ?? []).length === 0 ? (
            <EmptyState icon="star" title={EMPTY_MESSAGES.reviews.title} text={EMPTY_MESSAGES.reviews.text} />
          ) : (
            <div className="stack stack-3">
              {(myReviews.data ?? []).map((review) => (
                <Card key={review.id}>
                  <div className="row row-between row-wrap">
                    <div>
                      <p className="text-sm text-strong">{review.product?.name ?? "Produto"}</p>
                      <span className="text-xs text-subtle">{formatDate(review.createdAt)}</span>
                    </div>
                    <Badge tone={MODERATION_STATUS[review.status].tone}>{MODERATION_STATUS[review.status].label}</Badge>
                  </div>
                  <div className="row row-2 mt-2">
                    <Icon name="starFilled" size={16} />
                    <span className="text-sm">{review.rating}/5</span>
                  </div>
                  {review.title ? <p className="text-sm mt-2">{review.title}</p> : null}
                  {review.comment ? <p className="text-sm text-muted mt-1">{review.comment}</p> : null}
                </Card>
              ))}
            </div>
          )
        ) : null}

        {/* -------------------------------------------------- MEUS FEEDBACKS */}
        {tab === "pendentes" ? (
          myFeedback.isLoading ? (
            <LoadingBlock size="md" label="Carregando feedbacks…" />
          ) : (myFeedback.data ?? []).length === 0 ? (
            <EmptyState icon="message" title={EMPTY_MESSAGES.feedback.title} text={EMPTY_MESSAGES.feedback.text} />
          ) : (
            <div className="stack stack-3">
              {(myFeedback.data ?? []).map((item) => (
                <Card key={item.id}>
                  <div className="row row-between row-wrap">
                    <div>
                      <p className="text-sm text-strong">{FEEDBACK_TYPE[item.type]}</p>
                      <span className="text-xs text-subtle">{formatDate(item.createdAt)}</span>
                    </div>
                    <Badge tone={MODERATION_STATUS[item.status].tone}>{MODERATION_STATUS[item.status].label}</Badge>
                  </div>
                  {item.rating ? <p className="text-sm mt-2">Nota: {item.rating}/5</p> : null}
                  {item.comment ? <p className="text-sm text-muted mt-1">{item.comment}</p> : null}
                </Card>
              ))}
            </div>
          )
        ) : null}
      </div>

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}
