import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  Input,
  Modal,
  ProductImage,
  Select,
} from "@/components/ui";
import { AdminPageHeader, AdminTable, RowActions, type AdminColumn } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Product } from "@/types/api";

type Row = Product & { reservedStock: number; soldStock: number };

/** Lista de produtos do painel, com filtros e ações de gestão. */
export default function AdminProductsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [stockModal, setStockModal] = useState<Row | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);

  useEffect(() => {
    applySeo({ title: "Produtos", noindex: true, canonicalPath: "/admin/produtos" });
  }, []);

  const products = useQuery({
    queryKey: queryKeys.adminProducts({ search, statusFilter, page }),
    queryFn: () =>
      api.list<Row[]>("/admin/products", {
        query: {
          search: search || undefined,
          page,
          perPage: 20,
          includeInactive: statusFilter !== "active" ? "true" : undefined,
          lowStock: statusFilter === "low" ? "true" : undefined,
        },
      }),
    placeholderData: (previous) => previous,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminDashboard });
  };

  const toggleActive = useMutation({
    mutationFn: (product: Row) => api.patch(`/admin/products/${product.id}`, { active: !product.active }),
    onSuccess: (_data, product) => {
      invalidate();
      toast.success(product.active ? "Produto desativado" : "Produto ativado", product.name);
    },
    onError: (error) => toast.error("Não foi possível alterar", errorMessage(error)),
  });

  const duplicate = useMutation({
    mutationFn: (product: Row) => api.post<{ id: string }>(`/admin/products/${product.id}/duplicate`),
    onSuccess: () => {
      invalidate();
      toast.success("Produto duplicado", "A cópia foi criada inativa, com estoque zero.");
    },
    onError: (error) => toast.error("Não foi possível duplicar", errorMessage(error)),
  });

  const updateStock = useMutation({
    mutationFn: ({ id, stock, minStock, reason }: { id: string; stock: number; minStock: number; reason: string }) =>
      api.patch(`/admin/products/${id}/stock`, { stock, minStock, reason }),
    onSuccess: () => {
      invalidate();
      setStockModal(null);
      toast.success("Estoque atualizado");
    },
    onError: (error) => toast.error("Não foi possível atualizar o estoque", errorMessage(error)),
  });

  const deleteProduct = useMutation({
    mutationFn: ({ id, hard }: { id: string; hard: boolean }) =>
      api.delete(`/admin/products/${id}${hard ? "?hard=true" : ""}`),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      toast.success("Produto desativado", "Ele não aparece mais na loja.");
    },
    onError: (error) => toast.error("Não foi possível excluir", errorMessage(error)),
  });

  const rows = (products.data?.data ?? []).filter((product) => {
    if (statusFilter === "active") return product.active;
    if (statusFilter === "inactive") return !product.active;
    if (statusFilter === "low") {
      const minStock = product.minStock ?? 0;
      return product.active && minStock > 0 && product.stock <= minStock;
    }
    if (statusFilter === "out") return product.active && product.stock === 0;
    return true;
  });

  const columns: Array<AdminColumn<Row>> = [
    {
      key: "product",
      header: "Produto",
      render: (product) => (
        <div className="row row-3">
          <span style={{ width: 42, height: 42, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "var(--color-surface-2)" }}>
            <ProductImage src={product.images?.[0]?.url} alt={product.name} aspectRatio="1 / 1" />
          </span>
          <div style={{ minWidth: 0 }}>
            <Link to={`/admin/produtos/${product.id}`} className="text-sm text-strong clamp-1">
              {product.name}
            </Link>
            <div className="text-xs text-muted">
              SKU {product.sku}
              {product.volume ? ` • ${product.volume}` : ""}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Categoria",
      hideOnMobile: true,
      render: (product) => <span className="text-sm text-muted">{product.category?.name ?? "—"}</span>,
    },
    {
      key: "price",
      header: "Preço",
      align: "right",
      render: (product) => (
        <div>
          <div className="text-sm text-strong tabular">{formatCurrency(product.price)}</div>
          {product.comparePrice ? (
            <div className="text-xs text-subtle tabular" style={{ textDecoration: "line-through" }}>
              {formatCurrency(product.comparePrice)}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "stock",
      header: "Estoque",
      align: "right",
      render: (product) => {
        const minStock = product.minStock ?? 0;
        const low = minStock > 0 && product.stock <= minStock;
        return (
          <div>
            <Badge tone={product.stock === 0 ? "danger" : low ? "warning" : "success"}>{product.stock} un.</Badge>
            {product.reservedStock > 0 ? (
              <div className="text-xs text-subtle mt-1">{product.reservedStock} reservado(s)</div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (product) => (
        <div className="stack stack-1">
          <Badge tone={product.active ? "success" : "neutral"}>{product.active ? "Ativo" : "Inativo"}</Badge>
          {product.isDemo ? <Badge tone="warning">DEMO</Badge> : null}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (product) => (
        <RowActions>
          <Link to={`/admin/produtos/${product.id}`} className="btn btn--ghost btn--sm btn--icon" aria-label="Editar produto" title="Editar produto">
            <Icon name="edit" size={16} />
            <span className="sr-only">Editar</span>
          </Link>
          <Button size="sm" variant="ghost" icon="layers" iconOnly onClick={() => setStockModal(product)}>
            Estoque
          </Button>
          <Button size="sm" variant="ghost" icon="copy" iconOnly onClick={() => duplicate.mutate(product)}>
            Duplicar
          </Button>
          <Button size="sm" variant="ghost" icon={product.active ? "eyeOff" : "eye"} iconOnly onClick={() => toggleActive.mutate(product)}>
            {product.active ? "Desativar" : "Ativar"}
          </Button>
          <Button size="sm" variant="ghost" icon="trash" iconOnly onClick={() => setDeleteTarget(product)}>
            Excluir
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Produtos"
        subtitle={`${products.data?.meta?.total ?? 0} produtos no catálogo`}
        actions={
          <>
            <Link to="/admin/produtos/novo" className="btn btn--primary">
              <Icon name="plus" size={16} /> Novo produto
            </Link>
            <Button variant="ghost" icon="refresh" onClick={() => void products.refetch()}>
              Atualizar
            </Button>
          </>
        }
      />

      <form
        className="admin-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
        }}
      >
        <Input
          label="Buscar"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nome, SKU ou marca"
          icon="search"
        />
        <Select
          label="Situação"
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            setPage(1);
          }}
          options={[
            { value: "all", label: "Todos os produtos" },
            { value: "active", label: "Somente ativos" },
            { value: "inactive", label: "Somente inativos" },
            { value: "low", label: "Estoque baixo" },
            { value: "out", label: "Sem estoque" },
          ]}
        />
        <Button type="submit" variant="ghost" icon="search">
          Filtrar
        </Button>
      </form>

      <AdminTable
        columns={columns}
        rows={rows}
        loading={products.isLoading}
        error={products.error}
        requestId={errorRequestId(products.error)}
        onRetry={() => void products.refetch()}
        meta={products.data?.meta}
        onPageChange={setPage}
        emptyTitle="Nenhum produto encontrado"
        emptyText="Cadastre o primeiro produto para ele aparecer na loja."
        emptyAction={
          <Link to="/admin/produtos/novo" className="btn btn--primary">
            <Icon name="plus" size={16} /> Cadastrar produto
          </Link>
        }
      />

      {/* --------------------------------------------------- AJUSTE DE ESTOQUE */}
      <StockModal
        product={stockModal}
        loading={updateStock.isPending}
        onClose={() => setStockModal(null)}
        onSave={(stock, minStock, reason) => stockModal && updateStock.mutate({ id: stockModal.id, stock, minStock, reason })}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir produto"
        message={`"${deleteTarget?.name}" será removido da loja. Produtos com vendas registradas são apenas desativados, para preservar o histórico dos pedidos.`}
        confirmLabel="Desativar produto"
        loading={deleteProduct.isPending}
        onConfirm={() => deleteTarget && deleteProduct.mutate({ id: deleteTarget.id, hard: false })}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function StockModal({
  product,
  loading,
  onClose,
  onSave,
}: {
  product: Row | null;
  loading: boolean;
  onClose: () => void;
  onSave: (stock: number, minStock: number, reason: string) => void;
}) {
  const [stock, setStock] = useState("0");
  const [minStock, setMinStock] = useState("0");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (product) {
      setStock(String(product.stock));
      setMinStock(String(product.minStock ?? 0));
      setReason("");
    }
  }, [product]);

  if (!product) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Estoque — ${product.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button loading={loading} onClick={() => onSave(Number(stock), Number(minStock), reason)}>
            Salvar estoque
          </Button>
        </>
      }
    >
      <div className="stack stack-4">
        <div className="spec-list">
          <div className="spec-list__row">
            <span className="spec-list__label">Estoque atual</span>
            <span className="spec-list__value">{formatNumber(product.stock)}</span>
          </div>
          <div className="spec-list__row">
            <span className="spec-list__label">Reservado (pedidos não pagos)</span>
            <span className="spec-list__value">{formatNumber(product.reservedStock ?? 0)}</span>
          </div>
          <div className="spec-list__row">
            <span className="spec-list__label">Vendido</span>
            <span className="spec-list__value">{formatNumber(product.soldStock ?? 0)}</span>
          </div>
        </div>

        <Input
          label="Novo estoque disponível"
          type="number"
          min={0}
          value={stock}
          onChange={(event) => setStock(event.target.value)}
          hint="O valor não pode ficar abaixo do estoque reservado."
          required
        />
        <Input
          label="Estoque mínimo (alerta)"
          type="number"
          min={0}
          value={minStock}
          onChange={(event) => setMinStock(event.target.value)}
          hint="Quando o estoque chegar nesse valor, o dashboard avisa."
        />
        <Input
          label="Motivo do ajuste"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Ex.: inventário, devolução, correção"
          hint="Fica registrado na auditoria."
        />
      </div>
    </Modal>
  );
}
