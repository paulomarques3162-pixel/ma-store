import { createHash, randomBytes, randomUUID, timingSafeEqual, createHmac } from "node:crypto";

/** Gera um id de requisicao curto para rastrear erros nos logs. */
export function newRequestId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

/** Token opaco (nao-JWT) usado em refresh tokens e link de reset de senha. */
export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256. Usado para guardar refresh tokens/resets sem nunca persistir o valor cru. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Comparacao em tempo constante (evita timing attack em assinaturas/segredos). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Assinatura HMAC-SHA256 em hex - usada nos webhooks de pagamento. */
export function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Hash de idempotencia para operacoes criticas (ex.: finalizar pedido). */
export function idempotencyHash(parts: Array<string | number | undefined | null>): string {
  return sha256(parts.map((p) => String(p ?? "")).join("|"));
}

/** Mascara dados sensiveis antes de gravar em log. */
export function maskSensitive(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}
