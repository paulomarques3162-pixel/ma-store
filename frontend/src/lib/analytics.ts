import { api } from "./api";

/**
 * Coleta de eventos de audiência (anônima e minimizada).
 *
 * - `sessionId` é um identificador opaco do navegador (não é login);
 * - nada de dados pessoais é enviado;
 * - deduplicação local evita contagem dupla por re-render;
 * - falhas de rede são ignoradas (métrica nunca quebra a loja).
 */

const SESSION_KEY = "mastore.analytics.session";
const DEDUPE_MS = 1500;
const recent = new Map<string, number>();

export function getAnalyticsSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sess-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return "anon";
  }
}

export type TrackType = "PAGE_VIEW" | "PRODUCT_VIEW" | "ADD_TO_CART" | "BEGIN_CHECKOUT" | "SEARCH";

export function trackEvent(type: TrackType, data: { path?: string; productId?: string } = {}): void {
  if (typeof window === "undefined") return;

  const dedupeKey = `${type}:${data.path ?? ""}:${data.productId ?? ""}`;
  const now = Date.now();
  const last = recent.get(dedupeKey) ?? 0;
  if (now - last < DEDUPE_MS) return;
  recent.set(dedupeKey, now);

  const eventId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `evt-${now}-${Math.random().toString(16).slice(2, 10)}`;

  const payload = {
    eventId,
    type,
    path: data.path ?? window.location.pathname,
    productId: data.productId,
    sessionId: getAnalyticsSessionId(),
    referrer: document.referrer || undefined,
  };

  // Fire-and-forget: nenhuma métrica pode atrapalhar a navegação.
  void api.post("/analytics/events", payload, { auth: false }).catch(() => undefined);
}
