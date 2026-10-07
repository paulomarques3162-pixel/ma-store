import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, LoadingBlock, Modal, Select } from "@/components/ui";
import { AdminPageHeader } from "@/components/admin/kit";
import { DeliveryStatusBadge, DELIVERY_STATUS_LABEL } from "@/components/delivery";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, fetchProofObjectUrl } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format";
import type { DeliveryData, Driver } from "@/types/api";

/** Admin → detalhe da entrega: prova de entrega + histórico + reatribuição. */
export default function AdminDeliveryDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState("");

  useEffect(() => {
    applySeo({ title: "Detalhe da entrega", noindex: true, canonicalPath: `/admin/entregas/${id}` });
  }, [id]);

  const query = useQuery({
    queryKey: queryKeys.adminDelivery(id),
    queryFn: () => api.get<{ delivery: DeliveryData }>(`/admin/delivery/${id}`),
    enabled: Boolean(id),
  });

  const drivers = useQuery({
    queryKey: queryKeys.adminDrivers,
    queryFn: () => api.get<{ drivers: Driver[] }>("/admin/drivers"),
  });

  const delivery = query.data?.delivery;

  // Registra auditoria de visualização da prova (quando existir).
  useEffect(() => {
    if (delivery?.hasProof) void api.post(`/admin/delivery/${id}/proof-viewed`, {}).catch(() => undefined);
  }, [delivery?.hasProof, id]);

  useEffect(() => {
    if (!delivery?.hasProof) {
      setProofUrl(null);
      return;
    }
    let url: string | null = null;
    let active = true;
    fetchProofObjectUrl(delivery.id, { admin: true })
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
  }, [delivery?.hasProof, delivery?.id]);

  const reassign = useMutation({
    mutationFn: () => api.post(`/admin/delivery/${id}/reassign`, { driverId: selectedDriver }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminDelivery(id) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "deliveries"] });
      setReassignOpen(false);
      toast.success("Entrega reatribuída");
    },
    onError: (error) => toast.error("Não foi possível reatribuir", errorMessage(error)),
  });

  if (query.isLoading) return <LoadingBlock label="Carregando entrega…" />;
  if (query.error || !delivery) {
    return (
      <Alert tone="danger" title="Não foi possível carregar">
        {query.error ? errorMessage(query.error) : "Entrega não encontrada."}
        <div className="mt-3">
          <Button size="sm" variant="ghost" onClick={() => navigate("/admin/entregas")}>
            Voltar
          </Button>
        </div>
      </Alert>
    );
  }

  const activeDrivers = (drivers.data?.drivers ?? []).filter((driver) => driver.status === "ACTIVE");

  return (
    <div>
      <AdminPageHeader
        title={`Entrega #${delivery.orderNumber}`}
        subtitle="Prova de entrega, histórico e reatribuição."
        actions={
          <>
            <Button variant="ghost" icon="arrowLeft" onClick={() => navigate("/admin/entregas")}>
              Voltar
            </Button>
            {delivery.status !== "DELIVERED" ? (
              <Button
                icon="truck"
                onClick={() => {
                  setSelectedDriver(delivery.driver?.id ?? activeDrivers[0]?.id ?? "");
                  setReassignOpen(true);
                }}
              >
                Reatribuir
              </Button>
            ) : null}
          </>
        }
      />

      <div className="stack stack-4">
        <Card className="stack stack-3">
          <div className="row row-between row-wrap">
            <DeliveryStatusBadge status={delivery.status} />
            <span className="text-sm text-muted">Criada em {formatDateTime(delivery.createdAt)}</span>
          </div>
          <div className="grid grid-2">
            <Field label="Entregador" value={delivery.driver?.name ?? "—"} />
            <Field label="Cliente" value={delivery.cliente.nome} />
            <Field label="Telefone" value={delivery.cliente.telefone} />
            <Field
              label="Endereço"
              value={[
                `${delivery.endereco.logradouro ?? ""}, ${delivery.endereco.numero ?? ""}`,
                delivery.endereco.complemento,
                delivery.endereco.bairro,
                `${delivery.endereco.cidade ?? ""}/${delivery.endereco.uf ?? ""}`,
                delivery.endereco.cep ? `CEP ${delivery.endereco.cep}` : null,
              ]
                .filter(Boolean)
                .join(" • ")}
            />
          </div>
          {delivery.observacoes ? <Alert tone="info" title="Observação">{delivery.observacoes}</Alert> : null}
        </Card>

        {delivery.status === "DELIVERED" ? (
          <Card className="stack stack-3">
            <h2 className="text-lg">Prova de entrega</h2>
            <div className="grid grid-2">
              <Field label="Quem recebeu" value={delivery.recipientName ?? "—"} />
              <Field label="Data/hora" value={formatDateTime(delivery.deliveredAt)} />
              <Field
                label="Localização"
                value={
                  delivery.latitude != null && delivery.longitude != null
                    ? `${delivery.latitude.toFixed(5)}, ${delivery.longitude.toFixed(5)}`
                    : "Não registrada"
                }
              />
              <Field
                label="Precisão GPS"
                value={delivery.locationAccuracy != null ? `±${Math.round(delivery.locationAccuracy)} m` : "—"}
              />
            </div>
            {delivery.latitude != null && delivery.longitude != null ? (
              <a
                className="btn btn--ghost btn--sm"
                href={`https://www.openstreetmap.org/?mlat=${delivery.latitude}&mlon=${delivery.longitude}#map=17/${delivery.latitude}/${delivery.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                Abrir localização no mapa
              </a>
            ) : null}
            {proofUrl ? (
              <img src={proofUrl} alt="Prova de entrega" style={{ width: "100%", maxWidth: 520, borderRadius: "var(--radius-md)" }} />
            ) : (
              <p className="text-sm text-muted">Foto não disponível.</p>
            )}
          </Card>
        ) : null}

        {delivery.latitude != null && delivery.longitude != null ? (
          <Card className="stack stack-3">
            <h2 className="text-lg">Localização da entrega</h2>
            <DeliveryMap latitude={delivery.latitude} longitude={delivery.longitude} />
            <p className="text-xs text-muted">
              {delivery.latitude.toFixed(5)}, {delivery.longitude.toFixed(5)}
              {delivery.locationAccuracy != null ? ` • precisão ±${Math.round(delivery.locationAccuracy)} m` : ""}
            </p>
          </Card>
        ) : null}

        <Card className="stack stack-3">
          <h2 className="text-lg">Histórico</h2>
          {delivery.events.length === 0 ? (
            <p className="text-sm text-muted">Sem eventos.</p>
          ) : (
            <ol className="stack stack-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {delivery.events.map((event) => (
                <li key={event.id} className="row row-between text-sm">
                  <Badge tone="neutral">{DELIVERY_STATUS_LABEL[event.status]}</Badge>
                  <span className="text-xs text-muted">
                    {event.notes ? `${event.notes} • ` : ""}
                    {formatDateTime(event.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Modal
        open={reassignOpen}
        onClose={() => setReassignOpen(false)}
        title="Reatribuir entrega"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReassignOpen(false)}>
              Cancelar
            </Button>
            <Button loading={reassign.isPending} disabled={!selectedDriver} onClick={() => reassign.mutate()}>
              Reatribuir
            </Button>
          </>
        }
      >
        <Select
          label="Novo entregador"
          value={selectedDriver}
          onChange={(event) => setSelectedDriver(event.target.value)}
          options={activeDrivers.map((driver) => ({ value: driver.id, label: driver.name }))}
          placeholder="Selecione o entregador"
          required
        />
      </Modal>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm text-strong">{value}</p>
    </div>
  );
}

/**
 * Mapa simples sem dependência: embed do OpenStreetMap com marcador na
 * coordenada registrada pelo entregador. Somente ADMIN vê esta tela.
 */
function DeliveryMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const delta = 0.01;
  const bbox = `${longitude - delta},${latitude - delta},${longitude + delta},${latitude + delta}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${latitude},${longitude}`;
  return (
    <iframe
      title="Mapa da localização da entrega"
      src={src}
      loading="lazy"
      style={{ width: "100%", height: 280, border: 0, borderRadius: "var(--radius-md)" }}
    />
  );
}
