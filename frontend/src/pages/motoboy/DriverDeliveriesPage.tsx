import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, LoadingBlock, Tabs } from "@/components/ui";
import { DeliveryCard, DELIVERY_STATUS_LABEL } from "@/components/delivery";
import { applySeo } from "@/lib/seo";
import { api, errorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import type { DeliveryListItem, DeliveryStatus, DriverCounters } from "@/types/api";

type Filter = "all" | DeliveryStatus;

type DriverDeliveriesResponse = { deliveries: DeliveryListItem[]; counters: DriverCounters };

/** Lista completa de entregas do entregador, com filtro por status. */
export default function DriverDeliveriesPage() {
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    applySeo({ title: "Minhas entregas", noindex: true, canonicalPath: "/motoboy/entregas" });
  }, []);

  const query = useQuery({
    queryKey: queryKeys.driverDeliveries(filter),
    queryFn: () =>
      api.get<DriverDeliveriesResponse>("/delivery/my", {
        query: filter === "all" ? undefined : { status: filter },
      }),
  });

  if (query.isLoading) return <LoadingBlock label="Carregando entregas…" />;
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

  const deliveries = query.data?.deliveries ?? [];

  return (
    <div className="stack stack-4">
      <h1 className="text-xl">Minhas entregas</h1>

      <Tabs
        ariaLabel="Filtrar entregas"
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: "all", label: "Todas" },
          { value: "ASSIGNED", label: "Atribuídas" },
          { value: "OUT_FOR_DELIVERY", label: "Em rota" },
          { value: "DELIVERED", label: "Concluídas" },
          { value: "FAILED", label: "Não entregues" },
        ]}
      />

      {deliveries.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Nenhuma entrega{filter !== "all" ? ` em "${DELIVERY_STATUS_LABEL[filter as DeliveryStatus]}"` : ""}.
          </p>
        </Card>
      ) : (
        <div className="stack stack-3">
          {deliveries.map((delivery) => (
            <DeliveryCard key={delivery.id} delivery={delivery} />
          ))}
        </div>
      )}
    </div>
  );
}
