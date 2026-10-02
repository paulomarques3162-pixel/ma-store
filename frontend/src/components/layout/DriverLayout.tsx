import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui";
import { useAuthStore } from "@/stores/auth";

/**
 * Shell do módulo do entregador.
 *
 * Mobile-first e independente do layout da loja pública (que permanece
 * intacto). Reutiliza os mesmos tokens/estilos e ícones do design system.
 */
export function DriverLayout() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();

  const logout = () => {
    clear();
    navigate("/motoboy/login", { replace: true });
  };

  return (
    <div className="app-shell" style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <header className="site-header" style={{ position: "sticky", top: 0, zIndex: 10 }}>
        <div className="container row row-between" style={{ paddingBlock: "var(--space-3)", gap: "var(--space-3)" }}>
          <div className="row row-2" style={{ alignItems: "center" }}>
            <span className="brand-chip" aria-hidden="true">
              <Icon name="truck" size={18} />
            </span>
            <div>
              <div className="text-sm text-strong" style={{ fontWeight: 600 }}>
                Área do entregador
              </div>
              <div className="text-xs text-muted">{user?.name ?? "Entregador"}</div>
            </div>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={logout}>
            <Icon name="logout" size={16} /> Sair
          </button>
        </div>
      </header>

      <main className="container" style={{ flex: 1, paddingBlock: "var(--space-4)", paddingBottom: "var(--space-16)" }}>
        <Outlet />
      </main>

      <nav
        className="container"
        aria-label="Navegação do entregador"
        style={{
          position: "sticky",
          bottom: 0,
          background: "var(--color-surface, #fff)",
          borderTop: "1px solid var(--color-border, #eee)",
          paddingBlock: "var(--space-2)",
        }}
      >
        <div className="row row-2">
          <NavLink
            to="/motoboy"
            end
            className={({ isActive }) => ["btn btn--ghost", isActive ? "btn--primary" : ""].filter(Boolean).join(" ")}
            style={{ flex: 1, justifyContent: "center" }}
          >
            <Icon name="home" size={18} /> Início
          </NavLink>
          <NavLink
            to="/motoboy/entregas"
            className={({ isActive }) => ["btn btn--ghost", isActive ? "btn--primary" : ""].filter(Boolean).join(" ")}
            style={{ flex: 1, justifyContent: "center" }}
          >
            <Icon name="package" size={18} /> Entregas
          </NavLink>
        </div>
      </nav>
    </div>
  );
}

export function DriverStoreLink() {
  return (
    <Link to="/" className="text-xs text-muted">
      Ver a loja
    </Link>
  );
}
