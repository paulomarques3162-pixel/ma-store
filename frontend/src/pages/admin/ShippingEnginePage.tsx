import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Switch,
  Tabs,
} from "@/components/ui";
import { AdminPageHeader, AdminTable, RowActions, type AdminColumn } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, maskCep, onlyDigits } from "@/lib/format";
import { formatShippingDeadline } from "@/lib/shipping";
import type {
  LocalShippingQuote,
  Product,
  ShippingCepException,
  ShippingEngineSettings,
  ShippingMethod,
  ShippingWeightRule,
  ShippingZone,
} from "@/types/api";

type TabId = "config" | "methods" | "zonas" | "regras" | "excecoes" | "simulador";

function formatWeightGrams(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`;
  return `${grams} g`;
}

/**
 * Shipping Engine PRÓPRIO — regras locais cadastradas no PostgreSQL.
 *
 * Nenhum valor comercial vem do código: o administrador cadastra modalidades,
 * zonas, pesos, preços, prazos e exceções de CEP. Sem cadastro, o checkout
 * responde "frete ainda não configurado" (nunca um valor fictício).
 */
export default function AdminShippingEnginePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>("config");

  useEffect(() => {
    applySeo({ title: "Frete (motor próprio)", noindex: true, canonicalPath: "/admin/frete-engine" });
  }, []);

  const settings = useQuery({
    queryKey: queryKeys.adminShippingEngineSettings,
    queryFn: () => api.get<ShippingEngineSettings>("/admin/shipping/settings"),
  });
  const methods = useQuery({
    queryKey: queryKeys.adminShippingEngineMethods,
    queryFn: () => api.get<ShippingMethod[]>("/admin/shipping/methods"),
  });
  const zones = useQuery({
    queryKey: queryKeys.adminShippingEngineZones,
    queryFn: () => api.get<ShippingZone[]>("/admin/shipping/zones"),
  });
  const rules = useQuery({
    queryKey: queryKeys.adminShippingEngineRules(),
    queryFn: () => api.get<ShippingWeightRule[]>("/admin/shipping/rules"),
  });
  const exceptions = useQuery({
    queryKey: queryKeys.adminShippingEngineExceptions,
    queryFn: () => api.get<ShippingCepException[]>("/admin/shipping/exceptions"),
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "shipping-engine"] });
  };

  return (
    <div>
      <AdminPageHeader
        title="Frete — motor próprio"
        subtitle="Modalidades, regiões/CEP, faixas de peso, exceções e prazos configurados por você."
      />

      {settings.data && !settings.data.configured ? (
        <Alert tone="info" title="Ainda não configurado">
          Cadastre as configurações, uma modalidade, uma região e uma faixa de peso. Enquanto isso, o checkout informa
          que o frete ainda não está configurado — o sistema não inventa valores.
        </Alert>
      ) : null}

      <div className="mt-5">
        <Tabs
          ariaLabel="Seções do motor de frete"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "config", label: "Configurações" },
            { value: "methods", label: "Modalidades", badge: methods.data?.length },
            { value: "zonas", label: "Regiões/CEP", badge: zones.data?.length },
            { value: "regras", label: "Regras de peso", badge: rules.data?.length },
            { value: "excecoes", label: "Exceções de CEP", badge: exceptions.data?.length },
            { value: "simulador", label: "Simulador" },
          ]}
        />
      </div>

      <div className="mt-5 stack stack-5">
        {tab === "config" ? <SettingsTab settings={settings} onSaved={invalidateAll} /> : null}
        {tab === "methods" ? <MethodsTab methods={methods} onChanged={invalidateAll} /> : null}
        {tab === "zonas" ? <ZonesTab zones={zones} onChanged={invalidateAll} /> : null}
        {tab === "regras" ? (
          <WeightRulesTab rules={rules} zones={zones.data ?? []} methods={methods.data ?? []} onChanged={invalidateAll} />
        ) : null}
        {tab === "excecoes" ? (
          <CepExceptionsTab exceptions={exceptions} methods={methods.data ?? []} onChanged={invalidateAll} />
        ) : null}
        {tab === "simulador" ? <SimulatorTab /> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Configurações                                                               */
/* -------------------------------------------------------------------------- */

function SettingsTab({
  settings,
  onSaved,
}: {
  settings: ReturnType<typeof useQuery<ShippingEngineSettings>>;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    enabled: false,
    originZipCode: "",
    packagePaddingGrams: "",
    defaultHandlingDays: "",
    defaultDeliveryDays: "",
    freeShippingEnabled: false,
    freeShippingMinimumOrderValue: "",
    showEstimateDisclaimer: true,
  });

  useEffect(() => {
    if (!settings.data) return;
    setForm({
      enabled: settings.data.enabled,
      originZipCode: settings.data.originZipCode ?? "",
      packagePaddingGrams: settings.data.packagePaddingGrams != null ? String(settings.data.packagePaddingGrams) : "",
      defaultHandlingDays: settings.data.defaultHandlingDays != null ? String(settings.data.defaultHandlingDays) : "",
      defaultDeliveryDays: settings.data.defaultDeliveryDays != null ? String(settings.data.defaultDeliveryDays) : "",
      freeShippingEnabled: settings.data.freeShippingEnabled,
      freeShippingMinimumOrderValue:
        settings.data.freeShippingMinimumOrderValue != null ? String(settings.data.freeShippingMinimumOrderValue) : "",
      showEstimateDisclaimer: settings.data.showEstimateDisclaimer,
    });
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put("/admin/shipping/settings", {
        enabled: form.enabled,
        originZipCode: form.originZipCode ? onlyDigits(form.originZipCode) : null,
        packagePaddingGrams: form.packagePaddingGrams ? Number(form.packagePaddingGrams) : null,
        defaultHandlingDays: form.defaultHandlingDays ? Number(form.defaultHandlingDays) : null,
        defaultDeliveryDays: form.defaultDeliveryDays ? Number(form.defaultDeliveryDays) : null,
        freeShippingEnabled: form.freeShippingEnabled,
        freeShippingMinimumOrderValue: form.freeShippingMinimumOrderValue
          ? Number(form.freeShippingMinimumOrderValue)
          : null,
        showEstimateDisclaimer: form.showEstimateDisclaimer,
      }),
    onSuccess: () => {
      onSaved();
      toast.success("Configurações salvas");
    },
    onError: (error) => toast.error("Não foi possível salvar", errorMessage(error)),
  });

  return (
    <Card className="stack stack-4">
      <div>
        <h3 className="card__title">Configurações gerais</h3>
        <p className="text-sm text-muted mt-1">
          Ative o motor próprio e informe os parâmetros usados no cálculo. Nada é preenchido automaticamente.
        </p>
      </div>

      <Switch
        label="Usar o motor de frete próprio no checkout"
        checked={form.enabled}
        onChange={(value) => setForm({ ...form, enabled: value })}
        hint="Quando desativado, o checkout mantém o comportamento anterior."
      />

      <div className="grid grid-2">
        <Input
          label="CEP de origem (da loja)"
          value={form.originZipCode}
          onChange={(event) => setForm({ ...form, originZipCode: maskCep(event.target.value) })}
          placeholder="00000-000"
          inputMode="numeric"
          hint="Opcional — usado apenas como referência interna."
        />
        <Input
          label="Peso de embalagem (gramas)"
          type="number"
          min="0"
          value={form.packagePaddingGrams}
          onChange={(event) => setForm({ ...form, packagePaddingGrams: event.target.value })}
          hint="Somado ao peso dos itens. Deixe vazio para não somar."
        />
      </div>

      <div className="grid grid-2">
        <Input
          label="Dias de manuseio"
          type="number"
          min="0"
          value={form.defaultHandlingDays}
          onChange={(event) => setForm({ ...form, defaultHandlingDays: event.target.value })}
          hint="Somado ao prazo da modalidade."
        />
        <Input
          label="Prazo padrão (dias úteis)"
          type="number"
          min="0"
          value={form.defaultDeliveryDays}
          onChange={(event) => setForm({ ...form, defaultDeliveryDays: event.target.value })}
          hint="Usado quando a faixa de peso não define prazo."
        />
      </div>

      <div className="grid grid-2">
        <Switch
          label="Oferecer frete grátis acima do valor mínimo"
          checked={form.freeShippingEnabled}
          onChange={(value) => setForm({ ...form, freeShippingEnabled: value })}
        />
        <Input
          label="Valor mínimo para frete grátis (R$)"
          type="number"
          min="0"
          step="0.01"
          value={form.freeShippingMinimumOrderValue}
          onChange={(event) => setForm({ ...form, freeShippingMinimumOrderValue: event.target.value })}
          hint="Só é aplicado quando o frete grátis está ativado."
        />
      </div>

      <Switch
        label="Exibir aviso de que valor e prazo são estimados"
        checked={form.showEstimateDisclaimer}
        onChange={(value) => setForm({ ...form, showEstimateDisclaimer: value })}
      />

      <div className="row row-2">
        <Button loading={save.isPending} onClick={() => save.mutate()} icon="check">
          Salvar configurações
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Modalidades                                                                 */
/* -------------------------------------------------------------------------- */

function MethodsTab({
  methods,
  onChanged,
}: {
  methods: ReturnType<typeof useQuery<ShippingMethod[]>>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ShippingMethod | null>(null);
  const [form, setForm] = useState({ name: "", code: "", description: "", active: true, priority: "0" });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", code: "", description: "", active: true, priority: "0" });
    setModalOpen(true);
  };
  const openEdit = (method: ShippingMethod) => {
    setEditing(method);
    setForm({
      name: method.name,
      code: method.code ?? "",
      description: method.description ?? "",
      active: method.active,
      priority: String(method.priority ?? 0),
    });
    setModalOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase() || null,
        description: form.description || null,
        active: form.active,
        priority: Number(form.priority) || 0,
      };
      return editing
        ? api.put(`/admin/shipping/methods/${editing.id}`, payload)
        : api.post("/admin/shipping/methods", payload);
    },
    onSuccess: () => {
      onChanged();
      setModalOpen(false);
      toast.success(editing ? "Modalidade atualizada" : "Modalidade criada");
    },
    onError: (error) => toast.error("Não foi possível salvar a modalidade", errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/shipping/methods/${id}`),
    onSuccess: () => {
      onChanged();
      toast.success("Modalidade removida ou desativada");
    },
    onError: (error) => toast.error("Não foi possível remover", errorMessage(error)),
  });

  const columns: Array<AdminColumn<ShippingMethod>> = [
    { key: "name", header: "Modalidade", render: (method) => <span className="text-sm text-strong">{method.name}</span> },
    { key: "code", header: "Código", render: (method) => <span className="text-sm text-muted">{method.code ?? "—"}</span> },
    { key: "description", header: "Descrição", hideOnMobile: true, render: (method) => <span className="text-sm text-muted">{method.description ?? "—"}</span> },
    { key: "priority", header: "Prioridade", align: "right", render: (method) => <span className="text-sm">{method.priority ?? 0}</span> },
    {
      key: "status",
      header: "Status",
      render: (method) => <Badge tone={method.active ? "success" : "neutral"}>{method.active ? "Ativa" : "Inativa"}</Badge>,
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (method) => (
        <RowActions>
          <Button size="sm" variant="ghost" icon="edit" iconOnly onClick={() => openEdit(method)}>
            Editar
          </Button>
          <Button size="sm" variant="ghost" icon="trash" iconOnly onClick={() => remove.mutate(method.id)}>
            Excluir
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <Card>
      <div className="row row-between row-wrap mb-4">
        <div>
          <h3 className="card__title">Modalidades de entrega</h3>
          <p className="text-sm text-muted mt-1">O preço de cada modalidade vem das regras de peso/CEP.</p>
        </div>
        <Button icon="plus" onClick={openCreate}>
          Nova modalidade
        </Button>
      </div>

      <AdminTable
        columns={columns}
        rows={methods.data ?? []}
        loading={methods.isLoading}
        error={methods.error}
        requestId={errorRequestId(methods.error)}
        onRetry={() => void methods.refetch()}
        emptyTitle="Nenhuma modalidade cadastrada"
        emptyText="Cadastre modalidades como Econômico, Padrão e Expresso."
        emptyIcon="truck"
        emptyAction={
          <Button icon="plus" onClick={openCreate}>
            Criar modalidade
          </Button>
        }
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Editar ${editing.name}` : "Nova modalidade"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
              Salvar modalidade
            </Button>
          </>
        }
      >
        <div className="stack stack-4">
          <Input label="Nome" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          <Input
            label="Código"
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
            placeholder="ECONOMIC / STANDARD / EXPRESS / SAME_DAY / PICKUP"
            hint="Identificador estável da modalidade."
          />
          <Input label="Descrição" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} hint="Opcional" />
          <div className="grid grid-2">
            <Input
              label="Prioridade"
              type="number"
              min="0"
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value })}
              hint="Maior prioridade aparece/é considerada antes."
            />
            <Select
              label="Ativa"
              value={form.active ? "true" : "false"}
              onChange={(event) => setForm({ ...form, active: event.target.value === "true" })}
              options={[
                { value: "true", label: "Sim" },
                { value: "false", label: "Não" },
              ]}
            />
          </div>
        </div>
      </Modal>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Zonas                                                                       */
/* -------------------------------------------------------------------------- */

function ZonesTab({
  zones,
  onChanged,
}: {
  zones: ReturnType<typeof useQuery<ShippingZone[]>>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ShippingZone | null>(null);
  const [form, setForm] = useState({ name: "", state: "", description: "", zipCodeFrom: "", zipCodeTo: "", active: true, priority: "0" });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", state: "", description: "", zipCodeFrom: "", zipCodeTo: "", active: true, priority: "0" });
    setModalOpen(true);
  };
  const openEdit = (zone: ShippingZone) => {
    setEditing(zone);
    setForm({
      name: zone.name,
      state: zone.state ?? "",
      description: zone.description ?? "",
      zipCodeFrom: maskCep(String(zone.zipCodeFrom).padStart(8, "0")),
      zipCodeTo: maskCep(String(zone.zipCodeTo).padStart(8, "0")),
      active: zone.active,
      priority: String(zone.priority),
    });
    setModalOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        state: form.state.trim().toUpperCase() || null,
        description: form.description || null,
        zipCodeFrom: onlyDigits(form.zipCodeFrom),
        zipCodeTo: onlyDigits(form.zipCodeTo),
        active: form.active,
        priority: Number(form.priority) || 0,
      };
      return editing ? api.put(`/admin/shipping/zones/${editing.id}`, payload) : api.post("/admin/shipping/zones", payload);
    },
    onSuccess: () => {
      onChanged();
      setModalOpen(false);
      toast.success(editing ? "Região atualizada" : "Região criada");
    },
    onError: (error) => toast.error("Não foi possível salvar a região", errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/shipping/zones/${id}`),
    onSuccess: () => {
      onChanged();
      toast.success("Região removida");
    },
    onError: (error) => toast.error("Não foi possível remover", errorMessage(error)),
  });

  const columns: Array<AdminColumn<ShippingZone>> = [
    { key: "name", header: "Região", render: (zone) => <span className="text-sm text-strong">{zone.name}</span> },
    { key: "state", header: "UF", render: (zone) => <span className="text-sm text-muted">{zone.state ?? "—"}</span> },
    {
      key: "range",
      header: "Faixa de CEP",
      render: (zone) => (
        <span className="text-sm text-muted tabular">
          {maskCep(String(zone.zipCodeFrom).padStart(8, "0"))} – {maskCep(String(zone.zipCodeTo).padStart(8, "0"))}
        </span>
      ),
    },
    { key: "priority", header: "Prioridade", align: "right", render: (zone) => <span className="text-sm">{zone.priority}</span> },
    {
      key: "status",
      header: "Status",
      render: (zone) => <Badge tone={zone.active ? "success" : "neutral"}>{zone.active ? "Ativa" : "Inativa"}</Badge>,
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (zone) => (
        <RowActions>
          <Button size="sm" variant="ghost" icon="edit" iconOnly onClick={() => openEdit(zone)}>
            Editar
          </Button>
          <Button size="sm" variant="ghost" icon="trash" iconOnly onClick={() => remove.mutate(zone.id)}>
            Excluir
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <Card>
      <div className="row row-between row-wrap mb-4">
        <div>
          <h3 className="card__title">Regiões / faixas de CEP</h3>
          <p className="text-sm text-muted mt-1">Regiões ativas não podem ter faixas sobrepostas.</p>
        </div>
        <Button icon="plus" onClick={openCreate}>
          Nova região
        </Button>
      </div>

      <AdminTable
        columns={columns}
        rows={zones.data ?? []}
        loading={zones.isLoading}
        error={zones.error}
        requestId={errorRequestId(zones.error)}
        onRetry={() => void zones.refetch()}
        emptyTitle="Nenhuma região cadastrada"
        emptyText="Cadastre as faixas de CEP atendidas pela loja."
        emptyIcon="truck"
        emptyAction={
          <Button icon="plus" onClick={openCreate}>
            Criar região
          </Button>
        }
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Editar ${editing.name}` : "Nova região"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              loading={save.isPending}
              disabled={!form.name.trim() || onlyDigits(form.zipCodeFrom).length !== 8 || onlyDigits(form.zipCodeTo).length !== 8}
              onClick={() => save.mutate()}
            >
              Salvar região
            </Button>
          </>
        }
      >
        <div className="stack stack-4">
          <div className="grid grid-2">
            <Input label="Nome" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            <Input
              label="UF"
              value={form.state}
              onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase().slice(0, 2) })}
              placeholder="SP"
              hint="Opcional"
            />
          </div>
          <Input label="Descrição" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} hint="Opcional" />
          <div className="grid grid-2">
            <Input
              label="CEP inicial"
              value={form.zipCodeFrom}
              onChange={(event) => setForm({ ...form, zipCodeFrom: maskCep(event.target.value) })}
              placeholder="00000-000"
              inputMode="numeric"
              required
            />
            <Input
              label="CEP final"
              value={form.zipCodeTo}
              onChange={(event) => setForm({ ...form, zipCodeTo: maskCep(event.target.value) })}
              placeholder="00000-000"
              inputMode="numeric"
              required
            />
          </div>
          <div className="grid grid-2">
            <Input
              label="Prioridade"
              type="number"
              min="0"
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value })}
            />
            <Select
              label="Ativa"
              value={form.active ? "true" : "false"}
              onChange={(event) => setForm({ ...form, active: event.target.value === "true" })}
              options={[
                { value: "true", label: "Sim" },
                { value: "false", label: "Não" },
              ]}
            />
          </div>
        </div>
      </Modal>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Regras de peso                                                              */
/* -------------------------------------------------------------------------- */

function WeightRulesTab({
  rules,
  zones,
  methods,
  onChanged,
}: {
  rules: ReturnType<typeof useQuery<ShippingWeightRule[]>>;
  zones: ShippingZone[];
  methods: ShippingMethod[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ShippingWeightRule | null>(null);
  const [form, setForm] = useState({
    zoneId: "",
    shippingMethodId: "",
    minWeightGrams: "0",
    maxWeightGrams: "",
    price: "",
    deliveryDays: "",
    active: true,
  });

  const openCreate = () => {
    setEditing(null);
    setForm({
      zoneId: zones[0]?.id ?? "",
      shippingMethodId: methods[0]?.id ?? "",
      minWeightGrams: "0",
      maxWeightGrams: "",
      price: "",
      deliveryDays: "",
      active: true,
    });
    setModalOpen(true);
  };
  const openEdit = (rule: ShippingWeightRule) => {
    setEditing(rule);
    setForm({
      zoneId: rule.zoneId,
      shippingMethodId: rule.shippingMethodId ?? "",
      minWeightGrams: String(rule.minWeightGrams),
      maxWeightGrams: String(rule.maxWeightGrams),
      price: String(rule.price),
      deliveryDays: rule.deliveryDays != null ? String(rule.deliveryDays) : "",
      active: rule.active,
    });
    setModalOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        zoneId: form.zoneId,
        shippingMethodId: form.shippingMethodId || null,
        minWeightGrams: Number(form.minWeightGrams) || 0,
        maxWeightGrams: Number(form.maxWeightGrams) || 0,
        price: Number(form.price),
        deliveryDays: form.deliveryDays !== "" ? Number(form.deliveryDays) : null,
        active: form.active,
      };
      return editing ? api.put(`/admin/shipping/rules/${editing.id}`, payload) : api.post("/admin/shipping/rules", payload);
    },
    onSuccess: () => {
      onChanged();
      setModalOpen(false);
      toast.success(editing ? "Regra atualizada" : "Regra criada");
    },
    onError: (error) => toast.error("Não foi possível salvar a regra", errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/shipping/rules/${id}`),
    onSuccess: () => {
      onChanged();
      toast.success("Regra removida");
    },
    onError: (error) => toast.error("Não foi possível remover", errorMessage(error)),
  });

  const zoneOptions = useMemo(() => zones.map((zone) => ({ value: zone.id, label: zone.name })), [zones]);
  const methodOptions = useMemo(
    () => methods.map((method) => ({ value: method.id, label: method.code ? `${method.name} (${method.code})` : method.name })),
    [methods],
  );

  const columns: Array<AdminColumn<ShippingWeightRule>> = [
    {
      key: "zone",
      header: "Região",
      render: (rule) => <span className="text-sm text-strong">{rule.zone?.name ?? zones.find((z) => z.id === rule.zoneId)?.name ?? rule.zoneId}</span>,
    },
    {
      key: "method",
      header: "Modalidade",
      render: (rule) => (
        <span className="text-sm text-muted">
          {rule.shippingMethod?.name ?? methods.find((m) => m.id === rule.shippingMethodId)?.name ?? "—"}
        </span>
      ),
    },
    {
      key: "weight",
      header: "Faixa de peso",
      render: (rule) => (
        <span className="text-sm text-muted tabular">
          {formatWeightGrams(rule.minWeightGrams)} – {formatWeightGrams(rule.maxWeightGrams)}
        </span>
      ),
    },
    { key: "price", header: "Preço", align: "right", render: (rule) => <span className="text-sm text-strong tabular">{formatCurrency(rule.price)}</span> },
    {
      key: "deadline",
      header: "Prazo",
      render: (rule) => <span className="text-sm text-muted">{rule.deliveryDays != null ? formatShippingDeadline(rule.deliveryDays) : "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (rule) => <Badge tone={rule.active ? "success" : "neutral"}>{rule.active ? "Ativa" : "Inativa"}</Badge>,
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (rule) => (
        <RowActions>
          <Button size="sm" variant="ghost" icon="edit" iconOnly onClick={() => openEdit(rule)}>
            Editar
          </Button>
          <Button size="sm" variant="ghost" icon="trash" iconOnly onClick={() => remove.mutate(rule.id)}>
            Excluir
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <Card>
      <div className="row row-between row-wrap mb-4">
        <div>
          <h3 className="card__title">Regras de peso</h3>
          <p className="text-sm text-muted mt-1">Zona + modalidade + faixa de peso, com preço e prazo.</p>
        </div>
        <Button icon="plus" onClick={openCreate} disabled={zones.length === 0 || methods.length === 0}>
          Nova faixa
        </Button>
      </div>

      {zones.length === 0 || methods.length === 0 ? (
        <Alert tone="warning" title="Cadastre região e modalidade primeiro">
          As faixas de peso vinculam uma região a uma modalidade.
        </Alert>
      ) : (
        <AdminTable
          columns={columns}
          rows={rules.data ?? []}
          loading={rules.isLoading}
          error={rules.error}
          requestId={errorRequestId(rules.error)}
          onRetry={() => void rules.refetch()}
          emptyTitle="Nenhuma faixa de peso"
          emptyText="Cadastre faixas como 0–1 kg, 1–3 kg, etc., com o preço de cada uma."
          emptyAction={
            <Button icon="plus" onClick={openCreate}>
              Criar faixa
            </Button>
          }
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar faixa de peso" : "Nova faixa de peso"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button loading={save.isPending} disabled={!form.zoneId || !form.shippingMethodId || form.price === ""} onClick={() => save.mutate()}>
              Salvar faixa
            </Button>
          </>
        }
      >
        <div className="stack stack-4">
          <Select
            label="Região"
            value={form.zoneId}
            onChange={(event) => setForm({ ...form, zoneId: event.target.value })}
            options={zoneOptions}
            placeholder="Selecione a região"
            required
          />
          <Select
            label="Modalidade"
            value={form.shippingMethodId}
            onChange={(event) => setForm({ ...form, shippingMethodId: event.target.value })}
            options={methodOptions}
            placeholder="Selecione a modalidade"
            required
          />
          <div className="grid grid-2">
            <Input
              label="Peso mínimo (gramas)"
              type="number"
              min="0"
              value={form.minWeightGrams}
              onChange={(event) => setForm({ ...form, minWeightGrams: event.target.value })}
              required
            />
            <Input
              label="Peso máximo (gramas)"
              type="number"
              min="0"
              value={form.maxWeightGrams}
              onChange={(event) => setForm({ ...form, maxWeightGrams: event.target.value })}
              required
            />
          </div>
          <div className="grid grid-2">
            <Input
              label="Preço (R$)"
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
              required
            />
            <Input
              label="Prazo (dias úteis)"
              type="number"
              min="0"
              value={form.deliveryDays}
              onChange={(event) => setForm({ ...form, deliveryDays: event.target.value })}
              hint="Vazio usa o prazo padrão."
            />
          </div>
          <Switch label="Faixa ativa" checked={form.active} onChange={(value) => setForm({ ...form, active: value })} />
        </div>
      </Modal>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Exceções de CEP                                                             */
/* -------------------------------------------------------------------------- */

function CepExceptionsTab({
  exceptions,
  methods,
  onChanged,
}: {
  exceptions: ReturnType<typeof useQuery<ShippingCepException[]>>;
  methods: ShippingMethod[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ShippingCepException | null>(null);
  const [form, setForm] = useState({ cep: "", shippingMethodId: "", priceOverride: "", deliveryDaysOverride: "", active: true });

  const openCreate = () => {
    setEditing(null);
    setForm({ cep: "", shippingMethodId: methods[0]?.id ?? "", priceOverride: "", deliveryDaysOverride: "", active: true });
    setModalOpen(true);
  };
  const openEdit = (exception: ShippingCepException) => {
    setEditing(exception);
    setForm({
      cep: maskCep(exception.cep),
      shippingMethodId: exception.shippingMethodId,
      priceOverride: exception.priceOverride != null ? String(exception.priceOverride) : "",
      deliveryDaysOverride: exception.deliveryDaysOverride != null ? String(exception.deliveryDaysOverride) : "",
      active: exception.active,
    });
    setModalOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        cep: onlyDigits(form.cep),
        shippingMethodId: form.shippingMethodId,
        priceOverride: form.priceOverride !== "" ? Number(form.priceOverride) : null,
        deliveryDaysOverride: form.deliveryDaysOverride !== "" ? Number(form.deliveryDaysOverride) : null,
        active: form.active,
      };
      return editing
        ? api.put(`/admin/shipping/exceptions/${editing.id}`, payload)
        : api.post("/admin/shipping/exceptions", payload);
    },
    onSuccess: () => {
      onChanged();
      setModalOpen(false);
      toast.success(editing ? "Exceção atualizada" : "Exceção criada");
    },
    onError: (error) => toast.error("Não foi possível salvar a exceção", errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/shipping/exceptions/${id}`),
    onSuccess: () => {
      onChanged();
      toast.success("Exceção removida");
    },
    onError: (error) => toast.error("Não foi possível remover", errorMessage(error)),
  });

  const methodOptions = useMemo(
    () => methods.map((method) => ({ value: method.id, label: method.code ? `${method.name} (${method.code})` : method.name })),
    [methods],
  );

  const columns: Array<AdminColumn<ShippingCepException>> = [
    { key: "cep", header: "CEP", render: (exception) => <span className="text-sm text-strong tabular">{maskCep(exception.cep)}</span> },
    {
      key: "method",
      header: "Modalidade",
      render: (exception) => (
        <span className="text-sm text-muted">
          {exception.shippingMethod?.name ?? methods.find((m) => m.id === exception.shippingMethodId)?.name ?? "—"}
        </span>
      ),
    },
    {
      key: "price",
      header: "Preço especial",
      align: "right",
      render: (exception) => (
        <span className="text-sm text-strong tabular">
          {exception.priceOverride != null ? formatCurrency(exception.priceOverride) : "—"}
        </span>
      ),
    },
    {
      key: "deadline",
      header: "Prazo especial",
      render: (exception) => (
        <span className="text-sm text-muted">
          {exception.deliveryDaysOverride != null ? formatShippingDeadline(exception.deliveryDaysOverride) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (exception) => <Badge tone={exception.active ? "success" : "neutral"}>{exception.active ? "Ativa" : "Inativa"}</Badge>,
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (exception) => (
        <RowActions>
          <Button size="sm" variant="ghost" icon="edit" iconOnly onClick={() => openEdit(exception)}>
            Editar
          </Button>
          <Button size="sm" variant="ghost" icon="trash" iconOnly onClick={() => remove.mutate(exception.id)}>
            Excluir
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <Card>
      <div className="row row-between row-wrap mb-4">
        <div>
          <h3 className="card__title">Exceções de CEP</h3>
          <p className="text-sm text-muted mt-1">Sobrescreva preço e/ou prazo de uma modalidade em um CEP específico.</p>
        </div>
        <Button icon="plus" onClick={openCreate} disabled={methods.length === 0}>
          Nova exceção
        </Button>
      </div>

      {methods.length === 0 ? (
        <Alert tone="warning" title="Cadastre uma modalidade primeiro">
          As exceções de CEP são vinculadas a uma modalidade.
        </Alert>
      ) : (
        <AdminTable
          columns={columns}
          rows={exceptions.data ?? []}
          loading={exceptions.isLoading}
          error={exceptions.error}
          requestId={errorRequestId(exceptions.error)}
          onRetry={() => void exceptions.refetch()}
          emptyTitle="Nenhuma exceção de CEP"
          emptyText="Exceções são opcionais e valem para CEPs específicos."
          emptyAction={
            <Button icon="plus" onClick={openCreate}>
              Criar exceção
            </Button>
          }
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Editar exceção de ${maskCep(editing.cep)}` : "Nova exceção de CEP"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              loading={save.isPending}
              disabled={onlyDigits(form.cep).length !== 8 || !form.shippingMethodId}
              onClick={() => save.mutate()}
            >
              Salvar exceção
            </Button>
          </>
        }
      >
        <div className="stack stack-4">
          <Input
            label="CEP"
            value={form.cep}
            onChange={(event) => setForm({ ...form, cep: maskCep(event.target.value) })}
            placeholder="00000-000"
            inputMode="numeric"
            required
          />
          <Select
            label="Modalidade"
            value={form.shippingMethodId}
            onChange={(event) => setForm({ ...form, shippingMethodId: event.target.value })}
            options={methodOptions}
            placeholder="Selecione a modalidade"
            required
          />
          <div className="grid grid-2">
            <Input
              label="Preço especial (R$)"
              type="number"
              min="0"
              step="0.01"
              value={form.priceOverride}
              onChange={(event) => setForm({ ...form, priceOverride: event.target.value })}
              hint="Vazio mantém o preço da regra."
            />
            <Input
              label="Prazo especial (dias úteis)"
              type="number"
              min="0"
              value={form.deliveryDaysOverride}
              onChange={(event) => setForm({ ...form, deliveryDaysOverride: event.target.value })}
              hint="Vazio mantém o prazo da regra."
            />
          </div>
          <Switch label="Exceção ativa" checked={form.active} onChange={(value) => setForm({ ...form, active: value })} />
        </div>
      </Modal>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Simulador                                                                   */
/* -------------------------------------------------------------------------- */

function SimulatorTab() {
  const [cep, setCep] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [result, setResult] = useState<LocalShippingQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const products = useQuery({
    queryKey: ["admin", "products", "simulator"],
    queryFn: () => api.get<Product[]>("/admin/products", { query: { perPage: 100, includeInactive: true } }),
    staleTime: 60_000,
  });

  const simulate = useMutation({
    mutationFn: () =>
      api.post<LocalShippingQuote>("/admin/shipping/simulate", {
        cep: onlyDigits(cep),
        items: [{ productId, quantity: Number(quantity) || 1 }],
      }),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      setErrorCode(null);
    },
    onError: (err) => {
      setResult(null);
      setError(errorMessage(err));
      setErrorCode((err as { code?: string }).code ?? null);
    },
  });

  return (
    <Card className="stack stack-4">
      <div>
        <h3 className="card__title">Simulador de frete</h3>
        <p className="text-sm text-muted mt-1">Mostra exatamente qual zona, modalidades e regras foram aplicadas.</p>
      </div>

      <div className="grid grid-2">
        <Input
          label="CEP de destino"
          value={cep}
          onChange={(event) => setCep(maskCep(event.target.value))}
          placeholder="00000-000"
          inputMode="numeric"
        />
        <Input
          label="Quantidade"
          type="number"
          min="1"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </div>

      <Select
        label="Produto"
        value={productId}
        onChange={(event) => setProductId(event.target.value)}
        options={(products.data ?? []).map((product) => ({ value: product.id, label: product.name }))}
        placeholder={products.isLoading ? "Carregando produtos…" : "Selecione o produto"}
      />

      <div className="row row-2">
        <Button
          icon="truck"
          loading={simulate.isPending}
          disabled={onlyDigits(cep).length !== 8 || !productId}
          onClick={() => simulate.mutate()}
        >
          Simular frete
        </Button>
      </div>

      {error ? (
        <Alert tone="warning" title="Não foi possível cotar">
          {error}
          {errorCode ? <div className="text-xs text-muted mt-1">Código: {errorCode}</div> : null}
        </Alert>
      ) : null}

      {result ? (
        <div className="stack stack-3">
          <div className="row row-2 row-wrap">
            <Badge tone="accent" icon="truck">Zona: {result.zone?.name ?? "—"}</Badge>
            <Badge tone="neutral">Peso: {formatWeightGrams(result.weightGrams)}</Badge>
          </div>

          {result.options.length === 0 ? (
            <Alert tone="info">Nenhuma modalidade disponível para esta combinação.</Alert>
          ) : (
            result.options.map((option) => (
              <div key={option.methodId} className="row row-between">
                <span className="text-sm text-muted">
                  {option.name} {option.code ? `(${option.code})` : ""} • regra {option.ruleId?.slice(0, 8) ?? "—"}
                </span>
                <span className="text-sm text-strong tabular">
                  {option.price === 0 ? "Grátis" : formatCurrency(option.price)} • {formatShippingDeadline(option.deliveryDays)}
                </span>
              </div>
            ))
          )}

          {result.disclaimer ? <p className="text-xs text-muted">{result.disclaimer}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
