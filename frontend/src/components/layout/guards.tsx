import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Alert, Button, Icon, LoadingBlock, StoreLockup } from "@/components/ui";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { toastError } from "@/lib/feedback";
import { api } from "@/lib/api";

/* ========================================================================== */
/* Rotas protegidas                                                            */
/* ========================================================================== */

/**
 * Exige sessão. Enquanto o perfil é revalidado, mostra loading — assim não
 * "pisca" a tela de login para quem já está autenticado.
 */
export function RequireAuth({ children }: { children?: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === "loading") return <LoadingBlock label="Verificando sua sessão…" />;
  if (status === "guest") return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return <>{children ?? <Outlet />}</>;
}

/**
 * Exige perfil ADMIN.
 * Um cliente autenticado recebe uma tela de acesso negado (não é redirecionado
 * silenciosamente, o que esconderia o motivo).
 */
export function RequireAdmin({ children }: { children?: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (status === "loading") return <LoadingBlock label="Verificando permissões…" />;
  if (status === "guest") return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;

  if (user?.role !== "ADMIN") {
    return (
      <div className="container py-16">
        <div className="card card--padded-lg stack stack-5" style={{ maxWidth: 560, margin: "0 auto" }}>
          <span className="empty-state__icon" style={{ margin: "0 auto" }}>
            <Icon name="shieldOff" size={30} />
          </span>
          <h1 className="text-center">Área restrita</h1>
          <p className="text-center text-muted">
            Sua conta não tem permissão de administrador. Se você deveria ter acesso, fale com o responsável pela loja.
          </p>
          <Button variant="ghost" block onClick={() => window.history.back()}>
            Voltar
          </Button>
        </div>
      </div>
    );
  }

  return <>{children ?? <Outlet />}</>;
}

/* ========================================================================== */
/* Aviso de sessão expirada                                                    */
/* ========================================================================== */

/**
 * Quando o refresh token falha durante a navegação, avisamos o usuário em vez
 * de deslogá-lo em silêncio.
 */
export function SessionExpiredWatcher() {
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const acknowledge = useAuthStore((s) => s.acknowledgeSessionExpired);
  const pushToast = useUiStore((s) => s.pushToast);

  useEffect(() => {
    if (!sessionExpired) return;
    pushToast({
      tone: "warning",
      title: "Sua sessão expirou",
      message: "Entre novamente para continuar de onde parou.",
      durationMs: 8000,
    });
    acknowledge();
  }, [sessionExpired, acknowledge, pushToast]);

  return null;
}

/* ========================================================================== */
/* Verificação de sessão na inicialização                                      */
/* ========================================================================== */

/**
 * Revalida o token junto à API uma única vez ao carregar o app.
 * Sem isso, um token revogado deixaria a UI "logada" até a primeira ação.
 */
export function useSessionBootstrap() {
  const refresh = useAuthStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);
}

/* ========================================================================== */
/* Página 404                                                                  */
/* ========================================================================== */

export function NotFoundPage() {
  return (
    <div className="container">
      <div className="not-found">
        <span className="not-found__code">404</span>
        <h1>Página não encontrada</h1>
        <p className="text-muted">O endereço que você tentou abrir não existe ou foi movido.</p>
        <div className="row row-3">
          <Button onClick={() => window.location.assign("/")} icon="home">
            Ir para a loja
          </Button>
          <Button variant="ghost" onClick={() => window.history.back()} icon="arrowLeft">
            Voltar
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Tratamento global de erro de renderização                                   */
/* ========================================================================== */

export function RouteErrorBoundary({ error }: { error: unknown }) {
  const [requestId, setRequestId] = useState<string | null>(null);

  useEffect(() => {
    if (error) {
      toastError("Ocorreu um erro ao exibir esta página", error);
      setRequestId(null);
    }
  }, [error]);

  return (
    <div className="container py-16">
      <div className="card card--padded-lg stack stack-4" style={{ maxWidth: 560, margin: "0 auto" }}>
        {/* O emblema é dourado: precisa de fundo escuro para ter contraste. */}
        <span className="brand-chip">
          <StoreLockup emblemSize="sm" showTagline={false} />
        </span>
        <h1>Algo deu errado</h1>
        <Alert tone="danger">
          Não foi possível exibir esta página. Tente recarregar.
          {requestId ? <p className="text-xs mt-2">Código: {requestId}</p> : null}
        </Alert>
        <Button onClick={() => window.location.reload()} icon="refresh">
          Recarregar
        </Button>
      </div>
    </div>
  );
}

// Reexport utilitário para uso das páginas administrativas.
export { api };
