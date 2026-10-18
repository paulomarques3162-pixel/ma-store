/**
 * Histórico de pedidos do PRÓPRIO navegador (Guest Checkout).
 *
 * A loja opera sem conta: o token de rastreio é a única credencial do pedido.
 * Para oferecer "Minhas compras" sem login, guardamos localmente apenas os
 * TOKENS dos pedidos que este navegador criou/consultou. Nada de dados pessoais,
 * valores ou itens são persistidos aqui — o conteúdo é sempre buscado no
 * servidor pelo token (`GET /api/rastreio/:token`).
 *
 * Privacidade/segurança:
 *  - o token é opaco e longo; sem ele ninguém acessa o pedido;
 *  - o armazenamento é isolado por navegador (não há cache compartilhado);
 *  - limpar os dados do navegador apaga o histórico (comportamento esperado).
 */

const STORAGE_KEY = "mastore.guestOrders.v1";
const MAX_ENTRIES = 50;
const MIN_TOKEN_LENGTH = 10;

export type GuestOrderRef = {
  token: string;
  addedAt: string;
};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRef(value: unknown): value is GuestOrderRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as GuestOrderRef).token === "string" &&
    (value as GuestOrderRef).token.length >= MIN_TOKEN_LENGTH
  );
}

/** Tokens conhecidos por este navegador, do mais recente para o mais antigo. */
export function listGuestOrderTokens(): string[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRef).slice(0, MAX_ENTRIES).map((entry) => entry.token);
  } catch {
    return [];
  }
}

/** Guarda o token de um pedido (idempotente; o mais recente vai para o topo). */
export function rememberGuestOrder(token: string | null | undefined): void {
  const clean = (token ?? "").trim();
  if (clean.length < MIN_TOKEN_LENGTH) return;
  const store = storage();
  if (!store) return;
  try {
    const current = listGuestOrderTokens().filter((existing) => existing !== clean);
    const next: GuestOrderRef[] = [
      { token: clean, addedAt: new Date().toISOString() },
      ...current.map((existing) => ({ token: existing, addedAt: new Date().toISOString() })),
    ].slice(0, MAX_ENTRIES);
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Modo privado / cota cheia: o histórico simplesmente não persiste.
  }
}

/** Remove um pedido do histórico deste navegador. */
export function forgetGuestOrder(token: string): void {
  const store = storage();
  if (!store) return;
  try {
    const next = listGuestOrderTokens().filter((existing) => existing !== token);
    store.setItem(STORAGE_KEY, JSON.stringify(next.map((existing) => ({ token: existing, addedAt: new Date().toISOString() }))));
  } catch {
    // Ignora falha de armazenamento.
  }
}

/** Esvazia o histórico local (não afeta os pedidos no servidor). */
export function clearGuestOrders(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Ignora falha de armazenamento.
  }
}
