import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Icon,
  Input,
  LoadingBlock,
  Modal,
  Select,
  type IconName,
} from "@/components/ui";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/hooks";
import { EMPTY_MESSAGES, UFS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, fieldErrors } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, maskCep, maskPhone, onlyDigits } from "@/lib/format";
import type { Address, User } from "@/types/api";

type Tab = "perfil" | "seguranca" | "enderecos" | "notificacoes";

const NAV: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: "perfil", label: "Meus dados", icon: "user" },
  { id: "seguranca", label: "Segurança", icon: "lock" },
  { id: "enderecos", label: "Endereços", icon: "mapPin" },
  { id: "notificacoes", label: "Notificações", icon: "bell" },
];

export default function AccountPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);

  const [tab, setTab] = useState<Tab>("perfil");
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    applySeo({ title: "Minha conta", noindex: true, canonicalPath: "/minha-conta" });
  }, []);

  /* ------------------------------------------------------------- perfil */
  const [profile, setProfile] = useState({ name: user?.name ?? "", phone: user?.phone ?? "" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setProfile({ name: user?.name ?? "", phone: user?.phone ?? "" });
  }, [user]);

  const updateProfile = useMutation({
    mutationFn: () => api.patch<User>("/auth/me", { name: profile.name.trim(), phone: profile.phone || undefined }),
    onSuccess: (updated) => {
      setUser(updated);
      toast.success("Dados atualizados");
    },
    onError: (error) => toast.error("Não foi possível salvar", errorMessage(error)),
  });

  const changePassword = useMutation({
    mutationFn: () => api.post<{ message: string }>("/auth/change-password", passwordForm),
    onSuccess: (result) => {
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordErrors({});
      toast.success("Senha alterada", result.message);
      // Trocar a senha revoga as sessões: é preciso entrar novamente.
      window.setTimeout(() => {
        clear();
        navigate("/login", { replace: true });
      }, 1800);
    },
    onError: (error) => {
      setPasswordErrors(fieldErrors(error));
      toast.error("Não foi possível alterar a senha", errorMessage(error));
    },
  });

  /* ---------------------------------------------------------- endereços */
  const addresses = useQuery({
    queryKey: queryKeys.addresses,
    queryFn: () => api.get<Address[]>("/users/me/addresses"),
  });

  const saveAddress = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editingAddress
        ? api.patch<Address>(`/users/me/addresses/${editingAddress.id}`, payload)
        : api.post<Address>("/users/me/addresses", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.addresses });
      setAddressModalOpen(false);
      setEditingAddress(null);
      toast.success(editingAddress ? "Endereço atualizado" : "Endereço cadastrado");
    },
    onError: (error) => toast.error("Não foi possível salvar o endereço", errorMessage(error)),
  });

  const removeAddress = useMutation({
    mutationFn: (id: string) => api.delete(`/users/me/addresses/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.addresses });
      toast.success("Endereço removido");
    },
    onError: (error) => toast.error("Não foi possível remover", errorMessage(error)),
  });

  const setDefaultAddress = useMutation({
    mutationFn: (id: string) => api.post(`/users/me/addresses/${id}/default`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.addresses });
      toast.success("Endereço padrão atualizado");
    },
  });

  const logout = () => {
    api.post("/auth/logout", {}).catch(() => undefined).finally(() => {
      clear();
      navigate("/", { replace: true });
    });
  };

  if (!user) return <LoadingBlock label="Carregando sua conta…" />;

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Minha conta" }]} />

      <div className="page-header">
        <div>
          <h1 className="page-header__title">Minha conta</h1>
          <p className="page-header__subtitle">{user.email}</p>
        </div>
        <div className="row row-3">
          {user.role === "ADMIN" ? (
            <Link to="/admin/dashboard" className="btn btn--ghost btn--sm">
              <Icon name="shieldCheck" size={16} /> Painel administrativo
            </Link>
          ) : null}
          <Button variant="ghost" size="sm" icon="logout" onClick={() => setConfirmLogout(true)}>
            Sair
          </Button>
        </div>
      </div>

      <div className="account-layout">
        <nav className="account-nav" aria-label="Seções da conta">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={["account-nav__link", tab === item.id ? "account-nav__link--active" : ""].filter(Boolean).join(" ")}
              onClick={() => setTab(item.id)}
            >
              <Icon name={item.icon} size={18} /> {item.label}
            </button>
          ))}
          <Link to="/meus-pedidos" className="account-nav__link">
            <Icon name="package" size={18} /> Meus pedidos
          </Link>
          <Link to="/favoritos" className="account-nav__link">
            <Icon name="heart" size={18} /> Favoritos
          </Link>
          <Link to="/feedback" className="account-nav__link">
            <Icon name="star" size={18} /> Avaliações e feedback
          </Link>
        </nav>

        <div>
          {/* ------------------------------------------------------- PERFIL */}
          {tab === "perfil" ? (
            <Card className="stack stack-5">
              <div>
                <h2 className="text-lg">Meus dados</h2>
                <p className="text-sm text-muted">Mantenha seus dados atualizados para facilitar entregas.</p>
              </div>

              <Input
                label="Nome completo"
                value={profile.name}
                onChange={(event) => setProfile({ ...profile, name: event.target.value })}
              />
              <Input
                label="Telefone"
                value={profile.phone ? maskPhone(profile.phone) : ""}
                onChange={(event) => setProfile({ ...profile, phone: onlyDigits(event.target.value) })}
                placeholder="(00) 00000-0000"
                inputMode="tel"
                hint="Usado para contato sobre a entrega."
              />
              <Input label="E-mail" value={user.email} disabled hint="O e-mail de acesso não pode ser alterado por aqui." />

              <div className="row row-end">
                <Button onClick={() => updateProfile.mutate()} loading={updateProfile.isPending}>
                  Salvar alterações
                </Button>
              </div>
            </Card>
          ) : null}

          {/* ---------------------------------------------------- SEGURANÇA */}
          {tab === "seguranca" ? (
            <Card className="stack stack-5">
              <div>
                <h2 className="text-lg">Segurança</h2>
                <p className="text-sm text-muted">
                  Ao alterar a senha, todas as sessões são encerradas por segurança.
                </p>
              </div>

              <Input
                label="Senha atual"
                type="password"
                value={passwordForm.currentPassword}
                onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })}
                autoComplete="current-password"
                error={passwordErrors["currentPassword"]}
              />
              <Input
                label="Nova senha"
                type="password"
                value={passwordForm.newPassword}
                onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
                autoComplete="new-password"
                hint="Mínimo de 8 caracteres, com letras e números."
                error={passwordErrors["newPassword"]}
              />
              <Input
                label="Confirmar nova senha"
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })}
                autoComplete="new-password"
                error={passwordErrors["confirmPassword"]}
              />

              <div className="row row-end">
                <Button
                  onClick={() => changePassword.mutate()}
                  loading={changePassword.isPending}
                  disabled={!passwordForm.currentPassword || !passwordForm.newPassword}
                >
                  Alterar senha
                </Button>
              </div>

              <Alert tone="info" title="A loja nunca vê sua senha">
                Nem o painel administrativo consegue visualizar sua senha. Se você esquecê-la, será necessário
                redefini-la por um link.
              </Alert>
            </Card>
          ) : null}

          {/* --------------------------------------------------- ENDEREÇOS */}
          {tab === "enderecos" ? (
            <Card className="stack stack-5">
              <div className="row row-between row-wrap">
                <div>
                  <h2 className="text-lg">Meus endereços</h2>
                  <p className="text-sm text-muted">Agiliza o checkout nas próximas compras.</p>
                </div>
                <Button
                  icon="plus"
                  onClick={() => {
                    setEditingAddress(null);
                    setAddressModalOpen(true);
                  }}
                >
                  Novo endereço
                </Button>
              </div>

              {addresses.isLoading ? (
                <LoadingBlock label="Carregando endereços…" size="md" />
              ) : (addresses.data ?? []).length === 0 ? (
                <EmptyState
                  icon="mapPin"
                  title={EMPTY_MESSAGES.addresses.title}
                  text={EMPTY_MESSAGES.addresses.text}
                  action={
                    <Button
                      onClick={() => {
                        setEditingAddress(null);
                        setAddressModalOpen(true);
                      }}
                    >
                      Cadastrar endereço
                    </Button>
                  }
                />
              ) : (
                <div className="stack stack-3">
                  {(addresses.data ?? []).map((address) => (
                    <div key={address.id} className="option-item" style={{ cursor: "default" }}>
                      <span className="option-item__content">
                        <span className="option-item__title">
                          {address.label ? `${address.label} • ` : ""}
                          {address.street}, {address.number}
                          {address.complement ? ` — ${address.complement}` : ""}
                        </span>
                        <span className="option-item__hint">
                          {address.district}, {address.city}/{address.state} • CEP {maskCep(address.cep)}
                        </span>
                      </span>

                      <div className="row row-2">
                        {address.isDefault ? (
                          <Badge tone="accent">Padrão</Badge>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setDefaultAddress.mutate(address.id)}>
                            Tornar padrão
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="edit"
                          iconOnly
                          onClick={() => {
                            setEditingAddress(address);
                            setAddressModalOpen(true);
                          }}
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="trash"
                          iconOnly
                          onClick={() => removeAddress.mutate(address.id)}
                        >
                          Remover
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : null}

          {/* ------------------------------------------------ NOTIFICAÇÕES */}
          {tab === "notificacoes" ? (
            <Card className="stack stack-5">
              <div>
                <h2 className="text-lg">Notificações e preferências</h2>
                <p className="text-sm text-muted">
                  Você recebe avisos sobre pedidos, pagamentos e mensagens dentro do próprio app.
                </p>
              </div>

              <Link to="/notificacoes" className="btn btn--ghost">
                <Icon name="bell" size={18} /> Ver minhas notificações
              </Link>

              <Alert tone="info">
                A loja ainda não configurou canais adicionais (e-mail ou WhatsApp) para avisos automáticos. Quando
                configurar, você poderá escolher as preferências aqui.
              </Alert>
            </Card>
          ) : null}
        </div>
      </div>

      <AddressModal
        open={addressModalOpen}
        address={editingAddress}
        loading={saveAddress.isPending}
        onClose={() => {
          setAddressModalOpen(false);
          setEditingAddress(null);
        }}
        onSave={(payload) => saveAddress.mutate(payload)}
      />

      <ConfirmDialog
        open={confirmLogout}
        title="Sair da conta"
        message="Você precisará entrar novamente para acessar seus pedidos."
        confirmLabel="Sair"
        tone="primary"
        onConfirm={logout}
        onCancel={() => setConfirmLogout(false)}
      />

      <div className="row row-3" style={{ marginTop: "var(--space-8)" }}>
        <span className="text-xs text-subtle">Cliente desde {new Date(user.createdAt).toLocaleDateString("pt-BR")}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal de endereço                                                           */
/* -------------------------------------------------------------------------- */

function AddressModal({
  open,
  address,
  loading,
  onClose,
  onSave,
}: {
  open: boolean;
  address: Address | null;
  loading: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    label: "",
    cep: "",
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    state: "SP",
    isDefault: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (address) {
      setForm({
        label: address.label ?? "",
        cep: maskCep(address.cep),
        street: address.street,
        number: address.number,
        complement: address.complement ?? "",
        district: address.district,
        city: address.city,
        state: address.state,
        isDefault: address.isDefault,
      });
    } else {
      setForm({ label: "", cep: "", street: "", number: "", complement: "", district: "", city: "", state: "SP", isDefault: false });
    }
  }, [open, address]);

  const submit = () => {
    const next: Record<string, string> = {};
    if (onlyDigits(form.cep).length !== 8) next["cep"] = "CEP deve ter 8 dígitos.";
    if (form.street.trim().length < 2) next["street"] = "Informe a rua.";
    if (!form.number.trim()) next["number"] = "Informe o número.";
    if (form.district.trim().length < 2) next["district"] = "Informe o bairro.";
    if (form.city.trim().length < 2) next["city"] = "Informe a cidade.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    onSave({ ...form, cep: onlyDigits(form.cep) });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={address ? "Editar endereço" : "Novo endereço"}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={loading}>
            Salvar endereço
          </Button>
        </>
      }
    >
      <div className="stack stack-4">
        <Input
          label="Identificação"
          value={form.label}
          onChange={(event) => setForm({ ...form, label: event.target.value })}
          placeholder="Ex.: Casa, Trabalho"
          hint="Opcional"
        />

        <div className="grid" style={{ gridTemplateColumns: "1fr 2fr", gap: "var(--space-4)" }}>
          <Input
            label="CEP"
            value={form.cep}
            onChange={(event) => setForm({ ...form, cep: maskCep(event.target.value) })}
            inputMode="numeric"
            placeholder="00000-000"
            error={errors["cep"]}
            required
          />
          <Input
            label="Rua"
            value={form.street}
            onChange={(event) => setForm({ ...form, street: event.target.value })}
            error={errors["street"]}
            required
          />
        </div>

        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 2fr", gap: "var(--space-4)" }}>
          <Input
            label="Número"
            value={form.number}
            onChange={(event) => setForm({ ...form, number: event.target.value })}
            error={errors["number"]}
            required
          />
          <Input
            label="Complemento"
            value={form.complement}
            onChange={(event) => setForm({ ...form, complement: event.target.value })}
            hint="Opcional"
          />
          <Input
            label="Bairro"
            value={form.district}
            onChange={(event) => setForm({ ...form, district: event.target.value })}
            error={errors["district"]}
            required
          />
        </div>

        <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: "var(--space-4)" }}>
          <Input
            label="Cidade"
            value={form.city}
            onChange={(event) => setForm({ ...form, city: event.target.value })}
            error={errors["city"]}
            required
          />
          <Select
            label="Estado"
            value={form.state}
            onChange={(event) => setForm({ ...form, state: event.target.value })}
            options={UFS.map((uf) => ({ value: uf, label: uf }))}
          />
        </div>

        <Checkbox
          label="Usar como endereço padrão"
          checked={form.isDefault}
          onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
        />
      </div>
    </Modal>
  );
}

export { formatCurrency };
