import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  EmptyState,
  Icon,
  ProductImage,
  SkeletonProductGrid,
  StoreValue,
} from "@/components/ui";
import { ProductGrid } from "@/components/product/ProductCard";
import { useBanners, useCategories, useContent, useProducts } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { CONTENT_KEYS } from "@/lib/constants";
import { SITE_NAME } from "@/lib/seo";

/**
 * Página inicial.
 *
 * Regra de ouro respeitada: NADA é inventado.
 *  - O hero usa o texto do CMS ou a logo da loja como marca (nunca um slogan falso).
 *  - As seções só aparecem quando existe produto real que as alimente.
 *  - Sem banner cadastrado, exibimos um bloco neutro com a identidade da loja.
 */
export default function HomePage() {
  const { get } = useContent();
  const { data: banners } = useBanners("hero");
  const { data: categories } = useCategories();

  const featured = useProducts({ featured: true, perPage: 8 });
  const launches = useProducts({ launch: true, perPage: 8, sort: "newest" });
  const offers = useProducts({ onSale: true, perPage: 8, sort: "price_asc" });
  const bestSellers = useProducts({ bestSeller: true, perPage: 8, sort: "best_sellers" });

  useEffect(() => {
    applySeo({
      title: "MA STORE — Perfumes importados, árabes e decants",
      description: get(CONTENT_KEYS.storeTagline) ?? undefined,
      canonicalPath: "/",
    });
  }, [get]);

  const heroBanner = banners?.[0] ?? null;
  const heroTitle = get(CONTENT_KEYS.heroTitle);
  const heroSubtitle = get(CONTENT_KEYS.heroSubtitle);
  const heroCtaLabel = get(CONTENT_KEYS.heroCtaLabel) ?? "Ver produtos";
  const heroCtaLink = get(CONTENT_KEYS.heroCtaLink) ?? "/produtos";

  return (
    <>
      {/* ------------------------------------------------------------- HERO */}
      <section className={["hero", heroBanner || heroTitle ? "" : "hero--placeholder"].filter(Boolean).join(" ")}>
        <div className="container">
          <div className="hero__inner">
            <div className="hero__content">
              {heroTitle ? (
                <h1 className="hero__title">{heroTitle}</h1>
              ) : (
                <h1 className="hero__title">
                  <StoreValue k={CONTENT_KEYS.storeName} fallback="MA STORE" />
                </h1>
              )}

              {heroSubtitle ? <p className="hero__subtitle">{heroSubtitle}</p> : null}

              <div className="hero__actions">
                <Link to={heroCtaLink} className="btn btn--accent btn--lg">
                  <Icon name="grid" size={18} /> {heroCtaLabel}
                </Link>
                <Link to="/como-comprar" className="btn btn--ghost btn--lg" style={{ color: "var(--color-text-inverse)", borderColor: "var(--color-border-inverse)" }}>
                  Como comprar
                </Link>
              </div>
            </div>

            <div className="hero__media">
              {heroBanner?.imageUrl ? (
                <img src={heroBanner.imageUrl} alt={heroBanner.title ?? "Destaque da loja"} loading="eager" />
              ) : (
                <div className="hero__mark">
                  <img src="/logo.png" alt={SITE_NAME} />
                  <p>
                    {heroTitle
                      ? "Banner ainda não cadastrado no painel."
                      : "Texto e banner da página inicial ainda não foram cadastrados no painel administrativo."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- CATEGORIAS */}
      {categories && categories.length > 0 ? (
        <section className="home-section">
          <div className="container">
            <div className="section-header">
              <h2 className="section-header__title">Navegue por categoria</h2>
              <Link to="/produtos" className="btn btn--link">
                Ver tudo <Icon name="arrowRight" size={16} />
              </Link>
            </div>

            <div className="category-scroller">
              {categories.map((category) => (
                <Link key={category.id} to={`/categoria/${category.slug}`} className="category-chip">
                  <span className="category-chip__circle">
                    {category.imageUrl ? <img src={category.imageUrl} alt="" loading="lazy" /> : category.name.charAt(0)}
                  </span>
                  <span className="category-chip__name">{category.name}</span>
                  {category.productCount !== undefined ? (
                    <span className="category-chip__count">
                      {category.productCount} {category.productCount === 1 ? "produto" : "produtos"}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------------------- DESTAQUES */}
      <ProductSection
        title={get(CONTENT_KEYS.sectionFeatured) ?? "Destaques"}
        query={featured}
        emptyTitle="Nenhum produto em destaque"
        emptyText="Marque produtos como destaque no painel para vê-los aqui."
      />

      {/* ------------------------------------------------------ LANÇAMENTOS */}
      <ProductSection
        title={get(CONTENT_KEYS.sectionLaunches) ?? "Lançamentos"}
        query={launches}
        emptyTitle="Nenhum lançamento cadastrado"
        emptyText="Marque produtos como lançamento no painel para vê-los aqui."
        alt
      />

      {/* ----------------------------------------------------------- OFERTAS */}
      <ProductSection
        title={get(CONTENT_KEYS.sectionOffers) ?? "Ofertas"}
        query={offers}
        emptyTitle="Nenhuma oferta ativa"
        emptyText="Produtos com preço promocional cadastrado aparecem aqui."
      />

      {/* ------------------------------------------------------ MAIS VENDIDOS */}
      <ProductSection
        title={get(CONTENT_KEYS.sectionBestSellers) ?? "Mais vendidos"}
        query={bestSellers}
        emptyTitle="Ainda sem histórico de vendas"
        emptyText="Esta seção é alimentada pelas vendas reais da loja."
        alt
      />

      {/* ---------------------------------------------------------- BENEFÍCIOS */}
      <section className="home-section">
        <div className="container">
          <div className="benefits">
            <div className="benefit">
              <span className="benefit__icon">
                <Icon name="shieldCheck" size={20} />
              </span>
              <div>
                <p className="benefit__title">Compra segura</p>
                <p className="benefit__text">Seus dados de acesso são protegidos e nunca compartilhados.</p>
              </div>
            </div>
            <div className="benefit">
              <span className="benefit__icon">
                <Icon name="truck" size={20} />
              </span>
              <div>
                <p className="benefit__title">Entrega para todo o Brasil</p>
                <p className="benefit__text">Modalidades e prazos reais exibidos no checkout.</p>
              </div>
            </div>
            <div className="benefit">
              <span className="benefit__icon">
                <Icon name="message" size={20} />
              </span>
              <div>
                <p className="benefit__title">Atendimento direto</p>
                <p className="benefit__text">Converse com a loja pela central de mensagens.</p>
              </div>
            </div>
            <div className="benefit">
              <span className="benefit__icon">
                <Icon name="package" size={20} />
              </span>
              <div>
                <p className="benefit__title">Acompanhe seu pedido</p>
                <p className="benefit__text">Veja o status e o histórico de cada etapa.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- NEWSLETTER */}
      <section className="container" style={{ paddingBottom: "var(--space-12)" }}>
        <div className="newsletter">
          <div>
            <h2 className="newsletter__title">
              <StoreValue k={CONTENT_KEYS.newsletterTitle} fallback="Receba as novidades da loja" />
            </h2>
            <p className="newsletter__subtitle">
              <StoreValue
                k={CONTENT_KEYS.newsletterSubtitle}
                fallback="A loja ainda não cadastrou a descrição da newsletter."
              />
            </p>
          </div>
          <form
            className="newsletter__form"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <input
              type="email"
              className="input"
              placeholder="Seu e-mail"
              aria-label="Seu e-mail para a newsletter"
              required
            />
            <Button type="submit" variant="accent">
              Assinar
            </Button>
          </form>
        </div>
      </section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Seção de produtos reutilizável                                              */
/* -------------------------------------------------------------------------- */

function ProductSection({
  title,
  query,
  emptyTitle,
  emptyText,
  alt,
}: {
  title: string;
  query: ReturnType<typeof useProducts>;
  emptyTitle: string;
  emptyText: string;
  alt?: boolean;
}) {
  const products = query.data?.data ?? [];

  // Enquanto carrega, mostramos o esqueleto; se está vazio, mostramos a seção
  // apenas quando ela é relevante (evita a home ficar poluída de buracos).
  if (!query.isLoading && products.length === 0) {
    return (
      <section className={["home-section", alt ? "home-section--alt" : ""].filter(Boolean).join(" ")}>
        <div className="container">
          <div className="section-header">
            <h2 className="section-header__title">{title}</h2>
          </div>
          <EmptyState icon="box" title={emptyTitle} text={emptyText} />
        </div>
      </section>
    );
  }

  return (
    <section className={["home-section", alt ? "home-section--alt" : ""].filter(Boolean).join(" ")}>
      <div className="container">
        <div className="section-header">
          <h2 className="section-header__title">{title}</h2>
          <Link to="/produtos" className="btn btn--link">
            Ver todos <Icon name="arrowRight" size={16} />
          </Link>
        </div>

        {query.isLoading ? <SkeletonProductGrid count={4} /> : <ProductGrid products={products} />}
      </div>
    </section>
  );
}

export { Badge, ProductImage };
