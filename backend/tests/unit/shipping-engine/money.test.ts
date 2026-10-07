import { describe, expect, it } from "vitest";
import {
  addMoney,
  gramsToKilograms,
  kilogramsToGrams,
  money,
  roundMoney,
  sumMoney,
} from "../../../src/shipping-engine/index.js";

describe("money", () => {
  it("arredonda para 2 casas", () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(10.994)).toBe(10.99);
  });

  it("cria e soma valores da mesma moeda", () => {
    expect(sumMoney([money(10), money(2.5)]).amount).toBe(12.5);
    expect(addMoney(money(1.1), money(2.2)).amount).toBe(3.3);
  });

  it("recusa somar moedas diferentes", () => {
    expect(() => addMoney(money(1, "BRL"), money(1, "USD"))).toThrowError();
  });
});

describe("weight", () => {
  it("converte entre gramas e quilogramas", () => {
    expect(gramsToKilograms(kilogramsToGrams(1.5))).toBe(1.5);
  });
});
