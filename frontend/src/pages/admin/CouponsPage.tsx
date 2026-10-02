import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  Input,
  Modal,
  Select,
  Switch,
  Checkbox,
} from "@/components/ui";
import { AdminPageHeader, AdminTable, RowActions, type AdminColumn } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Brand, Category, Coupon } from "@/types/api";

/** Cupons: criação, edição, ativação e elegibilidade por produto/categoria. */
export default function AdminCouponsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Coupon | null>(null);

  const [form, setForm] = useState({
    code: "",
    description: "",
    type: "PERCENT" as "PERCENT" | "FIXED",
    value: "",
    minOrderValue: "",
    maxUses: "",
    maxUsesPerUser: "",
    appliesToAll: true,
    appliesToShipping: false,
    startsAt: "",
    endsAt: "",
    active: true,
  });

  const coupons = useQuery({
    queryKey: queryKeys.adminCoupons({ search }),
    queryFn: () => api.list<Coupon[]>("/admin/coupons", { query: { search: search || undefined, perPage: 50 } }),
    placeholderData: (previous) => previous,
  });

  const categories = useQuery({ queryKey: queryKeys.adminCategories, queryFn: () => api.get<Category[]>("/admin/categories") });
  const brands = useQuery({ queryKey: queryKeys.adminBrands, queryFn: () => api.get<Brand[]>("/admin/brands") });

  useEffect(() => {
    applySeo({ title: "Cupons", noindex: true, canonicalPath: "/admin/cupons" });
  }, []);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["admin", "coupons"] });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        code: form.code.trim().toUpperCase(),
        description: form.description || undefined,
        type: form.type,
        value: Number(form.value),
        minOrderValue: form.minOrderValue ? Number(form.minOrderValue) : null,
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        maxUsesPerUser: form.maxUsesPerUser ? Number(form.maxUsesPerUser) : null,
        appliesToAll: form.appliesToAll,
        appliesToShipping: form.appliesToShipping,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        active: form.active,
      };
      return editing ? api.patch(`/admin/coupons/${editing.id}`, payload) : api.post("/admin/coupons", payload);
    },
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      setEditing(null);
      toast.success(editing ? "Cupom atualizado" : "Cupom criado");
    },
    onError: (error) => toast.error("Não foi possível salvar", errorMessage(error)),
  });

  const toggle = useMutation({
    mutationFn: (coupon: Coupon) => api.post(`/admin/coupons/${coupon.id}/toggle`),
    onSuccess: (_data, coupon) => {
      invalidate();
      toast.success(coupon.active ? "Cupom desativado" : "Cupom ativado", coupon.code);
    },
    onError: (error) => toast.error("Não foi possível alterar", errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/coupons/${id}`),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      toast.success("Cupom removido ou desativado");
    },
    onError: (error) => toast.error("Não foi possível excluir", errorMessage(error)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({
      code: "",
      description: "",
      type: "PERCENT",
      value: "",
      minOrderValue: "",
      maxUses: "",
      maxUsesPerUser: "",
      appliesToAll: true,
      appliesToShipping: false,
      startsAt: "",
      endsAt: "",
      active: true,
    });
    setModalOpen(true);
  };

  const openEdit = (coupon: Coupon) => {
    setEditing(coupon);
    setForm({
      code: coupon.code,
      description: coupon.description ?? "",
      type: coupon.type,
      value: String(coupon.value),
      minOrderValue: coupon.minOrderValue ? String(coupon.minOrderValue) : "",
      maxUses: coupon.maxUses ? String(coupon.maxUses) : "",
      maxUsesPerUser: coupon.maxUsesPerUser ? String(coupon.maxUsesPerUser) : "",
      appliesToAll: coupon.appliesToAll,
      appliesToShipping: coupon.appliesToShipping,
      startsAt: coupon.startsAt ? coupon.startsAt.slice(0, 10) : "",
      endsAt: coupon.endsAt ? coupon.endsAt.slice(0, 10) : "",
      active: coupon.active,
    });
    setModalOpen(true);
  };

  const columns: Array<AdminColumn<Coupon>> = [
    {
      key: "code",
      header: "Cupom",
      render: (coupon) => (
        <div>
          <div className="text-sm text-strong" style={{ fontFamily: "var(--font-mono)" }}>
            {coupon.code}
          </div>
          {coupon.description ? <div className="text-xs text-muted clamp-1">{coupon.description}</div> : null}
        </div>
      ),
    },
    {
      key: "value",
      header: "Desconto",
      align: "right",
      render: (coupon) => (
        <span className="text-sm text-strong">
          {coupon.type === "PERCENT" ? `${coupon.value}%` : formatCurrency(coupon.value)}
        </span>
      ),
    },
    {
      key: "rules",
      header: "Regras",
      hideOnMobile: true,
      render: (coupon) => (
        <div className="text-xs text-muted stack stack-1">
          {coupon.minOrderValue ? <span>Mínimo {formatCurrency(coupon.minOrderValue)}</span> : null}
          {coupon.maxUses ? <span>Limite total: {coupon.maxUses}</span> : null}
          {coupon.maxUsesPerUser ? <span>Por cliente: {coupon.maxUsesPerUser}</span> : null}
          <span>{coupon.appliesToAll ? "Todo o catálogo" : "Produtos/categorias específicos"}</span>
          {coupon.appliesToShipping ? <span>Desconta o frete</span> : null}
        </div>
      ),
    },
    {
      key: "usage",
      header: "Usos",
      align: "right",
      render: (coupon) => (
        <span className="text-sm">
          {coupon.usesCount}
          {coupon.maxUses ? ` / ${coupon.maxUses}` : ""}
        </span>
      ),
    },
    {
      key: "period",
      header: "Vigência",
      hideOnMobile: true,
      render: (coupon) => (
        <span className="text-xs text-muted">
          {coupon.startsAt ? formatDate(coupon.startsAt) : "—"} até {coupon.endsAt ? formatDate(coupon.endsAt) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (coupon) => (
        <div className="stack stack-1">
          <Badge tone={coupon.active ? "success" : "neutral"}>{coupon.active ? "Ativo" : "Inativo"}</Badge>
          {coupon.isDemo ? <Badge tone="warning">DEMO</Badge> : null}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (coupon) => (
        <RowActions>
          <Button size="sm" variant="ghost" icon="edit" iconOnly onClick={() => openEdit(coupon)}>
            Editar
          </Button>
          <Button size="sm" variant="ghost" icon={coupon.active ? "eyeOff" : "eye"} iconOnly onClick={() => toggle.mutate(coupon)}>
            {coupon.active ? "Desativar" : "Ativar"}
          </Button>
          <Button size="sm" variant="ghost" icon="trash" iconOnly onClick={() => setDeleteTarget(coupon)}>
            Excluir
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Cupons"
        subtitle="As regras são sempre revalidadas no backend, no momento da compra."
        actions={
          <Button icon="plus" onClick={openCreate}>
            Novo cupom
          </Button>
        }
      />

      <form className="admin-filters" onSubmit={(event) => event.preventDefault()}>
        <Input
          label="Buscar"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Código do cupom"
          icon="search"
        />
      </form>

      <AdminTable
        columns={columns}
        rows={coupons.data?.data ?? []}
        loading={coupons.isLoading}
        error={coupons.error}
        requestId={errorRequestId(coupons.error)}
        onRetry={() => void coupons.refetch()}
        emptyTitle="Nenhum cupom cadastrado"
        emptyText="Crie cupons para suas campanhas e promoções."
        emptyIcon="percent"
        emptyAction={
          <Button icon="plus" onClick={openCreate}>
            Criar cupom
          </Button>
        }
      />

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        title={editing ? `Editar cupom ${editing.code}` : "Novo cupom"}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              loading={save.isPending}
              disabled={!form.code.trim() || !form.value}
              onClick={() => save.mutate()}
            >
              Salvar cupom
            </Button>
          </>
        }
      >
        <div className="stack stack-4">
          <div className="grid grid-2">
            <Input
              label="Código"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              placeholder="Ex.: PROMO10"
              hint="O cliente digita este código no carrinho."
              required
            />
            <Select
              label="Tipo de desconto"
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value as "PERCENT" | "FIXED" })}
              options={[
                { value: "PERCENT", label: "Percentual (%)" },
                { value: "FIXED", label: "Valor fixo (R$)" },
              ]}
            />
          </div>

          <Input
            label={form.type === "PERCENT" ? "Percentual de desconto (%)" : "Valor do desconto (R$)"}
            type="number"
            step="0.01"
            min="0"
            value={form.value}
            onChange={(event) => setForm({ ...form, value: event.target.value })}
            error={form.type === "PERCENT" && Number(form.value) > 100 ? "O percentual não pode passar de 100%." : undefined}
            required
          />

          <Input
            label="Descrição interna"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            hint="Aparece apenas no painel."
          />

          <div className="grid grid-2">
            <Input
              label="Valor mínimo do pedido"
              type="number"
              step="0.01"
              min="0"
              value={form.minOrderValue}
              onChange={(event) => setForm({ ...form, minOrderValue: event.target.value })}
              hint="Opcional"
            />
            <Input
              label="Limite total de usos"
              type="number"
              min="1"
              value={form.maxUses}
              onChange={(event) => setForm({ ...form, maxUses: event.target.value })}
              hint="Opcional"
            />
          </div>

          <Input
            label="Limite por cliente"
            type="number"
            min="1"
            value={form.maxUsesPerUser}
            onChange={(event) => setForm({ ...form, maxUsesPerUser: event.target.value })}
            hint="Opcional — quantas vezes o mesmo cliente pode usar."
          />

          <div className="grid grid-2">
            <Input
              label="Início da vigência"
              type="date"
              value={form.startsAt}
              onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
              hint="Opcional"
            />
            <Input
              label="Fim da vigência"
              type="date"
              value={form.endsAt}
              onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
              hint="Opcional"
            />
          </div>

          <Switch
            label="Aplica a todo o catálogo"
            checked={form.appliesToAll}
            onChange={(value) => setForm({ ...form, appliesToAll: value })}
            hint="Se desmarcado, o cupom vale apenas para produtos/categorias selecionados no backend."
          />

          <Switch
            label="Desconta também o frete"
            checked={form.appliesToShipping}
            onChange={(value) => setForm({ ...form, appliesToShipping: value })}
          />

          <Checkbox
            label="Cupom ativo"
            checked={form.active}
            onChange={(event) => setForm({ ...form, active: event.target.checked })}
          />

          {!form.appliesToAll ? (
            <Alert tone="info" title="Elegibilidade por produto/categoria">
              A seleção fina de produtos e categorias é feita pela API (`productIds`/`categoryIds`). Há{" "}
              {(categories.data ?? []).length} categorias e {(brands.data ?? []).length} marcas cadastradas no catálogo.
            </Alert>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir cupom"
        message={
          deleteTarget && deleteTarget.usesCount > 0
            ? `"${deleteTarget.code}" já foi utilizado e será apenas desativado, para preservar o histórico.`
            : `"${deleteTarget?.code}" será excluído permanentemente.`
        }
        confirmLabel="Confirmar"
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export { Icon };
