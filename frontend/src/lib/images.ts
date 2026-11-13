/**
 * Resolução centralizada de URLs de imagem.
 *
 * O backend passa a gravar uploads como caminho RELATIVO (`/uploads/<arquivo>`)
 * para não guardar o host do servidor (a antiga URL `http://localhost:3333/...`
 * era o motivo de imagens quebradas em produção). Aqui resolvemos a origem real.
 *
 * Regras:
 *  - `http(s)://...` válido → devolvido como está;
 *  - caminho interno `/uploads/x.jpg` → prefixado com a origem da API;
 *  - host de loopback salvo por engano → reescrito para a origem da API (fora de localhost);
 *  - `data:image/...` e `blob:` (preview local) → devolvidos (nunca são persistidos no banco);
 *  - vazio/nulo ou esquema perigoso → `null` (o componente mostra o placeholder).
 */

const RAW_API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

/**
 * Origem da API (sem `/api`). Vazia quando `VITE_API_URL` é relativo (dev), caso
 * em que usamos o mesmo domínio e o proxy do Vite encaminha `/uploads`.
 */
export const API_ORIGIN = /^https?:\/\//i.test(RAW_API_URL)
  ? RAW_API_URL.replace(/\/api\/?$/i, "").replace(/\/+$/, "")
  : "";

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i;
const PLACEHOLDER = "/placeholder-product.svg";

export function resolveImageUrl(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const value = raw.trim();
  if (!value) return null;

  // Preview local nunca vai para o banco (a validação do backend também rejeita).
  if (/^blob:/i.test(value)) return value;
  if (/^data:image\//i.test(value)) return value;
  if (/^data:/i.test(value)) return null;
  // Qualquer outro esquema (javascript:, mailto:, etc.) é recusado.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return null;

  if (LOOPBACK.test(value)) {
    // URL de loopback gravada por engano: aponta para o backend real em produção.
    return API_ORIGIN ? value.replace(LOOPBACK, API_ORIGIN) : value;
  }

  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${API_ORIGIN}${value}`;
  return `${API_ORIGIN}/${value}`;
}

export { PLACEHOLDER as IMAGE_PLACEHOLDER };

/* ==========================================================================
 * Variantes otimizadas (srcset)
 * ==========================================================================
 *
 * O backend gera variantes WebP a partir do ORIGINAL (nunca destrutivo) e as
 * expõe em `/uploads/opt/<largura>/<arquivo>`. Aqui montamos o `srcset` apenas
 * para uploads locais — imagens de CDN externo continuam com a URL original,
 * porque não temos como saber quais tamanhos existem lá.
 */

/** Larguras geradas pelo backend (`IMAGE_VARIANT_WIDTHS`). */
export const IMAGE_VARIANT_WIDTHS = [320, 640, 960, 1280] as const;

const LOCAL_UPLOAD = /^(.*)\/uploads\/([^/?#]+)$/i;
const NOT_TRANSFORMABLE = /\.(gif|svg)$/i;

/**
 * Devolve o `srcSet` com as variantes WebP, ou `undefined` quando a imagem não
 * é um upload local transformável (aí o navegador usa só o `src` original).
 */
export function buildImageSrcSet(
  raw: string | null | undefined,
  widths: readonly number[] = IMAGE_VARIANT_WIDTHS,
): string | undefined {
  const resolved = resolveImageUrl(raw);
  if (!resolved) return undefined;

  const match = resolved.match(LOCAL_UPLOAD);
  if (!match) return undefined;

  const [, base, filename] = match;
  if (!filename || NOT_TRANSFORMABLE.test(filename)) return undefined;

  const candidates = widths
    .filter((width) => Number.isInteger(width) && width > 0)
    .map((width) => `${base}/uploads/opt/${width}/${filename} ${width}w`);

  return candidates.length >= 2 ? candidates.join(", ") : undefined;
}

/** `sizes` prontos para os layouts da loja (evitam baixar variante grande à toa). */
export const IMAGE_SIZES = {
  /** Card da vitrine: 2 colunas no celular, até ~260px no desktop. */
  card: "(max-width: 480px) 45vw, (max-width: 768px) 30vw, 260px",
  /** Galeria da página do produto. */
  gallery: "(max-width: 768px) 100vw, 560px",
  /** Miniatura (carrinho, lista de pedidos, thumbs). */
  thumb: "72px",
} as const;
