import { imageSize } from "image-size";
import { env } from "../../env.js";
import { detectImageMime } from "../storage.js";
import {
  RemoteNetworkError,
  UnsafeUrlError,
  safeFetch,
  type FetchOptions,
  type RemoteResponse,
} from "./url-safety.js";

/**
 * Classificacao de uma URL de imagem.
 *
 * Regra central: erro TEMPORARIO nunca vira "imagem perdida". Estados de rede e
 * 5xx sao marcados como `retryable` e a UI oferece "Testar novamente".
 */
export type ImageCheckStatus =
  | "AVAILABLE"
  | "RECOVERABLE"
  | "REDIRECT"
  | "INVALID_URL"
  | "NOT_FOUND"
  | "SERVER_UNAVAILABLE"
  | "INVALID_CONTENT"
  | "ACCESS_BLOCKED"
  | "CONNECTION_ERROR";

export type ImageCheckResult = {
  status: ImageCheckStatus;
  /** Status HTTP final (null quando nem houve resposta). */
  httpStatus: number | null;
  contentType: string | null;
  format: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  finalUrl: string | null;
  redirected: boolean;
  /** Motivo legivel (nunca contem segredos). */
  reason: string | null;
  /** `true` quando vale a pena tentar de novo mais tarde. */
  retryable: boolean;
  /** Ja esta em um provedor de nuvem (Cloudinary)? */
  alreadyHosted: boolean;
};

export type CheckDeps = {
  fetch?: (url: string, options?: FetchOptions) => Promise<RemoteResponse>;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
};

const PROBE_BYTES = 512 * 1024;

const FORMAT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export function isCloudinaryUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === "res.cloudinary.com" || host.endsWith(".cloudinary.com");
  } catch {
    return false;
  }
}

const EMPTY: Omit<ImageCheckResult, "status" | "reason" | "retryable"> = {
  httpStatus: null,
  contentType: null,
  format: null,
  width: null,
  height: null,
  sizeBytes: null,
  finalUrl: null,
  redirected: false,
  alreadyHosted: false,
};

/**
 * Classifica uma resposta HTTP 2xx ja baixada (parcialmente).
 * Exportado para testes puros, sem rede.
 */
export function classifyImageResponse(
  response: Pick<RemoteResponse, "status" | "body" | "truncated" | "contentType" | "contentLength" | "redirects" | "finalUrl">,
  originalUrl: string,
): ImageCheckResult {
  const alreadyHosted = isCloudinaryUrl(originalUrl) || isCloudinaryUrl(response.finalUrl);
  const base = {
    ...EMPTY,
    httpStatus: response.status,
    contentType: response.contentType,
    finalUrl: response.finalUrl,
    redirected: response.redirects > 0 && response.finalUrl !== originalUrl,
    alreadyHosted,
  };

  if (response.status < 200 || response.status >= 300) {
    return classifyHttpStatus(response.status, base);
  }
  if (response.status === 204 || response.status === 205) {
    return { ...base, status: "INVALID_CONTENT", reason: "Resposta sem corpo.", retryable: false };
  }

  if (response.contentType) {
    const mime = response.contentType.split(";")[0]!.trim().toLowerCase();
    const acceptable = mime.startsWith("image/") || mime === "application/octet-stream" || mime === "binary/octet-stream";
    if (!acceptable) {
      return {
        ...base,
        status: "INVALID_CONTENT",
        reason: `O servidor respondeu "${mime}", que nao e uma imagem.`,
        retryable: false,
      };
    }
  }

  const magic = detectImageMime(response.body);
  if (!magic) {
    return {
      ...base,
      status: "INVALID_CONTENT",
      reason: "O conteudo baixado nao possui assinatura de imagem valida.",
      retryable: false,
    };
  }

  let width: number | null = null;
  let height: number | null = null;
  try {
    const size = imageSize(response.body);
    width = size.width ?? null;
    height = size.height ?? null;
  } catch {
    // Buffer parcial pode nao conter o cabecalho com dimensoes. O download
    // completo da recuperacao valida novamente; aqui nao invalidamos a imagem.
  }

  const format = FORMAT_BY_MIME[magic] ?? null;
  const sizeBytes = response.truncated ? null : (response.contentLength ?? response.body.length);

  if (format === "gif") {
    // GIF animado e aceito pelo upload, mas nao e um formato de produto comum.
  }

  return {
    ...base,
    status: base.redirected ? "REDIRECT" : alreadyHosted ? "AVAILABLE" : "RECOVERABLE",
    format,
    width,
    height,
    sizeBytes,
    reason: base.redirected
      ? `Redirecionado para ${response.finalUrl}`
      : alreadyHosted
        ? null
        : "Imagem acessivel e pronta para ser copiada para o Cloudinary.",
    retryable: false,
  };
}

function classifyHttpStatus(
  status: number,
  base: Omit<ImageCheckResult, "status" | "reason" | "retryable">,
): ImageCheckResult {
  if (status >= 300 && status < 400) {
    return {
      ...base,
      status: "REDIRECT",
      reason: `Redirecionamento HTTP ${status}.`,
      retryable: true,
    };
  }
  if (status === 429) {
    return {
      ...base,
      status: "ACCESS_BLOCKED",
      reason: "Limite de requisicoes do servidor remoto (HTTP 429).",
      retryable: true,
    };
  }
  if (status === 401 || status === 403 || status === 407 || status === 451) {
    return {
      ...base,
      status: "ACCESS_BLOCKED",
      reason: `Acesso bloqueado pelo servidor (HTTP ${status}).`,
      retryable: false,
    };
  }
  if (status === 404 || status === 410) {
    return {
      ...base,
      status: "NOT_FOUND",
      reason: `Arquivo nao encontrado (HTTP ${status}).`,
      retryable: false,
    };
  }
  if (status >= 500) {
    return {
      ...base,
      status: "SERVER_UNAVAILABLE",
      reason: `Servidor remoto indisponivel (HTTP ${status}).`,
      retryable: true,
    };
  }
  return {
    ...base,
    status: "INVALID_URL",
    reason: `O servidor recusou a requisicao (HTTP ${status}).`,
    retryable: false,
  };
}

function classifyError(error: unknown, originalUrl: string): ImageCheckResult {
  const base = { ...EMPTY, alreadyHosted: isCloudinaryUrl(originalUrl) };

  if (error instanceof UnsafeUrlError) {
    return {
      ...base,
      status: "INVALID_URL",
      reason: `Endereco bloqueado por seguranca: ${error.message}`,
      retryable: false,
    };
  }

  if (error instanceof RemoteNetworkError) {
    if (error.code === "ETIMEDOUT" || error.code === "ESOCKETTIMEDOUT" || error.code === "ABORT_ERR") {
      return {
        ...base,
        status: "SERVER_UNAVAILABLE",
        reason: "Tempo limite excedido ao contatar o servidor remoto.",
        retryable: true,
      };
    }
    if (error.code === "REDIRECT_LIMIT") {
      return {
        ...base,
        status: "REDIRECT",
        reason: "Redirecionamentos em excesso.",
        retryable: true,
      };
    }
    if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") {
      return {
        ...base,
        status: "CONNECTION_ERROR",
        reason: "Nao foi possivel resolver o endereco (DNS).",
        retryable: true,
      };
    }
    if (error.code === "REDIRECT_INVALIDO") {
      return { ...base, status: "INVALID_URL", reason: error.message, retryable: false };
    }
    return {
      ...base,
      status: "CONNECTION_ERROR",
      reason: `Falha de conexao com o servidor remoto (${error.code}).`,
      retryable: true,
    };
  }

  if (error instanceof Error && /certificate|TLS|SSL/i.test(error.message)) {
    return {
      ...base,
      status: "CONNECTION_ERROR",
      reason: "Falha de TLS/certificado ao acessar o servidor remoto.",
      retryable: false,
    };
  }

  return {
    ...base,
    status: "CONNECTION_ERROR",
    reason: "Erro inesperado ao verificar a imagem.",
    retryable: true,
  };
}

/**
 * Verifica uma URL de imagem.
 *
 * Usa GET com leitura parcial (streaming + abort). HEAD nao e usado como unico
 * metodo porque muitos servidores de imagem respondem 405/403 a HEAD.
 */
export async function checkImageUrl(rawUrl: string, deps: CheckDeps = {}): Promise<ImageCheckResult> {
  const fetchImpl = deps.fetch ?? safeFetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = Math.max(1, Math.min(3, deps.attempts ?? 2));

  let last: ImageCheckResult | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(rawUrl, {
        method: "GET",
        probeBytes: PROBE_BYTES,
        maxBytes: env.IMAGE_RECOVERY_MAX_MB * 1024 * 1024,
        timeoutMs: env.IMAGE_RECOVERY_TIMEOUT_MS,
        maxRedirects: env.IMAGE_RECOVERY_MAX_REDIRECTS,
      });

      if (response.status >= 200 && response.status < 300) {
        last = classifyImageResponse(response, rawUrl);
      } else {
        last = classifyHttpStatus(response.status, {
          ...EMPTY,
          httpStatus: response.status,
          contentType: response.contentType,
          finalUrl: response.finalUrl,
          redirected: response.redirects > 0,
          alreadyHosted: isCloudinaryUrl(rawUrl),
        });
      }
    } catch (error) {
      last = classifyError(error, rawUrl);
    }

    if (!last.retryable || attempt === attempts) return last;
    // Backoff curto: nao martela o servidor remoto nem o proprio processo.
    await sleep(250 * attempt);
  }

  return last ?? classifyError(new Error("unknown"), rawUrl);
}

/** Estados em que uma nova tentativa automatica faz sentido. */
export function isRetryableStatus(status: string): boolean {
  return ["SERVER_UNAVAILABLE", "CONNECTION_ERROR", "REDIRECT", "ACCESS_BLOCKED", "PENDING"].includes(status);
}

/** Estados em que a imagem pode ser baixada e migrada. */
export function isRecoverableStatus(status: string): boolean {
  return status === "RECOVERABLE" || status === "REDIRECT" || status === "AVAILABLE";
}

/** Estados que contam como "imagem funcionando" na UI. */
export function isWorkingStatus(status: string): boolean {
  return ["AVAILABLE", "RECOVERABLE", "REDIRECT", "CLOUDINARY", "RECOVERED", "PENDING_CONFIRMATION"].includes(status);
}

/** Estados que contam como "imagem quebrada" na UI. */
export function isBrokenStatus(status: string): boolean {
  return [
    "NOT_FOUND",
    "INVALID_URL",
    "INVALID_CONTENT",
    "ACCESS_BLOCKED",
    "SERVER_UNAVAILABLE",
    "CONNECTION_ERROR",
    "UNAVAILABLE",
  ].includes(status);
}

export const STATUS_LABELS: Record<string, string> = {
  PENDING: "Aguardando análise",
  AVAILABLE: "Disponível",
  RECOVERABLE: "Recuperável",
  REDIRECT: "Redirecionamento",
  INVALID_URL: "URL inválida",
  NOT_FOUND: "Arquivo não encontrado",
  SERVER_UNAVAILABLE: "Servidor indisponível",
  INVALID_CONTENT: "Conteúdo inválido",
  ACCESS_BLOCKED: "Bloqueio de acesso",
  CONNECTION_ERROR: "Erro de conexão",
  PENDING_CONFIRMATION: "Aguardando confirmação",
  RECOVERED: "Recuperada",
  CLOUDINARY: "No Cloudinary",
  UNAVAILABLE: "Indisponível",
};
