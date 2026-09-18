import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
import { api, errorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import type { Brand, Category } from "@/types/api";

type Section = "categorias" | "marcas";

/** Gestão de categorias e marcas (slug automático, ativação e ordenação). */
export default function AdminCategoriesPage() {
  const [section, setSection] = useState<Section>("categorias");

  useEffect(() => {
    applySeo({ title: "Categorias e marcas", noindex: true, canonicalPath: "/admin/categorias" });
  }, []);

  return (
    <div>
      <AdminPageHeader
        title="Categorias e marcas"
        subtitle="A organização do catálogo aparece automaticamente na loja."
      />

      <div className="tabs mb-5" role="tablist" aria-label="Seções">
        <button
          type="button"
          role="tab"
          aria-selected={section === "categorias"}
          className={["tab", section === "categorias" ? "tab--active" : ""].filter(Boolean).join(" ")}
          onClick={() => setSection("categorias")}
        >
          Categorias
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "marcas"}
          className={["tab", section === "marcas" ? "tab--active" : ""].filter(Boolean).join(" ")}
          onClick={() => setSection("marcas")}
        >
          Marcas
        </button>
      </div>

      {section === "categorias" ? <CategoriesSection /> : <BrandsSection />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Categorias                                                                  */
/* -------------------------------------------------------------------------- */

function CategoriesSection() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: "", description: "", imageUrl: "", parentId: "", position: "0", active: true });

  const categories = useQuery({
    queryKey: queryKeys.adminCategories,
    queryFn: () => api.get<Array<Category & { productCount: number }>>("/admin/categories"),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminCategories });
    void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        description: form.description || undefined,
        imageUrl: form.imageUrl || undefined,
        parentId: form.parentId || null,
        position: Number(form.position),
        active: form.active,
      };
      return editing ? api.patch(`/admin/categories/${editing.id}`, payload) : api.post("/admin/categories", payload);
    },
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      setEditing(null);
      toast.success(editing ? "Categoria atualizada" : "Categoria criada");
    },
    onError: (error) => toast.error("Não foi possível salvar", errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/categories/${id}`),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      toast.success("Categoria removida ou desativada");
    },
    onError: (error) => toast.error("Não foi possível excluir", errorMessage(error)),
  });

  const columns: Array<AdminColumn<Category & { productCount: number }>> = [
    {
      key: "name",
      header: "Categoria",
      render: (category) => (
        <div>
          <div className="text-sm text-strong">{category.name}</div>
          <div className="text-xs text-muted">/{category.slug}</div>
        </div>
      ),
    },
    {
      key: "products",
      header: "Produtos",
      align: "right",
      render: (category) => <span className="text-sm">{category.productCount ?? 0}</span>,
    },
    {
      key: "position",
      header: "Ordem",
      align: "right",
      hideOnMobile: true,
      render: (category) => <span className="text-sm text-muted">{category.position ?? 0}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (category) => (
        <div className="stack stack-1">
          <Badge tone={category.active ? "success" : "neutral"}>{category.active ? "Ativa" : "Inativa"}</Badge>
          {category.isDemo ? <Badge tone="warning">DEMO</Badge> : null}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (category) => (
        <RowActions>
          <Button
            size="sm"
            variant="ghost"
            icon="edit"
            iconOnly
            onClick={() => {
              setEditing(category);
              setForm({
                name: category.name,
                description: category.description ?? "",
                imageUrl: category.imageUrl ?? "",
                parentId: category.parentId ?? "",
                position: String(category.position ?? 0),
                active: category.active ?? true,
              });
              setModalOpen(true);
            }}
          >
            Editar
          </Button>
          <Button size="sm" variant="ghost" icon="trash" iconOnly onClick={() => setDeleteTarget(category)}>
            Excluir
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <div className="row row-end mb-4">
        <Button
          icon="plus"
          onClick={() => {
            setEditing(null);
            setForm({ name: "", description: "", imageUrl: "", parentId: "", position: "0", active: true });
            setModalOpen(true);
          }}
        >
          Nova categoria
        </Button>
      </div>

      <AdminTable
        columns={columns}
        rows={categories.data ?? []}
        loading={categories.isLoading}
        error={categories.error}
        onRetry={() => void categories.refetch()}
        emptyTitle="Nenhuma categoria cadastrada"
        emptyText="Crie categorias para organizar o catálogo da loja."
        emptyIcon="layers"
      />

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        title={editing ? "Editar categoria" : "Nova categoria"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="stack stack-4">
          <Input label="Nome" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          <Input
            label="Descrição"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            hint="Opcional — ajuda no SEO da página da categoria."
          />
          <Input
            label="URL da imagem"
            value={form.imageUrl}
            onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
            hint="Opcional. Sem imagem, a loja usa um placeholder."
          />
          <Select
            label="Categoria pai"
            value={form.parentId}
            onChange={(event) => setForm({ ...form, parentId: event.target.value })}
            placeholder="Nenhuma (categoria raiz)"
            options={(categories.data ?? []).filter((c) => c.id !== editing?.id).map((c) => ({ value: c.id, label: c.name }))}
          />
          <Input
            label="Ordem de exibição"
            type="number"
            min="0"
            value={form.position}
            onChange={(event) => setForm({ ...form, position: event.target.value })}
          />
          <Switch label="Categoria ativa" checked={form.active} onChange={(value) => setForm({ ...form, active: value })} />
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir categoria"
        message={
          deleteTarget && (deleteTarget.productCount ?? 0) > 0
            ? `"${deleteTarget.name}" tem produtos vinculados e será apenas desativada, para não afetar o catálogo.`
            : `"${deleteTarget?.name}" será excluída permanentemente.`
        }
        confirmLabel="Confirmar"
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Marcas                                                                      */
/* -------------------------------------------------------------------------- */

function BrandsSection() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Brand | null>(null);
  const [form, setForm] = useState({ name: "", logoUrl: "", active: true });

  const brands = useQuery({
    queryKey: queryKeys.adminBrands,
    queryFn: () => api.get<Array<Brand & { productCount: number }>>("/admin/brands"),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminBrands });
    void queryClient.invalidateQueries({ queryKey: queryKeys.brands });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: form.name.trim(), logoUrl: form.logoUrl || undefined, active: form.active };
      return editing ? api.patch(`/admin/brands/${editing.id}`, payload) : api.post("/admin/brands", payload);
    },
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      setEditing(null);
      toast.success(editing ? "Marca atualizada" : "Marca criada");
    },
    onError: (error) => toast.error("Não foi possível salvar", errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/brands/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success("Marca removida ou desativada");
    },
    onError: (error) => toast.error("Não foi possível excluir", errorMessage(error)),
  });

  const columns: Array<AdminColumn<Brand & { productCount: number }>> = [
    {
      key: "name",
      header: "Marca",
      render: (brand) => (
        <div>
          <div className="text-sm text-strong">{brand.name}</div>
          <div className="text-xs text-muted">/{brand.slug}</div>
        </div>
      ),
    },
    {
      key: "products",
      header: "Produtos",
      align: "right",
      render: (brand) => <span className="text-sm">{brand.productCount ?? 0}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (brand) => <Badge tone={brand.active ? "success" : "neutral"}>{brand.active ? "Ativa" : "Inativa"}</Badge>,
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (brand) => (
        <RowActions>
          <Button
            size="sm"
            variant="ghost"
            icon="edit"
            iconOnly
            onClick={() => {
              setEditing(brand);
              setForm({ name: brand.name, logoUrl: brand.logoUrl ?? "", active: brand.active ?? true });
              setModalOpen(true);
            }}
          >
            Editar
          </Button>
          <Button size="sm" variant="ghost" icon="trash" iconOnly onClick={() => remove.mutate(brand.id)}>
            Excluir
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <div className="row row-end mb-4">
        <Button
          icon="plus"
          onClick={() => {
            setEditing(null);
            setForm({ name: "", logoUrl: "", active: true });
            setModalOpen(true);
          }}
        >
          Nova marca
        </Button>
      </div>

      <AdminTable
        columns={columns}
        rows={brands.data ?? []}
        loading={brands.isLoading}
        error={brands.error}
        onRetry={() => void brands.refetch()}
        emptyTitle="Nenhuma marca cadastrada"
        emptyText="Cadastre as marcas dos produtos para permitir o filtro por marca."
        emptyIcon="tag"
      />

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        title={editing ? "Editar marca" : "Nova marca"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="stack stack-4">
          <Input label="Nome" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          <Input
            label="URL do logo"
            value={form.logoUrl}
            onChange={(event) => setForm({ ...form, logoUrl: event.target.value })}
            hint="Opcional."
          />
          <Checkbox
            label="Marca ativa"
            checked={form.active}
            onChange={(event) => setForm({ ...form, active: event.target.checked })}
          />
        </div>
      </Modal>
    </>
  );
}

export { Icon };
