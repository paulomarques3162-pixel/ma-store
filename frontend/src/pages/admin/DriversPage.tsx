import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Input, Modal, Select } from "@/components/ui";
import { AdminPageHeader, AdminTable, RowActions, type AdminColumn } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, errorRequestId, fieldErrors } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format";
import type { Driver } from "@/types/api";

type Form = { name: string; email: string; phone: string; password: string; status: "ACTIVE" | "BLOCKED" | "PENDING" };

const EMPTY: Form = { name: "", email: "", phone: "", password: "", status: "ACTIVE" };

/** Admin → Entregadores: criar, editar, ativar/desativar e redefinir senha. */
export default function AdminDriversPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [resetTarget, setResetTarget] = useState<Driver | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [resetPassword, setResetPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    applySeo({ title: "Entregadores", noindex: true, canonicalPath: "/admin/entregadores" });
  }, []);

  const drivers = useQuery({
    queryKey: queryKeys.adminDrivers,
    queryFn: () => api.get<{ drivers: Driver[] }>("/admin/drivers"),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: queryKeys.adminDrivers });

  const save = useMutation({
    mutationFn: () => {
      if (editing) {
        return api.patch(`/admin/drivers/${editing.id}`, {
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          status: form.status,
        });
      }
      return api.post("/admin/drivers", {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        password: form.password,
      });
    },
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      setEditing(null);
      setErrors({});
      toast.success(editing ? "Entregador atualizado" : "Entregador criado");
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      toast.error("Não foi possível salvar", errorMessage(error));
    },
  });

  const reset = useMutation({
    mutationFn: () => api.post(`/admin/drivers/${resetTarget?.id}/reset-password`, { password: resetPassword }),
    onSuccess: () => {
      setResetTarget(null);
      setResetPassword("");
      toast.success("Senha redefinida", "O entregador deverá trocá-la no próximo acesso.");
    },
    onError: (error) => toast.error("Não foi possível redefinir", errorMessage(error)),
  });

  const toggle = useMutation({
    mutationFn: (driver: Driver) =>
      driver.status === "ACTIVE"
        ? api.post(`/admin/drivers/${driver.id}/deactivate`, {})
        : api.patch(`/admin/drivers/${driver.id}`, { status: "ACTIVE" }),
    onSuccess: () => {
      invalidate();
      toast.success("Status atualizado");
    },
    onError: (error) => toast.error("Não foi possível alterar", errorMessage(error)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setErrors({});
    setModalOpen(true);
  };
  const openEdit = (driver: Driver) => {
    setEditing(driver);
    setForm({ name: driver.name, email: driver.email, phone: driver.phone ?? "", password: "", status: driver.status });
    setErrors({});
    setModalOpen(true);
  };

  const columns: Array<AdminColumn<Driver>> = [
    { key: "name", header: "Nome", render: (driver) => <span className="text-sm text-strong">{driver.name}</span> },
    { key: "email", header: "E-mail", hideOnMobile: true, render: (driver) => <span className="text-sm text-muted">{driver.email}</span> },
    { key: "phone", header: "Telefone", hideOnMobile: true, render: (driver) => <span className="text-sm text-muted">{driver.phone ?? "—"}</span> },
    { key: "deliveries", header: "Entregas", align: "right", render: (driver) => <span className="text-sm tabular">{driver.deliveriesCount}</span> },
    {
      key: "status",
      header: "Status",
      render: (driver) => <Badge tone={driver.status === "ACTIVE" ? "success" : "neutral"}>{driver.status === "ACTIVE" ? "Ativo" : "Inativo"}</Badge>,
    },
    { key: "last", header: "Último acesso", hideOnMobile: true, render: (driver) => <span className="text-xs text-muted">{driver.lastLoginAt ? formatDateTime(driver.lastLoginAt) : "—"}</span> },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (driver) => (
        <RowActions>
          <Button size="sm" variant="ghost" icon="edit" iconOnly onClick={() => openEdit(driver)}>
            Editar
          </Button>
          <Button size="sm" variant="ghost" icon="lock" iconOnly onClick={() => setResetTarget(driver)}>
            Redefinir senha
          </Button>
          <Button size="sm" variant="ghost" icon={driver.status === "ACTIVE" ? "eyeOff" : "eye"} iconOnly onClick={() => toggle.mutate(driver)}>
            {driver.status === "ACTIVE" ? "Desativar" : "Ativar"}
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Entregadores"
        subtitle="Cadastre, ative/desative e redefina a senha dos entregadores."
        actions={
          <Button icon="plus" onClick={openCreate}>
            Novo entregador
          </Button>
        }
      />

      <AdminTable
        columns={columns}
        rows={drivers.data?.drivers ?? []}
        loading={drivers.isLoading}
        error={drivers.error}
        requestId={errorRequestId(drivers.error)}
        onRetry={() => void drivers.refetch()}
        emptyTitle="Nenhum entregador cadastrado"
        emptyText="Cadastre um entregador para atribuir pedidos."
        emptyIcon="users"
        emptyAction={
          <Button icon="plus" onClick={openCreate}>
            Criar entregador
          </Button>
        }
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Editar ${editing.name}` : "Novo entregador"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              loading={save.isPending}
              disabled={!form.name.trim() || (!editing && (!form.email.trim() || form.password.length < 8))}
              onClick={() => save.mutate()}
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="stack stack-4">
          <Input label="Nome" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} error={errors["name"]} required />
          {!editing ? (
            <>
              <Input
                label="E-mail"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                error={errors["email"]}
                required
              />
              <Input
                label="Senha temporária"
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                hint="Mínimo 8 caracteres, com letra e número. Troca obrigatória no primeiro acesso."
                error={errors["password"]}
                required
              />
            </>
          ) : (
            <Select
              label="Status"
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value as Form["status"] })}
              options={[
                { value: "ACTIVE", label: "Ativo" },
                { value: "BLOCKED", label: "Inativo" },
                { value: "PENDING", label: "Pendente" },
              ]}
            />
          )}
          <Input label="Telefone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} hint="Opcional" />
          {!editing ? (
            <Alert tone="info">Entregadores nunca são apagados: usar "Desativar" preserva o histórico de entregas.</Alert>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        title={`Redefinir senha de ${resetTarget?.name ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetTarget(null)}>
              Cancelar
            </Button>
            <Button loading={reset.isPending} disabled={resetPassword.length < 8} onClick={() => reset.mutate()}>
              Redefinir senha
            </Button>
          </>
        }
      >
        <Input
          label="Nova senha temporária"
          type="password"
          value={resetPassword}
          onChange={(event) => setResetPassword(event.target.value)}
          hint="O entregador deverá trocá-la no próximo acesso."
          required
        />
      </Modal>
    </div>
  );
}
