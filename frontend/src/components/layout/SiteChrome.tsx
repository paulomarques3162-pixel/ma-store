import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Badge, Icon, SearchInput, StoreLockup, StoreValue, type IconName } from "@/components/ui";
import { useCartCount, useCategories, useContent, useProductSearch, useToast } from "@/hooks";
import { useUiStore } from "@/stores/ui";
import { CONTENT_KEYS } from "@/lib/constants";
import { formatCurrency } from "@/lib/format";
import { buildStoreShare, shareOrCopy } from "@/lib/share";

/* ========================================================================== */
/* Busca com sugestões (autocomplete)                                          */
/* ========================================================================== */

function HeaderSearch({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const { data, isFetching } = useProductSearch(term);

  const go = (path: string) => {
    setOpen(false);
    onNavigate?.();
    navigate(path);
  };

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    go(`/buscar?q=${encodeURIComponent(trimmed)}`);
  };

  const suggestions = data?.data ?? [];

  return (
    <div style={{ position: "relative" }}>
      <SearchInput
        value={term}
        onValue={(value) => {
          setTerm(value);
          setOpen(value.trim().length >= 2);
        }}
        onSubmitQuery={submit}
        onBlur={() => window.setTimeout(() => setOpen(false), 180)}
        placeholder="Buscar perfumes, marcas…"
        aria-label="Buscar produtos"
        role="combobox"
        aria-expanded={open}
        aria-controls="header-search-suggestions"
      />

      {open ? (
        <div className="search-suggestions" id="header-search-suggestions" role="listbox">
          {isFetching && suggestions.length === 0 ? (
            <div className="search-suggestion search-suggestion--empty">Buscando…</div>
          ) : suggestions.length === 0 ? (
            <div className="search-suggestion search-suggestion--empty">Nenhum produto encontrado</div>
          ) : (
            suggestions.map((product) => (
              <button
                key={product.id}
                type="button"
                role="option"
                aria-selected={false}
                className="search-suggestion"
                onMouseDown={(event) => {
                  event.preventDefault();
                  go(`/produto/${product.slug}`);
                }}
              >
                <span className="search-suggestion__media">
                  <img src={product.images[0]?.url ?? "/placeholder-product.svg"} alt="" loading="lazy" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="search-suggestion__name truncate">{product.name}</span>
                  <span className="search-suggestion__meta">
                    {product.brand?.name ? `${product.brand.name} • ` : ""}
                    {formatCurrency(product.price)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ========================================================================== */
/* Header da loja                                                              */
/* ========================================================================== */

export function SiteHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const openCartDrawer = useUiStore((s) => s.openCartDrawer);
  const openMobileMenu = useUiStore((s) => s.openMobileMenu);

  const cartCount = useCartCount();
  const { data: categories } = useCategories();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  const handleShareStore = async () => {
    const result = await shareOrCopy(buildStoreShare());
    if (result === "copied") toast.success("Link copiado!", "Cole onde quiser para compartilhar a loja.");
    else if (result === "failed") toast.error("Não foi possível compartilhar", "Copie o endereço do navegador.");
  };

  const navLinks = [{ to: "/produtos", label: "Todos os produtos" }];

  return (
    <header className="site-header no-print">
      <div className="container">
        <div className="site-header__inner">
          <button type="button" className="icon-btn hide-desktop" onClick={openMobileMenu} aria-label="Abrir menu">
            <Icon name="menu" size={22} />
          </button>

          <Link to="/" className="site-header__brand" aria-label="MA STORE — página inicial">
            <StoreLockup emblemSize="md" className="header-lockup" />
          </Link>

          <nav className="site-header__nav hide-mobile" aria-label="Navegação principal">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={["site-header__link", location.pathname.startsWith(link.to) ? "site-header__link--active" : ""]
                  .filter(Boolean)
                  .join(" ")}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="site-header__search hide-mobile">
            <HeaderSearch />
          </div>

          <div className="site-header__actions">
            <button type="button" className="icon-btn hide-desktop" onClick={() => navigate("/buscar")} aria-label="Buscar">
              <Icon name="search" size={21} />
            </button>

            <button
              type="button"
              className="icon-btn hide-mobile"
              onClick={handleShareStore}
              aria-label="Compartilhar loja"
            >
              <Icon name="externalLink" size={21} />
            </button>

            <button
              type="button"
              className="icon-btn"
              onClick={openCartDrawer}
              aria-label={cartCount ? `Carrinho: ${cartCount} itens` : "Carrinho"}
            >
              <Icon name="cart" size={21} />
              {cartCount > 0 ? <span className="icon-btn__badge">{cartCount}</span> : null}
            </button>
          </div>
        </div>
      </div>

      {categories && categories.length > 0 ? (
        <div className="site-subnav">
          <div className="container">
            <nav className="site-subnav__inner" aria-label="Categorias">
              {categories.slice(0, 12).map((category) => (
                <Link key={category.id} to={`/categoria/${category.slug}`} className="site-subnav__link">
                  {category.name}
                  {category.productCount ? <span style={{ opacity: 0.6 }}> ({category.productCount})</span> : null}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      ) : null}

      <div className="container hide-desktop" style={{ paddingBottom: "var(--space-3)" }}>
        <HeaderSearch />
      </div>
    </header>
  );
}

/* ========================================================================== */
/* Menu mobile (drawer)                                                        */
/* ========================================================================== */

export function MobileMenu() {
  const open = useUiStore((s) => s.mobileMenuOpen);
  const close = useUiStore((s) => s.closeMobileMenu);
  const openCartDrawer = useUiStore((s) => s.openCartDrawer);
  const navigate = useNavigate();
  const { data: categories } = useCategories();
  const cartCount = useCartCount();

  if (!open) return null;

  const go = (path: string) => {
    close();
    navigate(path);
  };

  return (
    <div className="drawer-overlay" onClick={close} style={{ zIndex: "var(--z-drawer)" }}>
      <aside
        className="drawer drawer--left"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <header className="drawer__header">
          <StoreLockup emblemSize="sm" showTagline={false} />
          <button type="button" className="icon-btn icon-btn--light" onClick={close} aria-label="Fechar menu">
            <Icon name="close" size={20} />
          </button>
        </header>

        <div className="drawer__body stack stack-5">
          <div className="stack stack-2">
            <span className="eyebrow">Loja</span>
            <button type="button" className="account-nav__link" onClick={() => go("/produtos")}>
              <Icon name="grid" size={18} /> Todos os produtos
            </button>
            {(categories ?? []).slice(0, 8).map((category) => (
              <button key={category.id} type="button" className="account-nav__link" onClick={() => go(`/categoria/${category.slug}`)}>
                <Icon name="tag" size={18} /> {category.name}
              </button>
            ))}
          </div>

          <div className="stack stack-2">
            <span className="eyebrow">Acompanhe</span>
            <button type="button" className="account-nav__link" onClick={() => go("/rastreio")}>
              <Icon name="package" size={18} /> Rastrear pedido
            </button>
            <button type="button" className="account-nav__link" onClick={() => go("/carrinho")}>
              <Icon name="cart" size={18} /> Meu carrinho
            </button>
          </div>

          <div className="stack stack-2">
            <span className="eyebrow">Ajuda</span>
            <button type="button" className="account-nav__link" onClick={() => go("/como-comprar")}>
              <Icon name="clipboard" size={18} /> Como comprar
            </button>
            <button type="button" className="account-nav__link" onClick={() => go("/trocas-e-devolucoes")}>
              <Icon name="refresh" size={18} /> Trocas e devoluções
            </button>
            <button type="button" className="account-nav__link" onClick={() => go("/contato")}>
              <Icon name="mail" size={18} /> Contato
            </button>
            <button type="button" className="account-nav__link" onClick={() => go("/admin")}>
              <Icon name="shieldCheck" size={18} /> Admin
            </button>
          </div>
        </div>

        <div className="drawer__footer">
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => {
              close();
              openCartDrawer();
            }}
          >
            <Icon name="cart" size={18} /> Ver carrinho {cartCount > 0 ? <Badge tone="accent">{cartCount}</Badge> : null}
          </button>
        </div>
      </aside>
    </div>
  );
}

/* ========================================================================== */
/* Rodapé                                                                      */
/* ========================================================================== */

function SocialLinks() {
  const { get } = useContent();

  const links: Array<{ key: string; icon: IconName; label: string }> = [
    { key: CONTENT_KEYS.instagram, icon: "instagram", label: "Instagram" },
    { key: CONTENT_KEYS.facebook, icon: "facebook", label: "Facebook" },
    { key: CONTENT_KEYS.tiktok, icon: "tiktok", label: "TikTok" },
    { key: CONTENT_KEYS.youtube, icon: "youtube", label: "YouTube" },
  ];

  const available = links.filter((link) => get(link.key));

  if (available.length === 0) {
    return <p className="text-xs placeholder-value">Redes sociais não cadastradas</p>;
  }

  return (
    <div className="row row-3">
      {available.map((link) => (
        <a
          key={link.key}
          href={get(link.key) ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={link.label}
          style={{ color: "var(--color-text-inverse-muted)" }}
        >
          <Icon name={link.icon} size={20} />
        </a>
      ))}
    </div>
  );
}

/** Acesso administrativo — discreto, mas visível. Segurança real é o login + role. */
function AdminAccessButton() {
  return (
    <Link to="/admin" className="btn btn--ghost btn--sm" aria-label="Acesso administrativo">
      <Icon name="shieldCheck" size={15} /> Admin
    </Link>
  );
}

/** Compartilhamento da loja (Web Share API + fallback de copiar link). */
function StoreShareButton() {
  const toast = useToast();

  const handleShare = async () => {
    const result = await shareOrCopy(buildStoreShare());
    if (result === "copied") toast.success("Link copiado!", "Compartilhe a MA STORE onde quiser.");
    else if (result === "failed") toast.error("Não foi possível compartilhar");
  };

  return (
    <button type="button" className="btn btn--ghost btn--sm" onClick={handleShare}>
      <Icon name="externalLink" size={15} /> Compartilhar loja
    </button>
  );
}

export function SiteFooter() {
  const { data: categories } = useCategories();
  const { get } = useContent();
  const cnpj = get(CONTENT_KEYS.storeCnpj);

  return (
    <footer className="site-footer no-print">
      <div className="container">
        <div className="site-footer__grid">
          <div className="stack stack-4">
            <StoreLockup emblemSize="lg" />
            <p className="text-sm" style={{ color: "var(--color-text-inverse-muted)", maxWidth: "42ch" }}>
              <StoreValue k={CONTENT_KEYS.footerAbout} fallback="Informações sobre a loja ainda não cadastradas." />
            </p>
            <div className="site-footer__contact">
              <StoreValue k={CONTENT_KEYS.storeEmail} fallback="E-mail não cadastrado" />
              <StoreValue k={CONTENT_KEYS.storePhone} fallback="Telefone não cadastrado" />
              <StoreValue k={CONTENT_KEYS.storeAddress} fallback="Endereço não cadastrado" />
              <StoreValue k={CONTENT_KEYS.storeHours} fallback="Horário de atendimento não cadastrado" />
            </div>
          </div>

          <div>
            <h3 className="site-footer__title">Categorias</h3>
            <ul className="site-footer__list">
              {(categories ?? []).slice(0, 7).map((category) => (
                <li key={category.id}>
                  <Link to={`/categoria/${category.slug}`}>{category.name}</Link>
                </li>
              ))}
              {!categories || categories.length === 0 ? (
                <li className="placeholder-value">Nenhuma categoria cadastrada</li>
              ) : null}
            </ul>
          </div>

          <div>
            <h3 className="site-footer__title">Ajuda</h3>
            <ul className="site-footer__list">
              <li><Link to="/como-comprar">Como comprar</Link></li>
              <li><Link to="/trocas-e-devolucoes">Trocas e devoluções</Link></li>
              <li><Link to="/contato">Contato</Link></li>
              <li><Link to="/rastreio">Rastrear pedido</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="site-footer__title">Políticas</h3>
            <ul className="site-footer__list">
              <li><Link to="/politica-de-privacidade">Política de privacidade</Link></li>
              <li><Link to="/termos-de-uso">Termos de uso</Link></li>
            </ul>
            <h3 className="site-footer__title" style={{ marginTop: "var(--space-6)" }}>Redes sociais</h3>
            <SocialLinks />
            <div className="stack stack-2" style={{ marginTop: "var(--space-4)", alignItems: "flex-start" }}>
              <StoreShareButton />
              <AdminAccessButton />
            </div>
          </div>
        </div>

        <div className="site-footer__bottom">
          <span>
            <StoreValue k={CONTENT_KEYS.footerCopyright} fallback={`© ${new Date().getFullYear()} MA STORE`} />
          </span>
          <span>{cnpj ? `CNPJ: ${cnpj}` : ""}</span>
        </div>
      </div>
    </footer>
  );
}

/* ========================================================================== */
/* Barra inferior (mobile)                                                     */
/* ========================================================================== */

export function MobileBottomNav() {
  const location = useLocation();
  const cartCount = useCartCount();
  const openSearch = useUiStore((s) => s.openSearch);

  const items: Array<{ to: string; label: string; icon: IconName; badge?: number }> = [
    { to: "/", label: "Início", icon: "home" },
    { to: "/produtos", label: "Produtos", icon: "grid" },
    { to: "/buscar", label: "Buscar", icon: "search" },
    { to: "/carrinho", label: "Carrinho", icon: "cart", badge: cartCount },
    { to: "/rastreio", label: "Rastreio", icon: "package" },
  ];

  return (
    <nav className="mobile-bottom-nav no-print" aria-label="Navegação inferior">
      {items.map((item) => {
        const isActive =
          item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);

        // O item "Buscar" abre a tela de busca (rota dedicada).
        if (item.label === "Buscar") {
          return (
            <Link
              key={item.to}
              to="/buscar"
              className={["mobile-bottom-nav__item", isActive ? "mobile-bottom-nav__item--active" : ""].filter(Boolean).join(" ")}
              onClick={openSearch}
            >
              <Icon name={item.icon} size={21} />
              {item.label}
            </Link>
          );
        }

        return (
          <Link
            key={item.to}
            to={item.to}
            className={["mobile-bottom-nav__item", isActive ? "mobile-bottom-nav__item--active" : ""].filter(Boolean).join(" ")}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon name={item.icon} size={21} />
            {item.label}
            {item.badge && item.badge > 0 ? <span className="mobile-bottom-nav__badge">{item.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
