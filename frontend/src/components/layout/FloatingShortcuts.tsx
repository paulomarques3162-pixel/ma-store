import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "@/components/ui";
import { useCartCount } from "@/hooks";
import { useUiStore } from "@/stores/ui";

/**
 * Atalhos flutuantes.
 *
 * Desktop: barra vertical com carrinho, rastreio e busca.
 * Mobile: um único botão expansível (evita poluir a tela).
 * Nenhum atalho exige conta (Guest Checkout).
 */
export function FloatingShortcuts() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const openCartDrawer = useUiStore((s) => s.openCartDrawer);
  const openSearch = useUiStore((s) => s.openSearch);
  const cartCount = useCartCount();

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const shortcuts: Array<{ id: string; label: string; icon: IconName; badge?: number; action: () => void }> = [
    { id: "cart", label: "Carrinho", icon: "cart", badge: cartCount, action: openCartDrawer },
    {
      id: "orders",
      label: "Rastrear pedido",
      icon: "package",
      action: () => go("/rastreio"),
    },
    { id: "search", label: "Buscar", icon: "search", action: () => { setOpen(false); openSearch(); navigate("/buscar"); } },
  ];

  return (
    <div className="floating-shortcuts no-print" aria-label="Atalhos rápidos">
      {/* Desktop: atalhos sempre visíveis */}
      <div className="fab-stack hide-mobile">
        {shortcuts.map((shortcut) => (
          <button
            key={shortcut.id}
            type="button"
            className="fab"
            onClick={shortcut.action}
            aria-label={shortcut.label}
            title={shortcut.label}
          >
            <Icon name={shortcut.icon} size={19} />
            <span className="fab__label">{shortcut.label}</span>
            {shortcut.badge && shortcut.badge > 0 ? <span className="fab__badge">{shortcut.badge}</span> : null}
          </button>
        ))}
      </div>

      {/* Mobile: botão expansível */}
      <div className="hide-desktop">
        {open ? (
          <div className="fab-stack" style={{ marginBottom: "var(--space-2)" }}>
            {shortcuts.map((shortcut) => (
              <button key={shortcut.id} type="button" className="fab" onClick={shortcut.action} aria-label={shortcut.label}>
                <Icon name={shortcut.icon} size={19} />
                <span className="fab__label" style={{ display: "inline" }}>
                  {shortcut.label}
                </span>
                {shortcut.badge && shortcut.badge > 0 ? <span className="fab__badge">{shortcut.badge}</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          className={["fab fab--primary", open ? "is-open" : ""].filter(Boolean).join(" ")}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? "Fechar atalhos" : "Abrir atalhos rápidos"}
        >
          {open ? <Icon name="close" size={24} /> : <Icon name="sparkles" size={24} />}
        </button>
      </div>
    </div>
  );
}
