import { describe, expect, it } from "vitest";
import { addBusinessDays, estimateDeliveryDate } from "../../../src/shipping-engine/index.js";

describe("deadline", () => {
  it("pula fins de semana", () => {
    // Sexta 2026-09-25 + 1 dia útil = segunda 2026-09-28.
    const friday = new Date("2026-09-25T12:00:00Z");
    expect(estimateDeliveryDate(1, { from: friday })).toBe("2026-09-28");
  });

  it("pula feriados informados", () => {
    const friday = new Date("2026-09-25T12:00:00Z");
    // Segunda 28 é feriado -> terça 29.
    expect(estimateDeliveryDate(1, { from: friday, holidays: ["2026-09-28"] })).toBe("2026-09-29");
  });

  it("zero dias devolve o mesmo dia", () => {
    const date = new Date("2026-09-23T00:00:00Z");
    expect(estimateDeliveryDate(0, { from: date })).toBe("2026-09-23");
    expect(addBusinessDays(date, 0).toISOString().slice(0, 10)).toBe("2026-09-23");
  });
});
