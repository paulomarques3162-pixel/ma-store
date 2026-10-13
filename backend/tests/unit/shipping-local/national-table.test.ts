import { describe, expect, it } from "vitest";
import {
  NATIONAL_METHODS,
  NATIONAL_TABLE_META,
  NATIONAL_WEIGHT_BANDS,
  NATIONAL_ZONES,
  REGION_DEADLINES,
  REGION_ECONOMIC_PRICES,
  REQUIRED_UFS,
  UNALLOCATED_ZIP_RANGES,
  buildZoneRules,
  computeRulePrice,
  findNationalZoneForZip,
  validateNationalTable,
} from "../../../src/shipping-local/bootstrap/national-table";
import { normalizeZipCode } from "../../../src/shipping-local/domain/cep";

describe("tabela nacional — cobertura e validacao", () => {
  it("valida sem lacunas nem sobreposicoes", () => {
    const result = validateNationalTable();
    expect(result.zones).toBe(35);
    expect(result.rules).toBe(630);
    expect(result.coveredZipFrom).toBe(1_000_000);
    expect(result.coveredZipTo).toBe(99_999_999);
  });

  it("cobre as 26 UFs + DF", () => {
    const states = new Set(NATIONAL_ZONES.map((zone) => zone.state));
    for (const uf of REQUIRED_UFS) expect(states.has(uf), `UF ausente: ${uf}`).toBe(true);
    expect(states.size).toBe(27);
  });

  it("nao tem faixas de CEP sobrepostas", () => {
    const sorted = [...NATIONAL_ZONES].sort((a, b) => a.zipCodeFrom - b.zipCodeFrom);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]!.zipCodeFrom, `sobreposicao em ${sorted[i]!.name}`).toBeGreaterThan(
        sorted[i - 1]!.zipCodeTo,
      );
    }
  });

  it("as unicas lacunas sao faixas sem CEP atribuido", () => {
    const sorted = [...NATIONAL_ZONES].sort((a, b) => a.zipCodeFrom - b.zipCodeFrom);
    let cursor = sorted[0]!.zipCodeFrom;
    for (const zone of sorted) {
      if (zone.zipCodeFrom > cursor) {
        const allowed = UNALLOCATED_ZIP_RANGES.some(
          (range) => range.from === cursor && range.to === zone.zipCodeFrom - 1,
        );
        expect(allowed, `lacuna nao prevista em ${cursor}-${zone.zipCodeFrom - 1}`).toBe(true);
      }
      cursor = zone.zipCodeTo + 1;
    }
    expect(cursor).toBe(100_000_000);
  });

  it("faixas de peso sao contiguas de 0 a 30kg", () => {
    let expected = 0;
    for (const band of NATIONAL_WEIGHT_BANDS) {
      expect(band.minWeightGrams).toBe(expected);
      expected = band.maxWeightGrams + 1;
    }
    expect(expected - 1).toBe(30_000);
  });
});

describe("tabela nacional — resolucao de regiao", () => {
  const cases: Array<[string, string]> = [
    ["01310100", "SP — Capital (centro/oeste/norte/sul)"],
    ["08000000", "SP — Capital (zona leste)"],
    ["06460000", "SP — Grande São Paulo (norte/oeste)"],
    ["09000000", "SP — Grande São Paulo (ABC/sudeste)"],
    ["11065000", "SP — Litoral (Baixada Santista e Vale do Ribeira)"],
    ["13010000", "SP — Interior"],
    ["20040020", "Rio de Janeiro"],
    ["30130010", "Minas Gerais"],
    ["68900000", "Amapá"],
    ["69300000", "Roraima"],
    ["70000000", "Distrito Federal (norte)"],
    ["73000000", "Distrito Federal (sul)"],
    ["72800000", "Goiás (entorno do DF)"],
    ["79000000", "Mato Grosso do Sul"],
    ["80000000", "Paraná"],
    ["90000000", "Rio Grande do Sul"],
  ];

  it.each(cases)("resolve o CEP %s para a regiao correta", (cep, expectedName) => {
    const zone = findNationalZoneForZip(Number(normalizeZipCode(cep)));
    expect(zone?.name).toBe(expectedName);
  });

  it("distingue capital, metropolitana, litoral e interior de SP", () => {
    const capital = findNationalZoneForZip(1_310_100)!;
    const metro = findNationalZoneForZip(9_000_000)!;
    const litoral = findNationalZoneForZip(11_065_000)!;
    const interior = findNationalZoneForZip(13_010_000)!;
    expect(capital.region).toBe("SP_CAPITAL");
    expect(metro.region).toBe("SP_METRO");
    expect(litoral.region).toBe("SP_LITORAL");
    expect(interior.region).toBe("SP_INTERIOR");
  });

  it("nao encontra zona para CEP fora da cobertura", () => {
    expect(findNationalZoneForZip(10_000_000)).toBeNull();
    expect(findNationalZoneForZip(0)).toBeNull();
  });

  it("rejeita CEP invalido", () => {
    expect(() => normalizeZipCode("123")).toThrowError();
  });
});

describe("tabela nacional — precos e prazos", () => {
  it("todo par regiao x faixa tem preco positivo", () => {
    for (const [region, prices] of Object.entries(REGION_ECONOMIC_PRICES)) {
      expect(prices, region).toHaveLength(NATIONAL_WEIGHT_BANDS.length);
      for (const price of prices) expect(price, region).toBeGreaterThan(0);
    }
  });

  it("preco aumenta com o peso na mesma regiao", () => {
    for (const prices of Object.values(REGION_ECONOMIC_PRICES)) {
      for (let i = 1; i < prices.length; i += 1) {
        expect(prices[i]!).toBeGreaterThanOrEqual(prices[i - 1]!);
      }
    }
  });

  it("destinos diferentes tem precos diferentes (nao ha preco unico)", () => {
    const band = 2;
    const distinct = new Set(Object.values(REGION_ECONOMIC_PRICES).map((prices) => prices[band]));
    expect(distinct.size).toBeGreaterThan(4);
  });

  it("modalidade mais rapida custa mais que a economica", () => {
    const zone = NATIONAL_ZONES.find((item) => item.seedKey === "sp-capital-oeste")!;
    const economic = computeRulePrice(zone, "ECONOMIC", 2);
    const standard = computeRulePrice(zone, "STANDARD", 2);
    const express = computeRulePrice(zone, "EXPRESS", 2);
    expect(standard).toBeGreaterThan(economic);
    expect(express).toBeGreaterThan(standard);
  });

  it("todos os prazos sao validos e incluem preparacao", () => {
    for (const [region, deadlines] of Object.entries(REGION_DEADLINES)) {
      for (const method of NATIONAL_METHODS) {
        const [min, max] = deadlines[method.code];
        expect(min, `${region}/${method.code}`).toBeGreaterThanOrEqual(1);
        expect(max).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it("buildZoneRules gera uma faixa por modalidade e por peso", () => {
    const zone = NATIONAL_ZONES[0]!;
    const rules = buildZoneRules(zone);
    expect(rules).toHaveLength(NATIONAL_METHODS.length * NATIONAL_WEIGHT_BANDS.length);
    for (const { rule } of rules) {
      expect(rule.deliveryDays).toBe(rule.estimatedMaxBusinessDays);
      expect(rule.estimatedMinBusinessDays).toBeLessThanOrEqual(rule.estimatedMaxBusinessDays!);
    }
    // seedKey e unico
    expect(new Set(rules.map((entry) => entry.rule.seedKey)).size).toBe(rules.length);
  });

  it("frete gratis inicial esta documentado", () => {
    expect(NATIONAL_TABLE_META.freeShippingEnabled).toBe(true);
    expect(NATIONAL_TABLE_META.freeShippingMinimumOrderValue).toBeGreaterThan(0);
    expect(NATIONAL_TABLE_META.provisionalOriginZipCode).toHaveLength(8);
  });
});
