import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validacao da assinatura oficial do webhook do Mercado Pago.
 *
 * O gateway envia o cabecalho `x-signature` no formato `ts=<timestamp>,v1=<hmac>`
 * e o cabecalho `x-request-id`. O manifesto assinado e:
 *
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * O HMAC-SHA256 e calculado com o `MERCADOPAGO_WEBHOOK_SECRET`. NUNCA usamos o
 * `WEBHOOK_SECRET` interno da aplicacao para validar o Mercado Pago.
 *
 * Referencia:
 * https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 */

export type ParsedSignature = { ts: string; v1: string };

export function parseSignatureHeader(header: string | undefined | null): ParsedSignature | null {
  if (!header) return null;
  const parts: Record<string, string> = {};
  for (const segment of header.split(",")) {
    const [rawKey, ...rest] = segment.trim().split("=");
    if (!rawKey || rest.length === 0) continue;
    parts[rawKey.trim()] = rest.join("=").trim();
  }
  if (!parts.ts || !parts.v1) return null;
  return { ts: parts.ts, v1: parts.v1 };
}

/** Monta o manifesto exatamente como o Mercado Pago o assina. */
export function buildSignatureManifest(args: { dataId: string; requestId?: string | null; ts: string }): string {
  const id = (args.dataId ?? "").toLowerCase();
  return `id:${id};request-id:${args.requestId ?? ""};ts:${args.ts};`;
}

function safeCompareHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export type VerifySignatureArgs = {
  signatureHeader?: string | null;
  requestId?: string | null;
  dataId?: string | null;
  secret: string;
};

/**
 * Verifica a assinatura. Retorna `false` para qualquer inconsistencia — nunca
 * lanca e nunca registra o segredo.
 */
export function verifyMercadoPagoSignature(args: VerifySignatureArgs): boolean {
  if (!args.secret) return false;
  const parsed = parseSignatureHeader(args.signatureHeader);
  if (!parsed) return false;

  const manifest = buildSignatureManifest({
    dataId: args.dataId ?? "",
    requestId: args.requestId,
    ts: parsed.ts,
  });
  const expected = createHmac("sha256", args.secret).update(manifest).digest("hex");
  return safeCompareHex(expected, parsed.v1.toLowerCase());
}

/** Utilitario para testes: assina um manifesto e devolve o header `x-signature`. */
export function buildSignatureHeader(args: {
  dataId: string;
  requestId: string;
  ts?: string;
  secret: string;
}): string {
  const ts = args.ts ?? String(Math.floor(Date.now() / 1000));
  const manifest = buildSignatureManifest({ dataId: args.dataId, requestId: args.requestId, ts });
  const v1 = createHmac("sha256", args.secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}
