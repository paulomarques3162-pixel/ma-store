import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Checkbox, Icon, Input, StoreLockup } from "@/components/ui";
import { useToast } from "@/hooks";
import { useAuthStore } from "@/stores/auth";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, fieldErrors } from "@/lib/api";
import type { AuthSession } from "@/types/api";

/**
 * Login. Após autenticar, volta para a página de origem (`state.from`)
 * ou para a conta do usuário.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const setSession = useAuthStore((s) => s.setSession);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    applySeo({ title: "Entrar", noindex: true, canonicalPath: "/login" });
  }, []);

  const from = (location.state as { from?: string } | null)?.from ?? "/minha-conta";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setErrors({});

    if (!email.trim() || !password) {
      setErrors({ email: !email.trim() ? "Informe seu e-mail." : "", password: !password ? "Informe sua senha." : "" });
      return;
    }

    setLoading(true);
    api
      .post<AuthSession>("/auth/login", { email: email.trim(), password, remember }, { auth: false })
      .then((session) => {
        setSession(session);
        toast.success(`Bem-vindo(a), ${session.user.name.split(" ")[0]}!`);
        navigate(session.user.role === "ADMIN" && from.startsWith("/admin") ? from : from, { replace: true });
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
        <p className="auth-aside__quote">
          Sua conta guarda seus pedidos, favoritos e atendimento em um só lugar.
        </p>
        <p className="auth-aside__note">
          Seus dados de acesso são protegidos. Nunca compartilhamos sua senha com ninguém — nem o painel da loja
          consegue vê-la.
        </p>
      </aside>

      <div className="auth-panel">
        <form className="auth-form" onSubmit={submit} noValidate>
          <div className="auth-form__header">
            <h1 className="auth-form__title">Entrar na sua conta</h1>
            <p className="auth-form__subtitle">Acesse para comprar, acompanhar pedidos e falar com a loja.</p>
          </div>

          {error ? <Alert tone="danger" title="Não foi possível entrar">{error}</Alert> : null}

          <Input
            label="E-mail"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@email.com"
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
            placeholder="Sua senha"
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

          <div className="row row-between row-wrap">
            <Checkbox
              label="Manter conectado"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <Link to="/esqueci-minha-senha" className="btn btn--link btn--sm">
              Esqueci minha senha
            </Link>
          </div>

          <Button type="submit" size="lg" block loading={loading}>
            Entrar
          </Button>

          <p className="divider">ou</p>

          <Link to="/cadastro" className="btn btn--ghost btn--block">
            <Icon name="userCheck" size={18} /> Criar uma conta
          </Link>

          <p className="text-xs text-muted text-center">
            Ao entrar você concorda com os termos de uso e a política de privacidade da loja.
          </p>
        </form>
      </div>
    </div>
  );
}
