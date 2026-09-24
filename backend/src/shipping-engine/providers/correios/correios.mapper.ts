/**
 * Normalização das respostas brutas dos Correios.
 *
 * Os contratos oficiais variam entre endpoints/versões, então aceitamos os
 * campos conhecidos (`pcFinal`, `pcBase`, `valor`, `prazoEntrega`, `prazo`) e
 * devolvemos `null` quando nada é reconhecido — nunca inventamos preço/prazo.
 */

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  const withDot = normalized.includes(",") ? normalized.replace(/\./g, "").replace(",", ".") : normalized;
  const parsed = Number(withDot);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Extrai o primeiro registro útil (a API responde objeto ou array). */
function firstRecord(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload)) {
    const [first] = payload;
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }
  if (payload && typeof payload === "object") return payload as Record<string, unknown>;
  return null;
}

export type ParsedPrice = { price: number };

export function parseCorreiosPrice(payload: unknown): ParsedPrice | null {
  const record = firstRecord(payload);
  if (!record) return null;
  const price = toNumber(record.pcFinal ?? record.pcBase ?? record.valor ?? record.preco);
  if (price === null || price < 0) return null;
  return { price };
}

export type ParsedDeadline = { deliveryDays: number; maxDeliveryDays?: number };

function toDays(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

export function parseCorreiosDeadline(payload: unknown): ParsedDeadline | null {
  const record = firstRecord(payload);
  if (!record) return null;

  // A API de prazo pode aninhar em `parametrosPrazo`.
  const nested = Array.isArray(record.parametrosPrazo) ? firstRecord(record.parametrosPrazo) : null;
  const source = nested ?? record;

  const deliveryDays = toDays(source.prazoEntrega ?? source.prazo ?? source.prazoMaximo);
  if (deliveryDays === null) return null;

  const maxRaw = toDays(source.prazoMaximo ?? source.prazoEntregaMax);
  const maxDeliveryDays = maxRaw !== null ? Math.max(deliveryDays, maxRaw) : undefined;

  return { deliveryDays, ...(maxDeliveryDays !== undefined ? { maxDeliveryDays } : {}) };
}

/** Mensagem de erro legível devolvida pela API (sem expor stack). */
export function parseCorreiosErrorMessage(payload: unknown): string | null {
  const record = firstRecord(payload);
  if (!record) return null;
  const message = record.msgErro ?? record.mensagem ?? record.message ?? record.error;
  return typeof message === "string" && message.trim().length > 0 ? message.trim() : null;
}
