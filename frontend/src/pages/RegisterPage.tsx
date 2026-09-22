import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Checkbox, Icon, Input, StoreLockup } from "@/components/ui";
import { useToast } from "@/hooks";
import { useAuthStore } from "@/stores/auth";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, fieldErrors } from "@/lib/api";
import { maskPhone } from "@/lib/format";
import type { AuthSession } from "@/types/api";

/** Cadastro de cliente. A compra exige conta, então este é o primeiro passo. */
export default function RegisterPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const setSession = useAuthStore((s) => s.setSession);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    acceptTerms: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    applySeo({ title: "Criar conta", noindex: true, canonicalPath: "/cadastro" });
  }, []);

  const set = (field: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [field]: value }));

  const validate = () => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 3) next["name"] = "Informe seu nome completo.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next["email"] = "Informe um e-mail válido.";
    if (form.password.length < 8) next["password"] = "A senha deve ter ao menos 8 caracteres.";
    else if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) next["password"] = "Use letras e números na senha.";
    if (form.password !== form.confirmPassword) next["confirmPassword"] = "As senhas não conferem.";
    if (!form.acceptTerms) next["acceptTerms"] = "É necessário aceitar os termos para continuar.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;

    setLoading(true);
    api
      .post<AuthSession>(
        "/auth/register",
        {
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone ? maskPhone(form.phone).replace(/\D/g, "") : undefined,
          password: form.password,
          confirmPassword: form.confirmPassword,
          acceptTerms: true,
        },
        { auth: false },
      )
      .then((session) => {
        setSession(session);
        toast.success("Conta criada!", "Bem-vindo(a) à MA STORE.");
        navigate("/minha-conta", { replace: true });
      })
      .catch((mutationError) => {
        setError(errorMessage(mutationError));
        setErrors(fieldErrors(mutationError));
      })
      .finally(() => setLoading(false));
  };

  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <StoreLockup emblemSize="xl" />
        <p className="auth-aside__quote">Crie sua conta e acompanhe cada pedido, do pagamento à entrega.</p>
        <p className="auth-aside__note">
          Você recebe notificações sobre o andamento do pedido e pode falar com a loja pela central de mensagens.
        </p>
      </aside>

      <div className="auth-panel">
        <form className="auth-form" onSubmit={submit} noValidate>
          <div className="auth-form__header">
            <h1 className="auth-form__title">Criar sua conta</h1>
            <p className="auth-form__subtitle">Leva menos de um minuto.</p>
          </div>

          {error ? <Alert tone="danger" title="Não foi possível criar a conta">{error}</Alert> : null}

          <Input
            label="Nome completo"
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Como devemos te chamar"
            autoComplete="name"
            icon="user"
            error={errors["name"]}
            required
          />

          <Input
            label="E-mail"
            type="email"
            value={form.email}
            onChange={(event) => set("email", event.target.value)}
            placeholder="voce@email.com"
            autoComplete="email"
            icon="mail"
            error={errors["email"]}
            required
          />

          <Input
            label="Telefone"
            value={form.phone}
            onChange={(event) => set("phone", maskPhone(event.target.value))}
            placeholder="(00) 00000-0000"
            autoComplete="tel"
            inputMode="tel"
            icon="phone"
            hint="Opcional — ajuda a loja a falar com você sobre a entrega."
          />

          <Input
            label="Senha"
            type={showPassword ? "text" : "password"}
            value={form.password}
            onChange={(event) => set("password", event.target.value)}
            placeholder="Mínimo de 8 caracteres"
            autoComplete="new-password"
            icon="lock"
            error={errors["password"]}
            hint="Use letras e números."
            action={{
              icon: showPassword ? "eyeOff" : "eye",
              label: showPassword ? "Ocultar senha" : "Mostrar senha",
              onClick: () => setShowPassword((value) => !value),
            }}
            required
          />

          <Input
            label="Confirmar senha"
            type={showPassword ? "text" : "password"}
            value={form.confirmPassword}
            onChange={(event) => set("confirmPassword", event.target.value)}
            placeholder="Repita a senha"
            autoComplete="new-password"
            icon="lock"
            error={errors["confirmPassword"]}
            required
          />

          <Checkbox
            label={
              <>
                Li e aceito os <Link to="/termos-de-uso" className="btn btn--link btn--sm">termos de uso</Link> e a{" "}
                <Link to="/politica-de-privacidade" className="btn btn--link btn--sm">política de privacidade</Link>.
              </>
            }
            checked={form.acceptTerms}
            onChange={(event) => set("acceptTerms", event.target.checked)}
            error={errors["acceptTerms"]}
          />

          <Button type="submit" size="lg" block loading={loading}>
            Criar conta
          </Button>

          <p className="divider">já tem conta?</p>

          <Link to="/login" className="btn btn--ghost btn--block">
            <Icon name="user" size={18} /> Entrar na minha conta
          </Link>
        </form>
      </div>
    </div>
  );
}
