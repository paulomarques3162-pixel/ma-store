/**
 * TABELA NACIONAL DE FRETE PRE-CADASTRADA — MA STORE (motor próprio).
 *
 * Este arquivo é a ÚNICA fonte de verdade dos valores comerciais iniciais
 * (modalidades, faixas de CEP, preços e prazos). Ele é declarativo, puro e
 * testável; nenhum valor é espalhado pelo código.
 *
 * IMPORTANTE — natureza dos valores:
 *  - Preços e prazos são ESTIMATIVAS COMERCIAIS INICIAIS da própria MA STORE.
 *  - NÃO são tarifas oficiais de transportadora nem custo real de envio.
 *  - O CEP de origem provisório (01001000, São Paulo/SP) serve apenas como
 *    referência de distância; o cálculo do motor é por faixa de CEP de destino,
 *    não por quilometragem.
 *  - Tudo é editável no painel (Admin → Frete motor próprio). A instalação
 *    automática nunca sobrescreve uma regra já existente.
 */

export type NationalRegionGroup =
  | "SP_CAPITAL"
  | "SP_METRO"
  | "SP_LITORAL"
  | "SP_INTERIOR"
  | "SUDESTE"
  | "SUL"
  | "CENTRO_OESTE"
  | "NORDESTE"
  | "NORTE";

export type NationalMethodCode = "ECONOMIC" | "STANDARD" | "EXPRESS";

export type NationalMethodSeed = {
  code: NationalMethodCode;
  name: string;
  description: string;
  priority: number;
  position: number;
};

export type NationalZoneSeed = {
  /** Identificador estável da zona da tabela inicial (nunca muda). */
  seedKey: string;
  name: string;
  state: string;
  zipCodeFrom: number;
  zipCodeTo: number;
  region: NationalRegionGroup;
};

export type WeightBand = {
  minWeightGrams: number;
  maxWeightGrams: number;
};

/** Faixa de CEP não utilizada pelo Correios (não é lacuna de cobertura). */
export const UNALLOCATED_ZIP_RANGES: Array<{ from: number; to: number; note: string }> = [
  { from: 0, to: 9_999_999, note: "Faixa sem CEPs atribuídos (abaixo de 01000-000)." },
  { from: 10_000_000, to: 10_999_999, note: "Faixa sem CEPs atribuídos (entre 09999-999 e 11000-000)." },
  { from: 78_900_000, to: 78_999_999, note: "Faixa sem CEPs atribuídos (entre MT e MS)." },
];

/* -------------------------------------------------------------------------- */
/* Modalidades                                                                */
/* -------------------------------------------------------------------------- */

export const NATIONAL_METHODS: NationalMethodSeed[] = [
  {
    code: "ECONOMIC",
    name: "Frete Econômico",
    description: "Estimativa inicial — modalidade mais econômica, prazo maior.",
    priority: 10,
    position: 0,
  },
  {
    code: "STANDARD",
    name: "Frete Padrão",
    description: "Estimativa inicial — modalidade padrão da loja.",
    priority: 20,
    position: 1,
  },
  {
    code: "EXPRESS",
    name: "Frete Expresso",
    description: "Estimativa inicial — modalidade mais rápida, valor maior.",
    priority: 30,
    position: 2,
  },
];

/* -------------------------------------------------------------------------- */
/* Faixas de peso (gramas) — contíguas, sem sobreposição                      */
/* -------------------------------------------------------------------------- */

export const NATIONAL_WEIGHT_BANDS: WeightBand[] = [
  { minWeightGrams: 0, maxWeightGrams: 300 },
  { minWeightGrams: 301, maxWeightGrams: 1_000 },
  { minWeightGrams: 1_001, maxWeightGrams: 3_000 },
  { minWeightGrams: 3_001, maxWeightGrams: 5_000 },
  { minWeightGrams: 5_001, maxWeightGrams: 10_000 },
  { minWeightGrams: 10_001, maxWeightGrams: 30_000 },
];

/** Acima da última faixa o motor responde SHIPPING_RULE_NOT_FOUND (tratado à parte). */
export const NATIONAL_MAX_WEIGHT_GRAMS = NATIONAL_WEIGHT_BANDS[NATIONAL_WEIGHT_BANDS.length - 1]!.maxWeightGrams;

/* -------------------------------------------------------------------------- */
/* Zonas / faixas de CEP — cobertura nacional (26 UFs + DF)                    */
/* -------------------------------------------------------------------------- */

export const NATIONAL_ZONES: NationalZoneSeed[] = [
  // São Paulo (capital, região metropolitana, litoral e interior)
  { seedKey: "sp-capital-oeste", name: "SP — Capital (centro/oeste/norte/sul)", state: "SP", zipCodeFrom: 1_000_000, zipCodeTo: 5_999_999, region: "SP_CAPITAL" },
  { seedKey: "sp-metro-norte", name: "SP — Grande São Paulo (norte/oeste)", state: "SP", zipCodeFrom: 6_000_000, zipCodeTo: 7_999_999, region: "SP_METRO" },
  { seedKey: "sp-capital-leste", name: "SP — Capital (zona leste)", state: "SP", zipCodeFrom: 8_000_000, zipCodeTo: 8_499_999, region: "SP_CAPITAL" },
  { seedKey: "sp-metro-abc", name: "SP — Grande São Paulo (ABC/sudeste)", state: "SP", zipCodeFrom: 8_500_000, zipCodeTo: 9_999_999, region: "SP_METRO" },
  { seedKey: "sp-litoral", name: "SP — Litoral (Baixada Santista e Vale do Ribeira)", state: "SP", zipCodeFrom: 11_000_000, zipCodeTo: 11_999_999, region: "SP_LITORAL" },
  { seedKey: "sp-interior", name: "SP — Interior", state: "SP", zipCodeFrom: 12_000_000, zipCodeTo: 19_999_999, region: "SP_INTERIOR" },

  // Sudeste
  { seedKey: "rj", name: "Rio de Janeiro", state: "RJ", zipCodeFrom: 20_000_000, zipCodeTo: 28_999_999, region: "SUDESTE" },
  { seedKey: "es", name: "Espírito Santo", state: "ES", zipCodeFrom: 29_000_000, zipCodeTo: 29_999_999, region: "SUDESTE" },
  { seedKey: "mg", name: "Minas Gerais", state: "MG", zipCodeFrom: 30_000_000, zipCodeTo: 39_999_999, region: "SUDESTE" },

  // Nordeste
  { seedKey: "ba", name: "Bahia", state: "BA", zipCodeFrom: 40_000_000, zipCodeTo: 48_999_999, region: "NORDESTE" },
  { seedKey: "se", name: "Sergipe", state: "SE", zipCodeFrom: 49_000_000, zipCodeTo: 49_999_999, region: "NORDESTE" },
  { seedKey: "pe", name: "Pernambuco", state: "PE", zipCodeFrom: 50_000_000, zipCodeTo: 56_999_999, region: "NORDESTE" },
  { seedKey: "al", name: "Alagoas", state: "AL", zipCodeFrom: 57_000_000, zipCodeTo: 57_999_999, region: "NORDESTE" },
  { seedKey: "pb", name: "Paraíba", state: "PB", zipCodeFrom: 58_000_000, zipCodeTo: 58_999_999, region: "NORDESTE" },
  { seedKey: "rn", name: "Rio Grande do Norte", state: "RN", zipCodeFrom: 59_000_000, zipCodeTo: 59_999_999, region: "NORDESTE" },
  { seedKey: "ce", name: "Ceará", state: "CE", zipCodeFrom: 60_000_000, zipCodeTo: 63_999_999, region: "NORDESTE" },
  { seedKey: "pi", name: "Piauí", state: "PI", zipCodeFrom: 64_000_000, zipCodeTo: 64_999_999, region: "NORDESTE" },
  { seedKey: "ma", name: "Maranhão", state: "MA", zipCodeFrom: 65_000_000, zipCodeTo: 65_999_999, region: "NORDESTE" },

  // Norte
  { seedKey: "pa", name: "Pará", state: "PA", zipCodeFrom: 66_000_000, zipCodeTo: 68_899_999, region: "NORTE" },
  { seedKey: "ap", name: "Amapá", state: "AP", zipCodeFrom: 68_900_000, zipCodeTo: 68_999_999, region: "NORTE" },
  { seedKey: "am-oeste", name: "Amazonas (oeste)", state: "AM", zipCodeFrom: 69_000_000, zipCodeTo: 69_299_999, region: "NORTE" },
  { seedKey: "rr", name: "Roraima", state: "RR", zipCodeFrom: 69_300_000, zipCodeTo: 69_399_999, region: "NORTE" },
  { seedKey: "am-leste", name: "Amazonas (leste)", state: "AM", zipCodeFrom: 69_400_000, zipCodeTo: 69_899_999, region: "NORTE" },
  { seedKey: "ac", name: "Acre", state: "AC", zipCodeFrom: 69_900_000, zipCodeTo: 69_999_999, region: "NORTE" },
  { seedKey: "ro", name: "Rondônia", state: "RO", zipCodeFrom: 76_800_000, zipCodeTo: 76_999_999, region: "NORTE" },
  { seedKey: "to", name: "Tocantins", state: "TO", zipCodeFrom: 77_000_000, zipCodeTo: 77_999_999, region: "NORTE" },

  // Centro-Oeste
  { seedKey: "df-norte", name: "Distrito Federal (norte)", state: "DF", zipCodeFrom: 70_000_000, zipCodeTo: 72_799_999, region: "CENTRO_OESTE" },
  { seedKey: "go-entorno", name: "Goiás (entorno do DF)", state: "GO", zipCodeFrom: 72_800_000, zipCodeTo: 72_999_999, region: "CENTRO_OESTE" },
  { seedKey: "df-sul", name: "Distrito Federal (sul)", state: "DF", zipCodeFrom: 73_000_000, zipCodeTo: 73_699_999, region: "CENTRO_OESTE" },
  { seedKey: "go-interior", name: "Goiás (interior)", state: "GO", zipCodeFrom: 73_700_000, zipCodeTo: 76_799_999, region: "CENTRO_OESTE" },
  { seedKey: "mt", name: "Mato Grosso", state: "MT", zipCodeFrom: 78_000_000, zipCodeTo: 78_899_999, region: "CENTRO_OESTE" },
  { seedKey: "ms", name: "Mato Grosso do Sul", state: "MS", zipCodeFrom: 79_000_000, zipCodeTo: 79_999_999, region: "CENTRO_OESTE" },

  // Sul
  { seedKey: "pr", name: "Paraná", state: "PR", zipCodeFrom: 80_000_000, zipCodeTo: 87_999_999, region: "SUL" },
  { seedKey: "sc", name: "Santa Catarina", state: "SC", zipCodeFrom: 88_000_000, zipCodeTo: 89_999_999, region: "SUL" },
  { seedKey: "rs", name: "Rio Grande do Sul", state: "RS", zipCodeFrom: 90_000_000, zipCodeTo: 99_999_999, region: "SUL" },
];

/** UFs obrigatoriamente cobertas (26 estados + Distrito Federal). */
export const REQUIRED_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

/* -------------------------------------------------------------------------- */
/* Preços iniciais (R$) — modalidade ECONOMICA por região e faixa de peso      */
/*                                                                            */
/* Critério: distância comercial a partir da origem provisória (SP/SP),        */
/* complexidade logística regional e faixa de peso. Valores de ESTIMATIVA      */
/* COMERCIAL da MA STORE — não são tarifas oficiais de transportadora.         */
/* -------------------------------------------------------------------------- */

export const REGION_ECONOMIC_PRICES: Record<NationalRegionGroup, number[]> = {
  SP_CAPITAL: [14.9, 18.9, 24.9, 32.9, 45.9, 69.9],
  SP_METRO: [16.9, 21.9, 28.9, 37.9, 52.9, 79.9],
  SP_LITORAL: [19.9, 25.9, 33.9, 43.9, 60.9, 89.9],
  SP_INTERIOR: [18.9, 24.9, 31.9, 41.9, 57.9, 86.9],
  SUDESTE: [24.9, 31.9, 39.9, 51.9, 71.9, 104.9],
  SUL: [27.9, 35.9, 44.9, 57.9, 79.9, 114.9],
  CENTRO_OESTE: [29.9, 38.9, 47.9, 61.9, 84.9, 121.9],
  NORDESTE: [34.9, 43.9, 54.9, 69.9, 95.9, 136.9],
  NORTE: [39.9, 49.9, 61.9, 78.9, 107.9, 152.9],
};

/** Multiplicador aplicado sobre o preço econômico (regra central e revisável). */
export const METHOD_PRICE_MULTIPLIER: Record<NationalMethodCode, number> = {
  ECONOMIC: 1,
  STANDARD: 1.35,
  EXPRESS: 1.9,
};

/**
 * Prazos estimados (dias ÚTEIS), por região e modalidade: [mínimo, máximo].
 * Os prazos JÁ INCLUEM 1 dia útil de preparação/embalagem — por isso o motor
 * NÃO soma `default_handling_days` novamente (evita contar a preparação 2x).
 * O valor exibido no checkout é o máximo (estimativa conservadora).
 */
export const REGION_DEADLINES: Record<NationalRegionGroup, Record<NationalMethodCode, [number, number]>> = {
  SP_CAPITAL: { ECONOMIC: [2, 4], STANDARD: [1, 3], EXPRESS: [1, 2] },
  SP_METRO: { ECONOMIC: [3, 5], STANDARD: [2, 4], EXPRESS: [1, 3] },
  SP_LITORAL: { ECONOMIC: [3, 6], STANDARD: [2, 4], EXPRESS: [2, 3] },
  SP_INTERIOR: { ECONOMIC: [4, 7], STANDARD: [3, 5], EXPRESS: [2, 4] },
  SUDESTE: { ECONOMIC: [5, 9], STANDARD: [3, 6], EXPRESS: [2, 4] },
  SUL: { ECONOMIC: [6, 10], STANDARD: [4, 7], EXPRESS: [3, 5] },
  CENTRO_OESTE: { ECONOMIC: [6, 11], STANDARD: [4, 8], EXPRESS: [3, 6] },
  NORDESTE: { ECONOMIC: [7, 12], STANDARD: [5, 9], EXPRESS: [4, 7] },
  NORTE: { ECONOMIC: [9, 15], STANDARD: [7, 12], EXPRESS: [6, 10] },
};

/* -------------------------------------------------------------------------- */
/* Política comercial inicial                                                 */
/* -------------------------------------------------------------------------- */

export const NATIONAL_TABLE_META = {
  version: 1,
  /** CEP de origem PROVISÓRIO (São Paulo/SP — Praça da Sé). Confirmar no painel. */
  provisionalOriginZipCode: "01001000",
  provisionalOriginLabel: "São Paulo/SP (provisório — confirmar o CEP real da loja)",
  /** Embalagem padrão somada ao peso dos itens (gramas). */
  packagePaddingGrams: 150,
  /** Preparação já embutida nos prazos (informativo; não é somado de novo). */
  defaultHandlingDays: 1,
  /** Frete grátis: política inicial, aplicada a todo o Brasil acima do valor. */
  freeShippingEnabled: true,
  freeShippingMinimumOrderValue: 199,
  showEstimateDisclaimer: true,
} as const;

/** Valor mínimo de frete praticado pela tabela inicial (faixa mais leve, SP capital). */
export const MINIMUM_SHIPPING_PRICE = Math.min(
  ...Object.values(REGION_ECONOMIC_PRICES).flat(),
);

/* -------------------------------------------------------------------------- */
/* Cálculo de regra (puro)                                                    */
/* -------------------------------------------------------------------------- */

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Preço da modalidade para a zona/faixa, arredondado a 2 casas. */
export function computeRulePrice(zone: NationalZoneSeed, methodCode: NationalMethodCode, bandIndex: number): number {
  const base = REGION_ECONOMIC_PRICES[zone.region][bandIndex];
  if (base === undefined) throw new Error(`Faixa de peso inexistente: ${bandIndex}.`);
  return roundMoney(base * METHOD_PRICE_MULTIPLIER[methodCode]);
}

export type NationalRuleSeed = {
  seedKey: string;
  minWeightGrams: number;
  maxWeightGrams: number;
  price: number;
  deliveryDays: number;
  estimatedMinBusinessDays: number;
  estimatedMaxBusinessDays: number;
};

/** Regras (faixas de peso) de uma zona para todas as modalidades. */
export function buildZoneRules(zone: NationalZoneSeed): Array<{ methodCode: NationalMethodCode; rule: NationalRuleSeed }> {
  const deadlines = REGION_DEADLINES[zone.region];
  const result: Array<{ methodCode: NationalMethodCode; rule: NationalRuleSeed }> = [];
  for (const method of NATIONAL_METHODS) {
    const [min, max] = deadlines[method.code];
    for (let index = 0; index < NATIONAL_WEIGHT_BANDS.length; index += 1) {
      const band = NATIONAL_WEIGHT_BANDS[index]!;
      result.push({
        methodCode: method.code,
        rule: {
          seedKey: `${zone.seedKey}|${method.code}|${index}`,
          minWeightGrams: band.minWeightGrams,
          maxWeightGrams: band.maxWeightGrams,
          price: computeRulePrice(zone, method.code, index),
          // Prazo exibido = máximo (conservador). A faixa fica registrada.
          deliveryDays: max,
          estimatedMinBusinessDays: min,
          estimatedMaxBusinessDays: max,
        },
      });
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Validação da tabela (cobertura, sobreposição, faixas)                      */
/* -------------------------------------------------------------------------- */

export type NationalTableValidation = {
  zones: number;
  rules: number;
  states: string[];
  coveredZipFrom: number;
  coveredZipTo: number;
};

/**
 * Valida a tabela inicial de forma determinística:
 *  - faixas de CEP sem sobreposição e sem lacunas (exceto faixas não atribuídas);
 *  - faixas de peso contíguas (0..NATIONAL_MAX_WEIGHT_GRAMS);
 *  - todas as 27 UFs contempladas;
 *  - preços/prazos definidos para todas as regiões e modalidades.
 * Lança `Error` com a descrição do problema — nunca deixa passar em silêncio.
 */
export function validateNationalTable(): NationalTableValidation {
  // 1) Faixas de peso.
  let expected = 0;
  for (const band of NATIONAL_WEIGHT_BANDS) {
    if (band.minWeightGrams !== expected) {
      throw new Error(
        `Faixa de peso inválida: esperava min ${expected}, encontrou ${band.minWeightGrams}.`,
      );
    }
    if (band.maxWeightGrams < band.minWeightGrams) {
      throw new Error(`Faixa de peso com máximo menor que o mínimo (${band.minWeightGrams}-${band.maxWeightGrams}).`);
    }
    expected = band.maxWeightGrams + 1;
  }
  if (expected - 1 !== NATIONAL_MAX_WEIGHT_GRAMS) {
    throw new Error("Faixa de peso não cobre até o peso máximo definido.");
  }

  // 2) Zonas: sobreposição e lacunas.
  const zones = [...NATIONAL_ZONES].sort((a, b) => a.zipCodeFrom - b.zipCodeFrom);
  const seenKeys = new Set<string>();
  let cursor = zones[0]!.zipCodeFrom;
  for (const zone of zones) {
    if (seenKeys.has(zone.seedKey)) throw new Error(`seedKey duplicado: ${zone.seedKey}.`);
    seenKeys.add(zone.seedKey);
    if (zone.zipCodeFrom > zone.zipCodeTo) {
      throw new Error(`Faixa de CEP invertida em ${zone.name}.`);
    }
    if (zone.zipCodeFrom < cursor) {
      throw new Error(`Sobreposição de faixa de CEP em ${zone.name} (início ${zone.zipCodeFrom}).`);
    }
    if (zone.zipCodeFrom > cursor) {
      const allowed = UNALLOCATED_ZIP_RANGES.some((range) => range.from === cursor && range.to === zone.zipCodeFrom - 1);
      if (!allowed) {
        throw new Error(`Lacuna de cobertura entre ${cursor} e ${zone.zipCodeFrom - 1} (${zone.name}).`);
      }
    }
    cursor = zone.zipCodeTo + 1;
  }
  if (cursor <= 99_999_999) {
    throw new Error(`Lacuna de cobertura após ${cursor - 1}.`);
  }

  // 3) UFs contempladas.
  const states = [...new Set(zones.map((zone) => zone.state))].sort();
  const missing = REQUIRED_UFS.filter((uf) => !states.includes(uf));
  if (missing.length > 0) throw new Error(`UFs sem cobertura: ${missing.join(", ")}.`);

  // 4) Preços/prazos por região e modalidade.
  for (const zone of zones) {
    const prices = REGION_ECONOMIC_PRICES[zone.region];
    if (!prices || prices.length !== NATIONAL_WEIGHT_BANDS.length) {
      throw new Error(`Preços ausentes/incompletos para a região ${zone.region}.`);
    }
    if (prices.some((price) => !(price > 0))) {
      throw new Error(`Preço inválido na região ${zone.region}.`);
    }
    for (const method of NATIONAL_METHODS) {
      const deadline = REGION_DEADLINES[zone.region][method.code];
      if (!deadline || deadline[0] <= 0 || deadline[1] < deadline[0]) {
        throw new Error(`Prazo inválido em ${zone.region}/${method.code}.`);
      }
    }
  }

  return {
    zones: zones.length,
    rules: zones.length * NATIONAL_METHODS.length * NATIONAL_WEIGHT_BANDS.length,
    states,
    coveredZipFrom: zones[0]!.zipCodeFrom,
    coveredZipTo: zones[zones.length - 1]!.zipCodeTo,
  };
}

/** Zona da tabela inicial que atende o CEP (ou `null` se fora da cobertura). */
export function findNationalZoneForZip(zipCodeInt: number): NationalZoneSeed | null {
  return NATIONAL_ZONES.find((zone) => zone.zipCodeFrom <= zipCodeInt && zone.zipCodeTo >= zipCodeInt) ?? null;
}
