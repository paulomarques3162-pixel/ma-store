import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Badge, Button, ConfirmDialog, Icon, StoreLogo, type IconName } from "@/components/ui";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";

type AdminNavItem = { to: string; label: string; icon: IconName };
type AdminNavGroup = { title: string; items: AdminNavItem[] };

/**
 * Navegação do painel — cobre as 16 áreas administrativas exigidas.
 * Os títulos vêm do domínio da loja; nenhum dado é inventado aqui.
 */
const NAV: AdminNavGroup[] = [
  {
    title: "Visão geral",
    items: [
      { to: "/admin/dashboard", label: "Dashboard", icon: "chart" },
      { to: "/admin/notificacoes", label: "Notificações", icon: "bell" },
    ],
  },
  {
    title: "Catálogo",
    items: [
      { to: "/admin/produtos", label: "Produtos", icon: "boxes" },
      { to: "/admin/categorias", label: "Categorias e marcas", icon: "layers" },
    ],
  },
  {
    title: "Vendas",
    items: [
      { to: "/admin/pedidos", label: "Pedidos", icon: "package" },
      { to: "/admin/pagamentos", label: "Pagamentos", icon: "creditCard" },
      { to: "/admin/cupons", label: "Cupons", icon: "percent" },
      { to: "/admin/fretes", label: "Fretes", icon: "truck" },
    ],
  },
  {
    title: "Relacionamento",
    items: [
      { to: "/admin/usuarios", label: "Usuários", icon: "users" },
      { to: "/admin/mensagens", label: "Mensagens", icon: "messages" },
      { to: "/admin/feedbacks", label: "Avaliações e feedbacks", icon: "star" },
    ],
  },
  {
    title: "Site",
    items: [
      { to: "/admin/conteudo", label: "Conteúdo", icon: "fileText" },
      { to: "/admin/layout", label: "Layout e tema", icon: "palette" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { to: "/admin/testes", label: "Laboratório de testes", icon: "flask" },
      { to: "/admin/logs", label: "Logs e auditoria", icon: "clipboard" },
      { to: "/admin/configuracoes", label: "Configurações", icon: "settings" },
    ],
  },
];

/** Contadores exibidos como badge (dados reais da API). */
function useAdminCounters() {
  const orders = useQuery({
    queryKey: queryKeys.adminOrderPending,
    queryFn: () => api.get<{ pending: number }>("/admin/orders/pending-count"),
    staleTime: 30_000,
  });

  const conversations = useQuery({
    queryKey: queryKeys.adminConversationsUnread,
    queryFn: () => api.get<{ conversations: number }>("/admin/conversations/unread-count"),
    staleTime: 30_000,
  });

  const dashboard = useQuery({
    queryKey: queryKeys.adminDashboard,
    queryFn: () =>
      api.get<{ moderation: { pendingReviews: number; pendingFeedback: number } }>("/admin/dashboard"),
    staleTime: 60_000,
  });

  return {
    pendingOrders: orders.data?.pending ?? 0,
    unreadConversations: conversations.data?.conversations ?? 0,
    pendingModeration:
      (dashboard.data?.moderation.pendingReviews ?? 0) + (dashboard.data?.moderation.pendingFeedback ?? 0),
  };
}

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clear);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const sidebarOpen = useUiStore((s) => s.adminSidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleAdminSidebar);
  const closeSidebar = useUiStore((s) => s.closeAdminSidebar);
  const counters = useAdminCounters();

  const badgeFor = (to: string): number => {
    if (to === "/admin/pedidos") return counters.pendingOrders;
    if (to === "/admin/mensagens") return counters.unreadConversations;
    if (to === "/admin/feedbacks") return counters.pendingModeration;
    return 0;
  };

  const currentTitle =
    NAV.flatMap((group) => group.items).find((item) => location.pathname.startsWith(item.to))?.label ?? "Painel";

  return (
    <div className="admin-shell">
      {sidebarOpen ? (
        <div className="drawer-overlay hide-desktop" onClick={closeSidebar} aria-hidden="true" style={{ zIndex: "var(--z-drawer)" }} />
      ) : null}

      <aside className={["admin-sidebar", sidebarOpen ? "admin-sidebar--open" : ""].filter(Boolean).join(" ")}>
        <div className="admin-sidebar__brand">
          <StoreLogo alt="MA STORE" size={40} style={{ width: 40, height: 40 }} />
          <div>
            <div className="admin-sidebar__brand-text">MA STORE</div>
            <div className="admin-sidebar__brand-sub">Painel administrativo</div>
          </div>
        </div>

        <nav className="admin-sidebar__nav" aria-label="Navegação administrativa">
          {NAV.map((group) => (
            <div key={group.title}>
              <div className="admin-sidebar__group-title">{group.title}</div>
              {group.items.map((item) => {
                const badge = badgeFor(item.to);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => ["admin-sidebar__link", isActive ? "admin-sidebar__link--active" : ""].filter(Boolean).join(" ")}
                    onClick={closeSidebar}
                  >
                    <Icon name={item.icon} size={18} />
                    <span>{item.label}</span>
                    {badge > 0 ? <span className="admin-sidebar__badge">{badge > 99 ? "99+" : badge}</span> : null}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={{ padding: "var(--space-4)", borderTop: "1px solid var(--color-border-inverse)" }}>
          <Link to="/" className="admin-sidebar__link">
            <Icon name="store" size={18} /> Ver a loja
          </Link>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar no-print">
          <button type="button" className="icon-btn icon-btn--light hide-desktop" onClick={toggleSidebar} aria-label="Abrir menu do painel">
            <Icon name="menu" size={20} />
          </button>

          <h1 className="admin-topbar__title">{currentTitle}</h1>

          <div className="row row-3 ml-auto">
            <Badge tone="accent" icon="shieldCheck">
              Administrador
            </Badge>
            <span className="text-sm text-muted hide-mobile">{user?.name}</span>
            <Button size="sm" variant="ghost" icon="logout" onClick={() => setConfirmarSaida(true)}>
              Sair
            </Button>
          </div>
        </header>

        <main className="admin-content">
          <Outlet />
        </main>
      </div>

      <ConfirmDialog
        open={confirmarSaida}
        title="Sair do painel"
        message="Você precisará entrar novamente para acessar a administração da loja."
        confirmLabel="Sair"
        cancelLabel="Continuar no painel"
        tone="primary"
        onConfirm={() => {
          setConfirmarSaida(false);
          clearSession();
          navigate("/admin/login", { replace: true });
        }}
        onCancel={() => setConfirmarSaida(false)}
      />
    </div>
  );
}
