import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Icon, Input, StoreLockup } from "@/components/ui";
import { useToast } from "@/hooks";
import { useAuthStore } from "@/stores/auth";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, fieldErrors } from "@/lib/api";
import type { AuthSession } from "@/types/api";

/**
 * Login ÚNICO da operação (`/admin/login`).
 *
 * Atende ADMIN, DELIVERY_PERSON e CLIENT. O backend identifica o role e esta
 * tela redireciona automaticamente:
 *   ADMIN            → /admin/dashboard
 *   DELIVERY_PERSON  → /motoboy
 *   CLIENT           → loja
 *
 * `/motoboy/login` continua existindo apenas como alias desta mesma tela.
 * A autorização de verdade é feita no backend (JWT + role).
 */
function homeForRole(role: string): string {
  if (role === "ADMIN") return "/admin/dashboard";
  if (role === "DELIVERY_PERSON") return "/motoboy";
  return "/";
}

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const setSession = useAuthStore((s) => s.setSession);
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    applySeo({ title: "Acesso à operação", noindex: true, canonicalPath: "/admin/login" });
  }, []);

  // Já autenticado? Vai direto para a área do seu perfil.
  useEffect(() => {
    if (status === "authenticated" && user) {
      navigate(homeForRole(user.role), { replace: true });
    }
  }, [status, user, navigate]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setErrors({});
    setLoading(true);

    api
      .post<AuthSession>("/auth/login", { email: email.trim(), password }, { auth: false })
      .then((session) => {
        setSession(session);
        const destination = homeForRole(session.user.role);
        toast.success("Bem-vindo", session.user.name);
        navigate(destination, { replace: true });
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
        <p className="auth-aside__quote">Painel administrativo</p>
        <p className="auth-aside__note">
          Gerencie produtos, pedidos, clientes e entregas. Administradores e entregadores entram pela mesma tela — o
          acesso é direcionado conforme o seu perfil. Todo acesso administrativo fica registrado em auditoria.
        </p>
      </aside>

      <div className="auth-panel">
        <form className="auth-form" onSubmit={submit} noValidate>
          <div className="auth-form__header">
            <span className="eyebrow">Área restrita</span>
            <h1 className="auth-form__title">Entrar</h1>
            <p className="auth-form__subtitle">Acesso para administradores e entregadores da loja.</p>
          </div>

          {error ? <Alert tone="danger" title="Não foi possível entrar">{error}</Alert> : null}

          <Input
            label="E-mail"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            icon="mail"
            error={errors["email"]}
            required
          />

          <Input
            label="Senha"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            icon="lock"
            error={errors["password"]}
            action={{
              icon: showPassword ? "eyeOff" : "eye",
              label: showPassword ? "Ocultar senha" : "Mostrar senha",
              onClick: () => setShowPassword((value) => !value),
            }}
            required
          />

          <Button type="submit" size="lg" block loading={loading} icon="shieldCheck">
            Entrar
          </Button>

          <a href="/" className="btn btn--ghost btn--block">
            <Icon name="store" size={18} /> Voltar para a loja
          </a>

          <Alert tone="info" title="Primeiro acesso com dados de teste?">
            Se a loja foi instalada com o seed de demonstração, o usuário é <strong>admin@teste.local</strong>. Troque a
            senha imediatamente em Configurações.
          </Alert>
        </form>
      </div>
    </div>
  );
}
