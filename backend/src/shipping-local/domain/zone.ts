/**
 * Resolucao de zona (faixa de CEP) e deteccao de sobreposicao.
 *
 * Ordem deterministica: NUNCA escolhemos aleatoriamente. Em empate de
 * prioridade, a faixa mais especifica (menor intervalo) vence; depois o menor
 * CEP inicial e, por fim, o id (estavel).
 */
import type { ShippingZoneRecord } from "./types.js";

export function resolveZone(zones: ShippingZoneRecord[], zipCodeInt: number): ShippingZoneRecord | null {
  const matches = zones.filter(
    (zone) => zone.active && zone.zipCodeFrom <= zipCodeInt && zone.zipCodeTo >= zipCodeInt,
  );
  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const rangeA = a.zipCodeTo - a.zipCodeFrom;
    const rangeB = b.zipCodeTo - b.zipCodeFrom;
    if (rangeA !== rangeB) return rangeA - rangeB;
    if (a.zipCodeFrom !== b.zipCodeFrom) return a.zipCodeFrom - b.zipCodeFrom;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return matches[0]!;
}

export type ZoneOverlap = { id: string; name: string; zipCodeFrom: number; zipCodeTo: number };

/** Zonas ativas que se sobrepoem a faixa informada (ignorando `ignoreId`). */
export function findOverlappingZones(
  zones: ShippingZoneRecord[],
  candidate: { zipCodeFrom: number; zipCodeTo: number },
  ignoreId?: string,
): ZoneOverlap[] {
  return zones
    .filter(
      (zone) =>
        zone.active &&
        zone.id !== ignoreId &&
        zone.zipCodeFrom <= candidate.zipCodeTo &&
        zone.zipCodeTo >= candidate.zipCodeFrom,
    )
    .map((zone) => ({
      id: zone.id,
      name: zone.name,
      zipCodeFrom: zone.zipCodeFrom,
      zipCodeTo: zone.zipCodeTo,
    }));
}
