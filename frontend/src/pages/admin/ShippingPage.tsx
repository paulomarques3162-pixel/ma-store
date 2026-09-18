import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Input,
  Modal,
  Select,
  Switch,
} from "@/components/ui";
import { AdminPageHeader, AdminTable, RowActions, type AdminColumn } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { UFS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import type { ShippingMethod } from "@/types/api";

/** Modalidades de frete. Sem ao menos uma ativa, o checkout é bloqueado. */
export default function AdminShippingPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ShippingMethod | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    carrier: "",
    price: "",
    freeAbove: "",
    minDays: "1",
    maxDays: "5",
    regions: [] as string[],
    active: true,
    position: "0",
  });

  const methods = useQuery({
    queryKey: queryKeys.adminShipping,
    queryFn: () => api.get<ShippingMethod[]>("/admin/shipping"),
  });

  useEffect(() => {
    applySeo({ title: "Fretes", noindex: true, canonicalPath: "/admin/fretes" });
  }, []);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminShipping });
    void queryClient.invalidateQueries({ queryKey: queryKeys.shippingMethods });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        description: form.description || undefined,
        carrier: form.carrier || undefined,
        price: Number(form.price),
        freeAbove: form.freeAbove ? Number(form.freeAbove) : null,
        minDays: Number(form.minDays),
        maxDays: Number(form.maxDays),
        regions: form.regions,
        active: form.active,
        position: Number(form.position),
      };
      return editing ? api.patch(`/admin/shipping/${editing.id}`, payload) : api.post("/admin/shipping", payload);
    },
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      setEditing(null);
      toast.success(editing ? "Modalidade atualizada" : "Modalidade criada");
    },
    onError: (error) => toast.error("Não foi possível salvar", errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/shipping/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success("Modalidade removida ou desativada");
    },
    onError: (error) => toast.error("Não foi possível excluir", errorMessage(error)),
  });

  const toggleActive = useMutation({
    mutationFn: (method: ShippingMethod) => api.patch(`/admin/shipping/${method.id}`, { active: !method.active }),
    onSuccess: invalidate,
    onError: (error) => toast.error("Não foi possível alterar", errorMessage(error)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: "",
      description: "",
      carrier: "",
      price: "",
      freeAbove: "",
      minDays: "1",
      maxDays: "5",
      regions: [],
      active: true,
      position: "0",
    });
    setModalOpen(true);
  };

  const openEdit = (method: ShippingMethod) => {
    setEditing(method);
    setForm({
      name: method.name,
      description: method.description ?? "",
      carrier: method.carrier ?? "",
      price: String(method.price),
      freeAbove: method.freeAbove ? String(method.freeAbove) : "",
      minDays: String(method.minDays),
      maxDays: String(method.maxDays),
      regions: method.regions ?? [],
      active: method.active,
      position: String(method.position ?? 0),
    });
    setModalOpen(true);
  };

  const activeCount = (methods.data ?? []).filter((method) => method.active).length;

  const columns: Array<AdminColumn<ShippingMethod>> = [
    {
      key: "name",
      header: "Modalidade",
      render: (method) => (
        <div>
          <div className="text-sm text-strong">{method.name}</div>
          {method.carrier ? <div className="text-xs text-muted">{method.carrier}</div> : null}
        </div>
      ),
    },
    {
      key: "price",
      header: "Valor",
      align: "right",
      render: (method) => <span className="text-sm text-strong tabular">{formatCurrency(method.price)}</span>,
    },
    {
      key: "freeAbove",
      header: "Frete grátis",
      align: "right",
      hideOnMobile: true,
      render: (method) => (
        <span className="text-sm text-muted">
          {method.freeAbove ? `acima de ${formatCurrency(method.freeAbove)}` : "—"}
        </span>
      ),
    },
    {
      key: "deadline",
      header: "Prazo",
      render: (method) => (
        <span className="text-sm text-muted">
          {method.minDays === method.maxDays ? `${method.minDays} dia(s)` : `${method.minDays} a ${method.maxDays} dias`}
        </span>
      ),
    },
    {
      key: "regions",
      header: "Regiões",
      hideOnMobile: true,
      render: (method) => (
        <span className="text-xs text-muted">
          {method.regions && method.regions.length > 0 ? method.regions.join(", ") : "Todas as UFs"}
        </span>
      ),
    },
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
          <Button size="sm" variant="ghost" icon={method.active ? "eyeOff" : "eye"} iconOnly onClick={() => toggleActive.mutate(method)}>
            {method.active ? "Desativar" : "Ativar"}
          </Button>
          <Button size="sm" variant="ghost" icon="trash" iconOnly onClick={() => remove.mutate(method.id)}>
            Excluir
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Fretes"
        subtitle="Modalidades, prazos e regiões atendidas."
        actions={
          <Button icon="plus" onClick={openCreate}>
            Nova modalidade
          </Button>
        }
      />

      {activeCount === 0 ? (
        <Alert tone="warning" title="Nenhuma modalidade ativa">
          Sem uma modalidade de frete ativa que atenda o CEP do cliente, o checkout não é concluído. O sistema não
          inventa um valor de frete.
        </Alert>
      ) : null}

      <div className="mt-5">
        <AdminTable
          columns={columns}
          rows={methods.data ?? []}
          loading={methods.isLoading}
          error={methods.error}
          requestId={errorRequestId(methods.error)}
          onRetry={() => void methods.refetch()}
          emptyTitle="Nenhuma modalidade cadastrada"
          emptyText="Cadastre ao menos uma modalidade para permitir vendas com entrega."
          emptyIcon="truck"
          emptyAction={
            <Button icon="plus" onClick={openCreate}>
              Criar modalidade
            </Button>
          }
        />
      </div>

      <Alert tone="info" title="Produtos sem frete">
        Cada produto tem a opção “Possui frete”. Se todos os itens do pedido não exigirem entrega, o frete é zerado
        automaticamente no checkout.
      </Alert>

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        title={editing ? `Editar ${editing.name}` : "Nova modalidade de frete"}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button loading={save.isPending} disabled={!form.name.trim() || !form.price} onClick={() => save.mutate()}>
              Salvar modalidade
            </Button>
          </>
        }
      >
        <div className="stack stack-4">
          <Input label="Nome" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Entrega padrão" required />
          <Input
            label="Transportadora"
            value={form.carrier}
            onChange={(event) => setForm({ ...form, carrier: event.target.value })}
            placeholder="Ex.: Correios"
            hint="Opcional"
          />
          <Input
            label="Descrição"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            hint="Opcional — aparece para o cliente no checkout."
          />

          <div className="grid grid-2">
            <Input
              label="Valor do frete (R$)"
              type="number"
              step="0.01"
              min="0"
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
              required
            />
            <Input
              label="Frete grátis acima de (R$)"
              type="number"
              step="0.01"
              min="0"
              value={form.freeAbove}
              onChange={(event) => setForm({ ...form, freeAbove: event.target.value })}
              hint="Deixe vazio para não aplicar."
            />
          </div>

          <div className="grid grid-2">
            <Input
              label="Prazo mínimo (dias)"
              type="number"
              min="0"
              value={form.minDays}
              onChange={(event) => setForm({ ...form, minDays: event.target.value })}
            />
            <Input
              label="Prazo máximo (dias)"
              type="number"
              min="0"
              value={form.maxDays}
              onChange={(event) => setForm({ ...form, maxDays: event.target.value })}
            />
          </div>

          <div className="field">
            <span className="field__label">Regiões atendidas</span>
            <p className="field__hint">Sem seleção, a modalidade atende todas as UFs.</p>
            <div className="row row-2 row-wrap mt-2">
              {UFS.map((uf) => (
                <Checkbox
                  key={uf}
                  label={uf}
                  checked={form.regions.includes(uf)}
                  onChange={() =>
                    setForm({
                      ...form,
                      regions: form.regions.includes(uf) ? form.regions.filter((item) => item !== uf) : [...form.regions, uf],
                    })
                  }
                />
              ))}
            </div>
          </div>

          <div className="grid grid-2">
            <Input
              label="Ordem de exibição"
              type="number"
              min="0"
              value={form.position}
              onChange={(event) => setForm({ ...form, position: event.target.value })}
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

          <Switch label="Modalidade ativa" checked={form.active} onChange={(value) => setForm({ ...form, active: value })} />
        </div>
      </Modal>
    </div>
  );
}
