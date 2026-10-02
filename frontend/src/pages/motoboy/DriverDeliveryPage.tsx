import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Card,
  Icon,
  Input,
  LoadingBlock,
  Modal,
  Select,
  Textarea,
} from "@/components/ui";
import { DeliveryStatusBadge, DELIVERY_STATUS_LABEL } from "@/components/delivery";
import { useToast } from "@/hooks";
import { useAuthStore } from "@/stores/auth";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, fetchProofObjectUrl, uploadDeliveryProof } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format";
import { getCurrentLocation } from "@/lib/geolocation";
import type { DeliveryData, DeliveryFailureReason } from "@/types/api";

const FAILURE_OPTIONS: Array<{ value: DeliveryFailureReason; label: string }> = [
  { value: "CLIENTE_AUSENTE", label: "Cliente ausente" },
  { value: "ENDERECO_NAO_LOCALIZADO", label: "Endereço não localizado" },
  { value: "RECUSA_DO_RECEBEDOR", label: "Recusa do recebedor" },
  { value: "AREA_INACESSIVEL", label: "Área inacessível" },
  { value: "PROBLEMA_DE_ACESSO", label: "Problema de acesso" },
  { value: "OUTRO", label: "Outro (descrever)" },
];

/** Tela da entrega (/motoboy/entregas/:id): iniciar, confirmar ou marcar não entregue. */
export default function DriverDeliveryPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const driverName = useAuthStore((s) => s.user?.name);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reason, setReason] = useState<DeliveryFailureReason | "">("");
  const [failNotes, setFailNotes] = useState("");
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  useEffect(() => {
    applySeo({ title: "Entrega", noindex: true, canonicalPath: `/motoboy/entregas/${id}` });
  }, [id]);

  const query = useQuery({
    queryKey: queryKeys.driverDelivery(id),
    queryFn: () => api.get<DeliveryData>(`/delivery/${id}`),
    enabled: Boolean(id),
  });

  const delivery = query.data;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.driverDelivery(id) });
    void queryClient.invalidateQueries({ queryKey: ["driver", "deliveries"] });
  };

  // Carrega a prova privada (arquivo autenticado) quando a entrega foi concluída.
  useEffect(() => {
    if (!delivery?.hasProof || delivery.status !== "DELIVERED") {
      setProofUrl(null);
      return;
    }
    let url: string | null = null;
    let active = true;
    fetchProofObjectUrl(delivery.id)
      .then((objectUrl) => {
        if (!active) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        url = objectUrl;
        setProofUrl(objectUrl);
      })
      .catch(() => setProofUrl(null));
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [delivery?.hasProof, delivery?.status, delivery?.id]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const start = useMutation({
    mutationFn: async () => {
      const geo = await getCurrentLocation();
      return api.post(`/delivery/${id}/start`, geo ?? {});
    },
    onSuccess: () => {
      invalidate();
      toast.success("Entrega iniciada", "Boa rota!");
    },
    onError: (error) => toast.error("Não foi possível iniciar", errorMessage(error)),
  });

  const confirm = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Envie a foto da entrega.");
      const { proofPhotoRef } = await uploadDeliveryProof(id, file);
      const geo = await getCurrentLocation();
      return api.post(`/delivery/${id}/confirm`, {
        recipientName: recipient.trim(),
        notes: notes.trim() || null,
        proofPhotoRef,
        ...(geo ?? {}),
      });
    },
    onSuccess: () => {
      invalidate();
      setConfirmOpen(false);
      setRecipient("");
      setNotes("");
      setFile(null);
      toast.success("Entrega confirmada");
    },
    onError: (error) => toast.error("Não foi possível confirmar", errorMessage(error)),
  });

  const fail = useMutation({
    mutationFn: async () => {
      const geo = await getCurrentLocation();
      return api.post(`/delivery/${id}/fail`, {
        reason,
        notes: failNotes.trim() || null,
        ...(geo ?? {}),
      });
    },
    onSuccess: () => {
      invalidate();
      setFailOpen(false);
      setReason("");
      setFailNotes("");
      toast.success("Entrega marcada como não entregue");
    },
    onError: (error) => toast.error("Não foi possível registrar", errorMessage(error)),
  });

  const enderecoLinha = useMemo(() => {
    if (!delivery) return "";
    return [
      `${delivery.endereco.logradouro ?? ""}, ${delivery.endereco.numero ?? ""}`.trim().replace(/,\s*$/, ""),
      delivery.endereco.complemento,
      delivery.endereco.bairro,
      `${delivery.endereco.cidade ?? ""}/${delivery.endereco.uf ?? ""}`,
      delivery.endereco.cep ? `CEP ${delivery.endereco.cep}` : null,
    ]
      .filter(Boolean)
      .join(" • ");
  }, [delivery]);

  if (query.isLoading) return <LoadingBlock label="Carregando entrega…" />;
  if (query.error || !delivery) {
    return (
      <Alert tone="danger" title="Não foi possível carregar a entrega">
        {query.error ? errorMessage(query.error) : "Entrega não encontrada."}
        <div className="mt-3">
          <Button size="sm" variant="ghost" onClick={() => navigate("/motoboy/entregas")}>
            Voltar
          </Button>
        </div>
      </Alert>
    );
  }

  const canStart = delivery.status === "ASSIGNED";
  const canAct = delivery.status === "ASSIGNED" || delivery.status === "OUT_FOR_DELIVERY";

  return (
    <div className="stack stack-4">
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate(-1)}>
        <Icon name="arrowLeft" size={16} /> Voltar
      </button>

      <div className="row row-between row-wrap" style={{ gap: "var(--space-2)" }}>
        <h1 className="text-xl">Pedido #{delivery.orderNumber}</h1>
        <DeliveryStatusBadge status={delivery.status} />
      </div>

      <Card className="stack stack-3">
        <div>
          <p className="field__label">Cliente</p>
          <p className="text-sm text-strong">{delivery.cliente.nome}</p>
          <a href={`tel:${delivery.cliente.telefone}`} className="text-sm">
            <Icon name="phone" size={14} /> {delivery.cliente.telefone}
          </a>
        </div>

        <div>
          <p className="field__label">Entrega</p>
          <p className="text-sm text-muted">{enderecoLinha || "Endereço não informado"}</p>
        </div>

        {delivery.observacoes ? (
          <Alert tone="info" title="Observação">
            {delivery.observacoes}
          </Alert>
        ) : null}

        {delivery.failureReason ? (
          <Alert tone="warning" title="Motivo da não entrega">
            {delivery.failureReason}
          </Alert>
        ) : null}
      </Card>

      {delivery.status === "DELIVERED" ? (
        <Card className="stack stack-3">
          <div className="row row-3 row-wrap">
            <Badge tone="success" icon="checkCircle">Entregue</Badge>
            <Badge tone="neutral">Recebido por: {delivery.recipientName ?? "—"}</Badge>
          </div>
          <p className="text-sm text-muted">Entregue em {formatDateTime(delivery.deliveredAt)}</p>
          {delivery.latitude != null && delivery.longitude != null ? (
            <p className="text-xs text-muted">
              Local: {delivery.latitude.toFixed(5)}, {delivery.longitude.toFixed(5)}
              {delivery.locationAccuracy != null ? ` (±${Math.round(delivery.locationAccuracy)} m)` : ""}
            </p>
          ) : null}
          {proofUrl ? (
            <img src={proofUrl} alt="Prova de entrega" style={{ width: "100%", borderRadius: "var(--radius-md)" }} />
          ) : null}
        </Card>
      ) : null}

      {canAct ? (
        <div className="stack stack-3">
          {canStart ? (
            <Button size="lg" block icon="truck" loading={start.isPending} onClick={() => start.mutate()}>
              Iniciar entrega
            </Button>
          ) : null}

          <Button size="lg" block icon="check" variant="primary" onClick={() => setConfirmOpen(true)}>
            Confirmar entrega
          </Button>

          <Button size="lg" block icon="alertTriangle" variant="ghost" onClick={() => setFailOpen(true)}>
            Não entregue
          </Button>
        </div>
      ) : null}

      <Card className="stack stack-3">
        <h2 className="text-lg">Histórico</h2>
        {delivery.events.length === 0 ? (
          <p className="text-sm text-muted">Sem eventos registrados.</p>
        ) : (
          <ol className="stack stack-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {delivery.events.map((event) => (
              <li key={event.id} className="row row-between text-sm" style={{ gap: "var(--space-2)" }}>
                <span className="text-strong">{DELIVERY_STATUS_LABEL[event.status]}</span>
                <span className="text-muted text-xs">
                  {event.notes ? `${event.notes} • ` : ""}
                  {formatDateTime(event.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* -------------------------------------------------------- Confirmar */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirmar entrega"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              loading={confirm.isPending}
              disabled={recipient.trim().length < 2 || !file}
              onClick={() => confirm.mutate()}
            >
              Confirmar entrega
            </Button>
          </>
        }
      >
        <div className="stack stack-4">
          <Input
            label="Quem recebeu?"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="Ex.: João da Silva / Maria - esposa / Porteiro"
            required
          />

          <div className="field">
            <span className="field__label">Foto da entrega</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {preview ? (
              <img src={preview} alt="Prévia da foto" style={{ width: "100%", marginTop: "var(--space-2)", borderRadius: "var(--radius-md)" }} />
            ) : (
              <p className="field__hint">Tire a foto da entrega (câmera traseira quando disponível).</p>
            )}
          </div>

          <Textarea
            label="Observação"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Opcional. Ex.: recebido pelo porteiro."
          />

          <p className="text-xs text-muted">
            A localização e o horário são registrados pelo servidor no momento da confirmação.
          </p>
        </div>
      </Modal>

      {/* -------------------------------------------------------- Não entrega */}
      <Modal
        open={failOpen}
        onClose={() => setFailOpen(false)}
        title="Marcar como não entregue"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFailOpen(false)}>
              Cancelar
            </Button>
            <Button
              loading={fail.isPending}
              disabled={!reason || (reason === "OUTRO" && failNotes.trim().length < 3)}
              onClick={() => fail.mutate()}
            >
              Registrar não entrega
            </Button>
          </>
        }
      >
        <div className="stack stack-4">
          <Select
            label="Motivo"
            value={reason}
            onChange={(event) => setReason(event.target.value as DeliveryFailureReason)}
            options={FAILURE_OPTIONS}
            placeholder="Selecione o motivo"
            required
          />
          <Textarea
            label={reason === "OUTRO" ? "Descrição (obrigatória)" : "Observação"}
            value={failNotes}
            onChange={(event) => setFailNotes(event.target.value)}
            rows={3}
            required={reason === "OUTRO"}
          />
        </div>
      </Modal>

      <p className="text-xs text-muted text-center">Entregador: {driverName ?? "—"}</p>
    </div>
  );
}
