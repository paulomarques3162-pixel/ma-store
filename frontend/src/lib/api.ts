/**
 * Cliente HTTP da MA STORE.
 *
 * Responsabilidades:
 *  - montar a URL base (relativa em dev via proxy, absoluta em produção);
 *  - desembrulhar o envelope `{ data, meta }`;
 *  - transformar o envelope de erro em `ApiError` (com `requestId` e `details`);
 *  - renovar o access token uma única vez em caso de 401 e repetir a requisição;
 *  - serializar query strings ignorando valores vazios.
 *
 * NUNCA guarda segredo algum: apenas o token de sessão do próprio usuário.
 */

import type { PaginationMeta } from "@/types/api";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

const ACCESS_TOKEN_KEY = "mastore.accessToken";
const REFRESH_TOKEN_KEY = "mastore.refreshToken";

export type ApiErrorPayload = {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message || "Não foi possível concluir a operação.");
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
    this.requestId = payload.requestId;
  }

  /** E-mail/senha incorretos, sessão expirada, etc. */
  get isAuthError() {
    return this.status === 401;
  }

  get isValidationError() {
    return this.status === 422 || this.code === "VALIDATION_ERROR";
  }

  /** Lista de erros por campo, quando o backend devolve `details` do Zod. */
  get fieldErrors(): Record<string, string> {
    const details = this.details;
    if (!Array.isArray(details)) return {};
    const out: Record<string, string> = {};
    for (const item of details) {
      const entry = item as { field?: string; message?: string };
      if (entry?.field) out[entry.field] = entry.message ?? "Valor inválido.";
    }
    return out;
  }
}

/* -------------------------------------------------------------------------- */
/* Token storage                                                              */
/* -------------------------------------------------------------------------- */

export const tokenStore = {
  getAccess: (): string | null => {
    try {
      return localStorage.getItem(ACCESS_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  getRefresh: (): string | null => {
    try {
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(accessToken: string, refreshToken: string) {
    try {
      localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    } catch {
      /* modo privado / storage indisponível */
    }
  },
  clear() {
    try {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      /* ignora */
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

type QueryValue = string | number | boolean | null | undefined | Array<string | number>;

export function buildQuery(params?: Record<string, QueryValue>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(","));
    } else {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  auth?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type ApiResult<T> = { data: T; meta?: PaginationMeta };

/* -------------------------------------------------------------------------- */
/* Refresh de token (uma tentativa concorrente)                               */
/* -------------------------------------------------------------------------- */

type RefreshListener = () => void;
const refreshListeners = new Set<RefreshListener>();

/** Assina o evento de "sessão encerrada" (ex.: para redirecionar ao login). */
export function onSessionExpired(listener: RefreshListener) {
  refreshListeners.add(listener);
  return () => refreshListeners.delete(listener);
}

function emitSessionExpired() {
  tokenStore.clear();
  for (const listener of refreshListeners) {
    try {
      listener();
    } catch {
      /* um listener com erro não deve derrubar os demais */
    }
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return false;

  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) return false;

      const payload = (await response.json()) as { data?: { accessToken?: string; refreshToken?: string } };
      const accessToken = payload.data?.accessToken;
      const newRefresh = payload.data?.refreshToken;
      if (!accessToken || !newRefresh) return false;

      tokenStore.set(accessToken, newRefresh);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/* -------------------------------------------------------------------------- */
/* Requisição                                                                 */
/* -------------------------------------------------------------------------- */

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, headers, signal } = options;
  const auth = options.auth !== false; // autentica por padrão quando houver token

  const url = `${API_URL}${path}${buildQuery(query)}`;

  const doFetch = async (): Promise<Response> => {
    const accessToken = auth ? tokenStore.getAccess() : null;
    return fetch(url, {
      method,
      signal,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let response: Response;
  try {
    response = await doFetch();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "Não foi possível conectar. Verifique sua internet e tente novamente.",
    });
  }

  // 401 -> tenta renovar UMA vez e repete a requisição
  if (response.status === 401 && auth && tokenStore.getRefresh()) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      try {
        response = await doFetch();
      } catch {
        throw new ApiError(0, {
          code: "NETWORK_ERROR",
          message: "Não foi possível conectar. Verifique sua internet e tente novamente.",
        });
      }
    } else {
      emitSessionExpired();
    }
  } else if (response.status === 401 && auth) {
    emitSessionExpired();
  }

  // 204 sem corpo
  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorPayload = (payload as { error?: ApiErrorPayload } | null)?.error;
    throw new ApiError(
      response.status,
      errorPayload ?? {
        code: "UNKNOWN_ERROR",
        message: "Não foi possível concluir a operação. Tente novamente.",
      },
    );
  }

  const envelope = payload as { data?: unknown; meta?: unknown } | null;
  if (envelope && typeof envelope === "object" && "data" in envelope) {
    const data = envelope.data as T;

    if (typeof data === "object" && data !== null) {
      // `requestList` precisa do `meta`; guardamos num anexo não enumerável.
      if (envelope.meta) {
        Object.defineProperty(data, "__meta", { value: envelope.meta, enumerable: false });
      }

      // Alguns endpoints devolvem campos extras no envelope (ex.: `statusCounts`
      // em /admin/orders). Preservamos sem poluir o objeto de domínio.
      const extras = Object.fromEntries(
        Object.entries(envelope).filter(([key]) => key !== "data" && key !== "meta"),
      );
      if (Object.keys(extras).length > 0) {
        Object.defineProperty(data, "__extra", { value: extras, enumerable: false });
      }
    }

    return data;
  }

  return payload as T;
}

/** Igual a `request`, mas devolve `{ data, meta }` para listagens paginadas. */
export async function requestList<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const data = await request<T>(path, options);
  const meta = (data as { __meta?: PaginationMeta } | null)?.__meta;
  return { data, meta };
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) => request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PUT", body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "DELETE" }),
  list: requestList,
};

/** Mensagem amigável a partir de qualquer erro (nunca expõe stack trace). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Não foi possível concluir a operação. Tente novamente.";
}

/** `requestId` para exibir ao usuário e facilitar o suporte. */
export function errorRequestId(error: unknown): string | null {
  return error instanceof ApiError ? (error.requestId ?? null) : null;
}

/**
 * Erros por campo, quando o backend devolve detalhes de validacao (Zod).
 * Atalho para `ApiError.fieldErrors`, usado pelos formularios.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError ? error.fieldErrors : {};
}

/**
 * Campos extras devolvidos no envelope da resposta (fora de `data`/`meta`).
 * Ex.: `statusCounts` de GET /api/admin/orders.
 */
export function envelopeExtras<T>(data: T | undefined): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  return ((data as { __extra?: Record<string, unknown> }).__extra ?? {}) as Record<string, unknown>;
}
