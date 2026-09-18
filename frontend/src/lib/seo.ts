/**
 * SEO em runtime (SPA).
 *
 * Aplica title, description, canonical, Open Graph e dados estruturados.
 * Regra do projeto: nenhum dado fictício. Os campos vêm do CMS quando
 * preenchidos; caso contrário usamos um texto neutro — nunca inventamos
 * preço, avaliação ou disponibilidade.
 */

const SITE_NAME = (import.meta.env.VITE_APP_NAME as string | undefined) ?? "MA STORE";

function upsertMeta(selector: string, attrs: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
}

function upsertLink(rel: string, href: string) {
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", rel);
    document.head.appendChild(element);
  }
  element.setAttribute("href", href);
}

export type SeoInput = {
  title: string;
  description?: string | null;
  image?: string | null;
  canonicalPath?: string;
  type?: "website" | "product" | "article";
  noindex?: boolean;
  /** Dados estruturados (JSON-LD) já montados com dados REAIS. */
  jsonLd?: Record<string, unknown> | null;
};

export function applySeo(input: SeoInput) {
  const fullTitle = input.title.includes(SITE_NAME) ? input.title : `${input.title} — ${SITE_NAME}`;
  document.title = fullTitle;

  const description = input.description?.trim() || null;
  if (description) {
    upsertMeta('meta[name="description"]', { name: "description", content: description });
  } else {
    document.head.querySelector('meta[name="description"]')?.remove();
  }

  upsertMeta('meta[property="og:title"]', { property: "og:title", content: fullTitle });
  upsertMeta('meta[property="og:site_name"]', { property: "og:site_name", content: SITE_NAME });
  upsertMeta('meta[property="og:type"]', { property: "og:type", content: input.type ?? "website" });
  upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
  upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: fullTitle });

  if (description) {
    upsertMeta('meta[property="og:description"]', { property: "og:description", content: description });
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
  }

  const image = input.image ?? "/og-image.png";
  upsertMeta('meta[property="og:image"]', { property: "og:image", content: image });
  upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: image });

  const url = `${window.location.origin}${input.canonicalPath ?? window.location.pathname}`;
  upsertMeta('meta[property="og:url"]', { property: "og:url", content: url });
  upsertLink("canonical", url);

  upsertMeta('meta[name="robots"]', {
    name: "robots",
    content: input.noindex ? "noindex, nofollow" : "index, follow",
  });

  const existing = document.head.querySelector('script[data-seo="jsonld"]');
  if (existing) existing.remove();

  if (input.jsonLd) {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.seo = "jsonld";
    script.textContent = JSON.stringify(input.jsonLd);
    document.head.appendChild(script);
  }
}

/** Remove o JSON-LD ao sair de uma página de produto. */
export function clearStructuredData() {
  document.head.querySelector('script[data-seo="jsonld"]')?.remove();
}

export { SITE_NAME };
