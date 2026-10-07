/**
 * Utilitarios de frete do frontend.
 *
 * O `sessionId` e um identificador OPACO gerado no navegador e guardado em
 * localStorage. Ele nao e credencial: serve apenas para vincular a cotacao de
 * frete a mesma sessao de checkout (o backend rejeita cotacao de outra sessao).
 */
const SESSION_KEY = "mastore.shippingSessionId";

export function getShippingSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sess-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    localStorage.setItem(SESSION_KEY, generated);
    return generated;
  } catch {
    // Modo privado / storage indisponivel: sessao efemera.
    return `sess-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }
}

/** Prazo estimado do motor proprio, exibido apenas quando configurado. */
export function formatShippingDeadline(days: number | null): string {
  if (days === null) return "Prazo a confirmar";
  if (days === 0) return "Mesmo dia / retirada";
  if (days === 1) return "1 dia útil";
  return `Até ${days} dias úteis`;
}
