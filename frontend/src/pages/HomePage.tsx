import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  EmptyState,
  Icon,
  SkeletonProductGrid,
  StoreLockup,
  StoreValue,
  type IconName,
} from "@/components/ui";
import { ProductGrid } from "@/components/product/ProductCard";
import { useBanners, useCategories, useContent, useProducts } from "@/hooks";
import { applySeo, SITE_NAME } from "@/lib/seo";
import { CONTENT_KEYS } from "@/lib/constants";
import { resolveImageUrl } from "@/lib/images";

/**
 * Página inicial.
 *
 * Hierarquia (auditoria de UX):
 *   header → hero → categorias → destaques → benefícios → lançamentos →
 *   ofertas → mais vendidos → chamada (newsletter) → rodapé
 *
 * Regra de ouro respeitada: NADA é inventado.
 *  - O hero usa o texto do CMS; sem texto, apresenta a marca (emblema + nome).
 *  - Cada seção só aparece quando existe produto real que a alimente.
 *  - Sem banner cadastrado, exibe o emblema da loja em vez de uma foto falsa.
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
      {/* ==================================================================
          HERO
      ================================================================== */}
      <section className={["hero", heroBanner?.imageUrl ? "" : "hero--placeholder"].filter(Boolean).join(" ")}>
        <div className="container">
          <div className="hero__inner">
            <div className="hero__content">
              <span className="eyebrow eyebrow--on-dark">Perfumes importados · árabes · decants</span>

              {heroTitle ? (
                <h1 className="hero__title">{heroTitle}</h1>
              ) : (
                <h1 className="hero__title">
                  A sua loja de <span className="text-gold-gradient">perfumes</span>
                </h1>
              )}

              {heroSubtitle ? (
                <p className="hero__subtitle">{heroSubtitle}</p>
              ) : (
                <p className="hero__subtitle">
                  <StoreValue
                    k={CONTENT_KEYS.storeTagline}
                    fallback="Explore o catálogo completo, monte seu pedido e acompanhe tudo pelo site."
                    placeholderStyle={false}
                  />
                </p>
              )}

              <div className="hero__actions">
                <Link to={heroCtaLink} className="btn btn--accent btn--lg">
                  <Icon name="grid" size={18} /> {heroCtaLabel}
                </Link>
                <Link
                  to="/como-comprar"
                  className="btn btn--ghost btn--lg"
                  style={{ color: "var(--color-text-inverse)", borderColor: "rgba(235, 178, 72, 0.4)" }}
                >
                  Como comprar
                </Link>
              </div>
            </div>

            <div className="hero__media">
              {heroBanner?.imageUrl ? (
                <img
                  src={resolveImageUrl(heroBanner.imageUrl) ?? undefined}
                  alt={heroBanner.title ?? "Destaque da loja"}
                  loading="eager"
                />
              ) : (
                <div className="hero__mark">
                  {/* Sem banner cadastrado: a própria marca ocupa o espaço. */}
                  <StoreLockup emblemSize="xl" />
                  <p>
                    {heroTitle
                      ? "Banner ainda não cadastrado no painel administrativo."
                      : "Cadastre banners e textos no painel para personalizar esta área."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================
          CATEGORIAS
      ================================================================== */}
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
                    {category.imageUrl ? (
                      <img src={resolveImageUrl(category.imageUrl) ?? undefined} alt="" loading="lazy" />
                    ) : (
                      category.name.charAt(0)
                    )}
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

      {/* ==================================================================
          DESTAQUES
      ================================================================== */}
      <ProductSection
        title={get(CONTENT_KEYS.sectionFeatured) ?? "Destaques"}
        query={featured}
        emptyTitle="Nenhum produto em destaque"
        emptyText="Marque produtos como destaque no painel para vê-los aqui."
      />

      {/* ==================================================================
          BENEFÍCIOS (fatos do sistema, não promessas comerciais)
      ================================================================== */}
      <section className="home-section home-section--alt">
        <div className="container">
          <div className="benefits">
            <Benefit icon="shieldCheck" title="Compra segura" text="Seus dados de acesso são protegidos e nunca compartilhados." />
            <Benefit icon="package" title="Acompanhe seu pedido" text="Veja o status e o histórico de cada etapa da compra." />
            <Benefit icon="message" title="Atendimento pela loja" text="Fale direto com o atendimento pela central de mensagens." />
            <Benefit icon="truck" title="Entrega para todo o Brasil" text="Modalidades e prazos reais são exibidos no checkout." />
          </div>
        </div>
      </section>

      {/* ==================================================================
          LANÇAMENTOS
      ================================================================== */}
      <ProductSection
        title={get(CONTENT_KEYS.sectionLaunches) ?? "Lançamentos"}
        query={launches}
        emptyTitle="Nenhum lançamento cadastrado"
        emptyText="Marque produtos como lançamento no painel para vê-los aqui."
      />

      {/* ==================================================================
          OFERTAS
      ================================================================== */}
      <ProductSection
        title={get(CONTENT_KEYS.sectionOffers) ?? "Ofertas"}
        query={offers}
        emptyTitle="Nenhuma oferta ativa"
        emptyText="Produtos com preço promocional cadastrado aparecem aqui."
        alt
      />

      {/* ==================================================================
          MAIS VENDIDOS
      ================================================================== */}
      <ProductSection
        title={get(CONTENT_KEYS.sectionBestSellers) ?? "Mais vendidos"}
        query={bestSellers}
        emptyTitle="Ainda sem histórico de vendas"
        emptyText="Esta seção é alimentada pelas vendas reais da loja."
      />

      {/* ==================================================================
          CHAMADA FINAL
      ================================================================== */}
      <section className="container" style={{ paddingBottom: "var(--space-12)" }}>
        <div className="newsletter">
          <div>
            <h2 className="newsletter__title">
              <StoreValue k={CONTENT_KEYS.newsletterTitle} fallback="Receba as novidades da loja" placeholderStyle={false} />
            </h2>
            <p className="newsletter__subtitle">
              <StoreValue
                k={CONTENT_KEYS.newsletterSubtitle}
                fallback="A loja ainda não cadastrou a descrição da newsletter."
              />
            </p>
          </div>

          <div className="stack stack-3">
            <form
              className="newsletter__form"
              onSubmit={(event) => {
                event.preventDefault();
              }}
            >
              <input type="email" className="input" placeholder="Seu e-mail" aria-label="Seu e-mail para a newsletter" required />
              <Button type="submit" variant="accent">
                Assinar
              </Button>
            </form>
            <Link to="/mensagens" className="btn btn--link" style={{ color: "var(--color-accent-bright)" }}>
              Prefere falar agora? <Icon name="arrowRight" size={15} />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Blocos reutilizáveis                                                        */
/* -------------------------------------------------------------------------- */

function Benefit({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="benefit">
      <span className="benefit__icon">
        <Icon name={icon} size={20} />
      </span>
      <div>
        <p className="benefit__title">{title}</p>
        <p className="benefit__text">{text}</p>
      </div>
    </div>
  );
}

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

  // Seção vazia continua visível: explica ao administrador por que não há itens.
  return (
    <section className={["home-section", alt ? "home-section--alt" : ""].filter(Boolean).join(" ")}>
      <div className="container">
        <div className="section-header">
          <h2 className="section-header__title">{title}</h2>
          <Link to="/produtos" className="btn btn--link">
            Ver todos <Icon name="arrowRight" size={16} />
          </Link>
        </div>

        {query.isLoading ? (
          <SkeletonProductGrid count={4} />
        ) : products.length === 0 ? (
          <EmptyState icon="box" title={emptyTitle} text={emptyText} />
        ) : (
          <ProductGrid products={products} />
        )}
      </div>
    </section>
  );
}

export { SITE_NAME };
