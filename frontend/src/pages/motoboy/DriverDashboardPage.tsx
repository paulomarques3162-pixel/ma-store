import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Icon, LoadingBlock } from "@/components/ui";
import { DeliveryCard } from "@/components/delivery";
import { useAuthStore } from "@/stores/auth";
import { applySeo } from "@/lib/seo";
import { api, errorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import type { DeliveryListItem, DriverCounters } from "@/types/api";

type DriverDeliveriesResponse = { deliveries: DeliveryListItem[]; counters: DriverCounters };

/** Painel inicial do entregador: contadores + entregas ativas. */
export default function DriverDashboardPage() {
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    applySeo({ title: "Painel do entregador", noindex: true, canonicalPath: "/motoboy" });
  }, []);

  const query = useQuery({
    queryKey: queryKeys.driverDeliveries(),
    queryFn: () => api.get<DriverDeliveriesResponse>("/delivery/my"),
    refetchOnMount: "always",
  });

  if (query.isLoading) return <LoadingBlock label="Carregando suas entregas…" />;
  if (query.error) {
    return (
      <Alert tone="danger" title="Não foi possível carregar">
        {errorMessage(query.error)}
        <div className="mt-3">
          <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      </Alert>
    );
  }

  const counters = query.data?.counters;
  const active = (query.data?.deliveries ?? []).filter(
    (delivery) => delivery.status === "ASSIGNED" || delivery.status === "OUT_FOR_DELIVERY",
  );

  return (
    <div className="stack stack-5">
      <div>
        <h1 className="text-xl">Olá, {user?.name ?? "entregador"}</h1>
        <p className="text-sm text-muted">Estas são as suas entregas.</p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-3)" }}>
        <Counter label="Pendentes" value={counters?.assigned ?? 0} icon="clock" />
        <Counter label="Em rota" value={counters?.outForDelivery ?? 0} icon="truck" />
        <Counter label="Concluídas" value={counters?.delivered ?? 0} icon="checkCircle" />
        <Counter label="Não entregues" value={counters?.failed ?? 0} icon="alertTriangle" />
      </div>

      <div className="stack stack-3">
        <h2 className="text-lg">Entregas ativas</h2>
        {active.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">Você não tem entregas ativas no momento.</p>
          </Card>
        ) : (
          active.map((delivery) => <DeliveryCard key={delivery.id} delivery={delivery} />)
        )}
      </div>
    </div>
  );
}

function Counter({ label, value, icon }: { label: string; value: number; icon: "clock" | "truck" | "checkCircle" | "alertTriangle" }) {
  return (
    <Card>
      <div className="row row-between" style={{ alignItems: "center" }}>
        <span className="text-xs text-muted">{label}</span>
        <Icon name={icon} size={18} />
      </div>
      <div className="text-2xl text-strong" style={{ fontWeight: 700 }}>
        {value}
      </div>
    </Card>
  );
}
