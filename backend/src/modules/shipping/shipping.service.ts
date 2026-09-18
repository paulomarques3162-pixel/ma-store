import { prisma } from "../../db.js";
import { validationError } from "../../lib/errors.js";
import { decimalToNumber } from "../../lib/serialize.js";

/**
 * Mapa aproximado de faixas de CEP -> UF.
 * Usado apenas para selecionar a modalidade de frete correta quando o cliente
 * nao informa o estado. Documentado como aproximacao: a transportadora e a
 * fonte definitiva.
 */
const CEP_RANGES: Array<{ start: number; end: number; uf: string }> = [
  { start: 1000000, end: 19999999, uf: "SP" },
  { start: 20000000, end: 28999999, uf: "RJ" },
  { start: 29000000, end: 29999999, uf: "ES" },
  { start: 30000000, end: 39999999, uf: "MG" },
  { start: 40000000, end: 48999999, uf: "BA" },
  { start: 49000000, end: 49999999, uf: "SE" },
  { start: 50000000, end: 56999999, uf: "PE" },
  { start: 57000000, end: 57999999, uf: "AL" },
  { start: 58000000, end: 58999999, uf: "PB" },
  { start: 59000000, end: 59999999, uf: "RN" },
  { start: 60000000, end: 63999999, uf: "CE" },
  { start: 64000000, end: 64999999, uf: "PI" },
  { start: 65000000, end: 65999999, uf: "MA" },
  { start: 66000000, end: 68899999, uf: "PA" },
  { start: 68900000, end: 68999999, uf: "AP" },
  { start: 69000000, end: 69299999, uf: "AM" },
  { start: 69300000, end: 69399999, uf: "RR" },
  { start: 69400000, end: 69899999, uf: "AM" },
  { start: 69900000, end: 69999999, uf: "AC" },
  { start: 70000000, end: 72799999, uf: "DF" },
  { start: 72800000, end: 76799999, uf: "GO" },
  { start: 76800000, end: 76999999, uf: "RO" },
  { start: 77000000, end: 77999999, uf: "TO" },
  { start: 78000000, end: 78899999, uf: "MT" },
  { start: 78900000, end: 78999999, uf: "RO" },
  { start: 79000000, end: 79999999, uf: "MS" },
  { start: 80000000, end: 87999999, uf: "PR" },
  { start: 88000000, end: 89999999, uf: "SC" },
  { start: 90000000, end: 99999999, uf: "RS" },
];

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

/** Normaliza CEP (aceita "00000-000" ou "00000000"). */
export function normalizeCep(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length !== 8) throw validationError("CEP invalido. Informe 8 digitos.");
  return digits;
}

export function cepToUf(cep: string): string | null {
  const numeric = Number(normalizeCep(cep));
  const range = CEP_RANGES.find((r) => numeric >= r.start && numeric <= r.end);
  return range?.uf ?? null;
}

export async function listShippingMethods() {
  return prisma.shippingMethod.findMany({
    where: { active: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      carrier: true,
      price: true,
      freeAbove: true,
      minDays: true,
      maxDays: true,
      regions: true,
    },
  });
}

export type ShippingOption = {
  id: string;
  name: string;
  description: string | null;
  carrier: string | null;
  price: number;
  originalPrice: number;
  freeAbove: number | null;
  isFree: boolean;
  minDays: number;
  maxDays: number;
  region: string | null;
};

/**
 * Cota o frete para um CEP/subtotal.
 * Retorna tambem `required: false` quando nenhum item do pedido exige frete
 * (ex.: produto marcado com "possui frete: NAO"), em vez de cobrar um valor fake.
 */
export async function quote(params: {
  cep?: string;
  state?: string;
  subtotal: number;
  hasShippableItems: boolean;
}): Promise<{ required: boolean; region: string | null; options: ShippingOption[] }> {
  const region = params.state?.toUpperCase() ?? (params.cep ? cepToUf(params.cep) : null);

  if (!params.hasShippableItems) {
    return { required: false, region, options: [] };
  }

  const methods = await listShippingMethods();

  const options: ShippingOption[] = methods
    .filter((m) => m.regions.length === 0 || (region && m.regions.includes(region)))
    .map((m) => {
      const base = decimalToNumber(m.price);
      const freeAbove = m.freeAbove === null ? 0 : decimalToNumber(m.freeAbove);
      const isFree = freeAbove > 0 && params.subtotal >= freeAbove;
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        carrier: m.carrier,
        price: isFree ? 0 : base,
        originalPrice: base,
        freeAbove: freeAbove > 0 ? freeAbove : null,
        isFree,
        minDays: m.minDays,
        maxDays: m.maxDays,
        region,
      };
    });

  return { required: true, region, options };
}
