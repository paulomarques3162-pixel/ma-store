/**
 * Cálculo de prazo em dias úteis.
 *
 * O provedor informa o prazo em dias úteis; nós convertemos para uma data
 * estimada sem inventar valores. Feriados são opcionais e configuráveis.
 */

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addBusinessDays(from: Date, days: number, holidays: readonly string[] = []): Date {
  const holidaySet = new Set(holidays);
  const result = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let remaining = Math.max(0, Math.floor(days));

  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isWeekend(result)) continue;
    if (holidaySet.has(toIsoDate(result))) continue;
    remaining -= 1;
  }

  return result;
}

export type DeadlineOptions = {
  from?: Date;
  holidays?: readonly string[];
};

/** Data estimada de entrega (YYYY-MM-DD) a partir de um prazo em dias úteis. */
export function estimateDeliveryDate(deliveryDays: number, options: DeadlineOptions = {}): string {
  const base = options.from ?? new Date();
  return toIsoDate(addBusinessDays(base, deliveryDays, options.holidays ?? []));
}
