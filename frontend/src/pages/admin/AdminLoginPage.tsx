import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Icon, Input, StoreLockup } from "@/components/ui";
import { useToast } from "@/hooks";
import { useAuthStore } from "@/stores/auth";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, fieldErrors } from "@/lib/api";
import type { AuthSession } from "@/types/api";

/**
 * Login administrativo (rota separada: /admin/login).
 *
 * Um cliente que tente entrar aqui recebe uma mensagem clara de que a conta não
 * tem permissão — a checagem definitiva continua sendo feita no backend.
 */
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
    applySeo({ title: "Acesso administrativo", noindex: true, canonicalPath: "/admin/login" });
  }, []);

  // Já autenticado como admin? Vai direto ao painel.
  useEffect(() => {
    if (status === "authenticated" && user?.role === "ADMIN") {
      navigate("/admin/dashboard", { replace: true });
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
        /**
         * AUTORIZAÇÃO NO CLIENTE — verificada ANTES de qualquer coisa.
         *
         * Um CLIENT não pode entrar no painel. Nesse caso:
         *  1. NÃO gravamos a sessão (o usuário não fica "logado" pelo painel);
         *  2. mostramos a mensagem exata pedida na auditoria;
         *  3. permanecemos em /admin/login.
         *
         * A autoridade continua sendo o backend: mesmo que alguém contorne esta
         * tela, `/api/admin/*` responde 403 para quem não é ADMIN.
         */
        if (session.user.role !== "ADMIN") {
          setError("Esta conta não possui acesso administrativo.");
          setErrors({});
          setLoading(false);
          return;
        }

        setSession(session);
        toast.success("Bem-vindo ao painel", session.user.name);
        navigate("/admin/dashboard", { replace: true });
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
          Gerencie produtos, pedidos, clientes, conteúdo e a operação da loja. Todo acesso administrativo fica
          registrado em auditoria.
        </p>
      </aside>

      <div className="auth-panel">
        <form className="auth-form" onSubmit={submit} noValidate>
          <div className="auth-form__header">
            <span className="eyebrow">Área restrita</span>
            <h1 className="auth-form__title">Entrar no painel</h1>
            <p className="auth-form__subtitle">Acesso somente para administradores da loja.</p>
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
            Entrar no painel
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
