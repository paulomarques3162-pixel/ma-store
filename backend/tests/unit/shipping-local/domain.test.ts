import { describe, expect, it } from "vitest";
import { isValidZipCode, normalizeZipCode, zipCodeToInt } from "../../../src/shipping-local/domain/cep";
import { applyPackagePadding, totalItemWeightGrams, totalVolumeCm3 } from "../../../src/shipping-local/domain/weight";
import { resolveZone, findOverlappingZones } from "../../../src/shipping-local/domain/zone";
import { selectWeightRule } from "../../../src/shipping-local/domain/rule";
import type { ShippingWeightRuleRecord, ShippingZoneRecord } from "../../../src/shipping-local/domain/types";

const zone = (over: Partial<ShippingZoneRecord> = {}): ShippingZoneRecord => ({
  id: "z1",
  name: "Zona Teste",
  description: null,
  state: null,
  zipCodeFrom: 10000000,
  zipCodeTo: 19999999,
  active: true,
  priority: 0,
  ...over,
});

const rule = (over: Partial<ShippingWeightRuleRecord> = {}): ShippingWeightRuleRecord => ({
  id: "r1",
  zoneId: "z1",
  shippingMethodId: "m1",
  minWeightGrams: 0,
  maxWeightGrams: 500,
  price: 10,
  deliveryDays: 4,
  estimatedMinBusinessDays: 2,
  estimatedMaxBusinessDays: 5,
  active: true,
  priority: 0,
  ...over,
});

describe("CEP", () => {
  it("normaliza 13610-000 para 13610000", () => {
    expect(normalizeZipCode("13610-000")).toBe("13610000");
  });

  it("mantem 13610000", () => {
    expect(normalizeZipCode("13610000")).toBe("13610000");
  });

  it("rejeita CEP invalido com codigo padronizado", () => {
    expect(isValidZipCode("123")).toBe(false);
    try {
      normalizeZipCode("123");
      throw new Error("deveria ter falhado");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("INVALID_ZIP_CODE");
    }
  });

  it("converte para inteiro de faixa", () => {
    expect(zipCodeToInt("13610-000")).toBe(13610000);
  });
});

describe("peso", () => {
  it("calcula 500g x 2 = 1000g", () => {
    expect(totalItemWeightGrams([{ weightGrams: 500, quantity: 2 }])).toBe(1000);
  });

  it("soma o padding de embalagem quando configurado", () => {
    expect(applyPackagePadding(1000, 200)).toBe(1200);
    expect(applyPackagePadding(1000, null)).toBe(1000);
  });

  it("soma volumes e devolve null quando falta dimensao", () => {
    const dims = { heightCm: 10, widthCm: 5, lengthCm: 2 };
    expect(totalVolumeCm3([{ dimensions: dims, quantity: 2 }])).toBe(200);
    expect(totalVolumeCm3([{ dimensions: null, quantity: 1 }])).toBeNull();
  });
});

describe("resolucao de zona", () => {
  it("encontra a zona quando o CEP esta dentro da faixa", () => {
    expect(resolveZone([zone()], 13610000)?.id).toBe("z1");
  });

  it("nao encontra zona fora da faixa", () => {
    expect(resolveZone([zone()], 99999999)).toBeNull();
  });

  it("prioriza a maior prioridade e, em empate, a faixa mais especifica", () => {
    const wide = zone({ id: "wide", zipCodeFrom: 10000000, zipCodeTo: 19999999, priority: 0 });
    const narrow = zone({ id: "narrow", zipCodeFrom: 13600000, zipCodeTo: 13699999, priority: 0 });
    expect(resolveZone([wide, narrow], 13610000)?.id).toBe("narrow");
  });

  it("detecta sobreposicao de faixas", () => {
    const overlaps = findOverlappingZones([zone()], { zipCodeFrom: 13000000, zipCodeTo: 14000000 });
    expect(overlaps).toHaveLength(1);
  });
});

describe("selecao de regra por peso", () => {
  it("encontra a regra quando o peso esta na faixa", () => {
    expect(selectWeightRule([rule()], 500)?.id).toBe("r1");
  });

  it("nao encontra regra fora da faixa", () => {
    expect(selectWeightRule([rule()], 501)).toBeNull();
  });
});
