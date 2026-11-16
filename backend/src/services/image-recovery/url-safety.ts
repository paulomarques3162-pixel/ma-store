import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { env } from "../../env.js";

/**
 * Guarda-corpo SSRF para o recuperador de imagens.
 *
 * Por que existe: o backend passa a buscar URLs externas informadas em banco.
 * Sem validacao, um registro malicioso poderia apontar para `127.0.0.1`, para
 * `169.254.169.254` (metadata de nuvem) ou para servicos internos do Render.
 *
 * Regras aplicadas em TODA requisicao (inclusive depois de cada redirect):
 *  1. somente HTTP/HTTPS;
 *  2. sem credenciais embutidas (`user:pass@`);
 *  3. host proibido (localhost, .local, .internal, metadata.google.internal...);
 *  4. IP literal validado;
 *  5. DNS resolvido ANTES da conexao e TODOS os enderecos precisam ser publicos;
 *  6. a conexao e PINADA no IP validado (evita DNS rebinding);
 *  7. limite de redirects, timeout e tamanho maximo.
 *
 * A biblioteca global `fetch` NAO e usada de proposito: ela nao permite fixar o
 * IP resolvido, deixando uma janela para DNS rebinding.
 */

export type SafeUrl = {
  url: URL;
  addresses: string[];
};

export class UnsafeUrlError extends Error {
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = "UnsafeUrlError";
    this.reason = reason;
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp"];

/** Faixas IPv4 que NUNCA podem ser acessadas pelo recuperador. */
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local + metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservado + broadcast
];

/** Enderecos de metadata de provedores de nuvem (defesa em profundidade). */
const METADATA_IPS = new Set([
  "169.254.169.254", // AWS / GCP / Azure / OpenStack
  "169.254.170.2", // AWS ECS task metadata
  "100.100.100.200", // Alibaba Cloud
  "192.0.0.192", // Oracle Cloud
  "168.63.129.16", // Azure WireServer
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    value = (value << 8) + n;
  }
  return value >>> 0;
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a === null || b === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

/** Normaliza IPv6 para comparacao (expande `::` e remove zona). */
function normalizeIpv6(ip: string): string {
  const clean = ip.split("%")[0]!.toLowerCase();
  if (!clean.includes("::")) return clean;
  const [head, tail] = clean.split("::") as [string, string];
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  return [...headParts, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...tailParts].join(":");
}

function isBlockedIpv6(raw: string): boolean {
  const ip = normalizeIpv6(raw);

  // IPv4 mapeado (::ffff:127.0.0.1) — valida o IPv4 embutido.
  const mapped = ip.match(/^0:0:0:0:0:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const hi = parseInt(mapped[1]!, 16);
    const lo = parseInt(mapped[2]!, 16);
    const v4 = [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
    return isBlockedIp(v4);
  }

  if (ip === "0:0:0:0:0:0:0:1" || ip === "0:0:0:0:0:0:0:0") return true; // ::1 / ::
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // ULA fc00::/7
  if (/^fe[89ab]/.test(ip)) return true; // link-local fe80::/10
  if (ip.startsWith("ff")) return true; // multicast
  if (ip.startsWith("64:ff9b")) return true; // NAT64
  if (ip.startsWith("2001:db8")) return true; // documentacao
  if (ip.startsWith("2001:0:")) return true; // Teredo
  // AWS IPv6 metadata (fd00:ec2::254) ja cai em ULA.
  return false;
}

/** `true` quando o IP e privado/reservado e deve ser bloqueado. */
export function isBlockedIp(raw: string): boolean {
  const ip = raw.trim().replace(/^\[|\]$/g, "");

  // IPv4 mapeado em IPv6 com notacao pontuada (::ffff:127.0.0.1).
  const dottedMapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (dottedMapped) return isBlockedIp(dottedMapped[1]!);

  const version = isIP(ip);
  if (version === 4) {
    if (METADATA_IPS.has(ip)) return true;
    return BLOCKED_V4.some(([base, bits]) => inCidr(ip, base, bits));
  }
  if (version === 6) return isBlockedIpv6(ip);
  // Entrada que nao e IP nao deveria chegar aqui; por seguranca, bloqueia.
  return true;
}

function assertHostnameAllowed(hostname: string): void {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("Endereco sem host.", "HOST_VAZIO");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new UnsafeUrlError("Endereco aponta para host interno e foi bloqueado.", "HOST_INTERNO");
  }
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new UnsafeUrlError("Endereco aponta para dominio interno e foi bloqueado.", "DOMINIO_INTERNO");
  }
  if (isIP(host) && isBlockedIp(host)) {
    throw new UnsafeUrlError("Endereco aponta para IP privado/reservado e foi bloqueado.", "IP_PRIVADO");
  }
}

/**
 * Valida sintaxe + destino DNS. Retorna a URL e os IPs publicos validados.
 *
 * O resolvedor e injetavel para testes deterministicos (sem DNS real).
 */
export async function assertSafeUrl(
  raw: string,
  deps: { resolve?: (hostname: string) => Promise<string[]> } = {},
): Promise<SafeUrl> {
  let url: URL;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new UnsafeUrlError("URL invalida.", "URL_INVALIDA");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Somente HTTP e HTTPS sao permitidos.", "PROTOCOLO_INVALIDO");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URL com credenciais embutidas foi bloqueada.", "CREDENCIAIS_NA_URL");
  }
  if (!url.hostname) throw new UnsafeUrlError("URL sem host.", "HOST_VAZIO");

  // `URL.hostname` devolve IPv6 entre colchetes; normaliza antes de validar.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  assertHostnameAllowed(hostname);

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new UnsafeUrlError("Endereco aponta para IP privado/reservado e foi bloqueado.", "IP_PRIVADO");
    }
    return { url, addresses: [hostname] };
  }

  const resolve = deps.resolve ?? (async (host: string) => {
    const records = await dnsLookup(host, { all: true, verbatim: true });
    return records.map((record) => record.address);
  });

  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new UnsafeUrlError("Nao foi possivel resolver o DNS do endereco.", "DNS_FALHOU");
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError("O endereco nao possui registros DNS.", "DNS_VAZIO");
  }
  // TODOS os enderecos precisam ser publicos: se um unico registro interno
  // existir, a requisicao e recusada (protege contra DNS com resposta mista).
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new UnsafeUrlError("O DNS do endereco resolve para IP interno e foi bloqueado.", "IP_PRIVADO");
    }
  }

  return { url, addresses };
}

export type RemoteResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  finalUrl: string;
  redirects: number;
  truncated: boolean;
  contentType: string | null;
  contentLength: number | null;
};

export type FetchOptions = {
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  maxRedirects?: number;
  /** Tamanho maximo do corpo lido. */
  maxBytes?: number;
  /** Le apenas os primeiros bytes e aborta (verificacao). */
  probeBytes?: number;
  /** Resolvedor injetavel para testes. */
  resolve?: (hostname: string) => Promise<string[]>;
  /** Cliente HTTP injetavel para testes (rede real por padrao). */
  transport?: (input: TransportInput) => Promise<TransportResult>;
};

export type TransportInput = {
  url: URL;
  method: "GET" | "HEAD";
  addresses: string[];
  timeoutMs: number;
  maxBytes: number;
  probeBytes: number;
};

export type TransportResult = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  truncated: boolean;
};

/** Erro de rede com codigo Node (ENOTFOUND, ECONNREFUSED, ETIMEDOUT...). */
export class RemoteNetworkError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "RemoteNetworkError";
    this.code = code;
  }
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Executa UMA requisicao HTTP(S), pinando o IP pre-validado. */
function realTransport(input: TransportInput): Promise<TransportResult> {
  return new Promise((resolve, reject) => {
    const isHttps = input.url.protocol === "https:";
    const request = isHttps ? httpsRequest : httpRequest;
    const hostname = input.url.hostname.replace(/^\[|\]$/g, "");
    const pinned = input.addresses.find((address) => isIP(address) === isIP(hostname)) ?? input.addresses[0]!;

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const req = request(
      {
        protocol: input.url.protocol,
        hostname,
        port: input.url.port || (isHttps ? 443 : 80),
        path: `${input.url.pathname}${input.url.search}`,
        method: input.method,
        headers: {
          // Sem cookies/credenciais do usuario. Sem compressao: o buffer
          // precisa conter os magic bytes reais do arquivo.
          "user-agent": "MA-Store-ImageRecovery/1.0",
          accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5",
          connection: "close",
        },
        // PINAGEM: se o DNS mudar entre a validacao e a conexao, o IP usado
        // continua sendo o que passou na allowlist.
        lookup: (_host, _options, callback) => {
          callback(null, pinned, isIP(pinned) === 6 ? 6 : 4);
        },
      },
      (response) => {
        const headers = response.headers as Record<string, string | string[] | undefined>;
        const status = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;

        response.on("data", (chunk: Buffer) => {
          if (truncated) return;
          total += chunk.length;
          const limit = input.probeBytes > 0 ? input.probeBytes : input.maxBytes;
          if (total > limit) {
            truncated = true;
            const keep = Math.max(0, limit - (total - chunk.length));
            if (keep > 0) chunks.push(chunk.subarray(0, keep));
            response.destroy();
            finish(() => resolve({ status, headers, body: Buffer.concat(chunks), truncated }));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          finish(() => resolve({ status, headers, body: Buffer.concat(chunks), truncated })),
        );
        response.on("error", (error: NodeJS.ErrnoException) =>
          finish(() => reject(new RemoteNetworkError(error.message, error.code ?? "ERRO_DE_REDE"))),
        );
      },
    );

    req.setTimeout(input.timeoutMs, () => {
      req.destroy(Object.assign(new Error("Tempo limite excedido."), { code: "ETIMEDOUT" }));
    });
    req.on("error", (error: NodeJS.ErrnoException) =>
      finish(() => reject(new RemoteNetworkError(error.message, error.code ?? "ERRO_DE_REDE"))),
    );
    req.end();
  });
}

/**
 * GET/HEAD seguro com redirects revalidados, timeout e limite de bytes.
 * Nunca segue um redirect para host/IP interno.
 */
export async function safeFetch(rawUrl: string, options: FetchOptions = {}): Promise<RemoteResponse> {
  const timeoutMs = options.timeoutMs ?? env.IMAGE_RECOVERY_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? env.IMAGE_RECOVERY_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? env.IMAGE_RECOVERY_MAX_MB * 1024 * 1024;
  const probeBytes = options.probeBytes ?? 0;
  const transport = options.transport ?? realTransport;

  let current = await assertSafeUrl(rawUrl, { resolve: options.resolve });
  let redirects = 0;

  for (;;) {
    const result = await transport({
      url: current.url,
      method: options.method ?? "GET",
      addresses: current.addresses,
      timeoutMs,
      maxBytes,
      probeBytes,
    });

    const location = headerValue(result.headers, "location");
    if (result.status >= 300 && result.status < 400 && location) {
      if (redirects >= maxRedirects) {
        throw new RemoteNetworkError("Numero maximo de redirecionamentos excedido.", "REDIRECT_LIMIT");
      }
      let next: URL;
      try {
        next = new URL(location, current.url);
      } catch {
        throw new RemoteNetworkError("Redirecionamento com destino invalido.", "REDIRECT_INVALIDO");
      }
      // Revalida DESTINO (protocolo, host, DNS) antes de seguir.
      current = await assertSafeUrl(next.toString(), { resolve: options.resolve });
      redirects += 1;
      continue;
    }

    const contentLengthRaw = headerValue(result.headers, "content-length");
    const contentLength = contentLengthRaw && /^\d+$/.test(contentLengthRaw) ? Number(contentLengthRaw) : null;

    return {
      status: result.status,
      headers: result.headers,
      body: result.body,
      finalUrl: current.url.toString(),
      redirects,
      truncated: result.truncated,
      contentType: headerValue(result.headers, "content-type"),
      contentLength,
    };
  }
}
