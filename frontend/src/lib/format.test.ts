import { describe, expect, it } from "vitest";
import {
  discountPercent,
  formatCurrency,
  formatInstallments,
  initials,
  maskCep,
  maskPhone,
  onlyDigits,
  stockLabel,
} from "@/lib/format";

describe("formatação de valores", () => {
  it("formata moeda em pt-BR", () => {
    expect(formatCurrency(199.9)).toContain("199,90");
  });

  it("devolve marcador quando o valor é nulo (nunca inventa número)", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(undefined)).toBe("—");
    expect(formatCurrency("")).toBe("—");
  });

  it("calcula o percentual de desconto apenas com promoção real", () => {
    expect(discountPercent(100, 200)).toBe(50);
    expect(discountPercent(200, 100)).toBeNull(); // comparativo menor: não é promoção
    expect(discountPercent(100, null)).toBeNull();
  });
});

describe("parcelamento", () => {
  it("não exibe parcelamento sem configuração da loja", () => {
    expect(formatInstallments(1000, null, null)).toBeNull();
    expect(formatInstallments(1000, 1, null)).toBeNull();
  });

  it("calcula o parcelamento quando a loja configurou", () => {
    expect(formatInstallments(1200, 12, null)).toContain("12x");
    expect(formatInstallments(1200, 12, null)).toContain("100,00");
  });

  it("reduz o número de parcelas para respeitar o valor mínimo", () => {
    const result = formatInstallments(1000, 10, 200); // mínimo 200 → no máximo 5x
    expect(result).toContain("5x");
  });
});

describe("estoque", () => {
  it("sinaliza indisponível quando não há estoque", () => {
    expect(stockLabel(0).text).toBe("Produto indisponível");
    expect(stockLabel(0).className).toBe("stock-out");
  });

  it("avisa quando o estoque está no limite mínimo", () => {
    expect(stockLabel(3, 5).className).toBe("stock-low");
    expect(stockLabel(50, 5).text).toBe("Disponível");
  });
});

describe("máscaras", () => {
  it("formata CEP", () => {
    expect(maskCep("01310100")).toBe("01310-100");
    expect(maskCep("01310")).toBe("01310");
  });

  it("formata telefone", () => {
    expect(maskPhone("11999998888")).toBe("(11) 99999-8888");
    expect(maskPhone("1133334444")).toBe("(11) 3333-4444");
  });

  it("remove caracteres não numéricos", () => {
    expect(onlyDigits("01310-100")).toBe("01310100");
  });
});

describe("iniciais", () => {
  it("usa as duas primeiras palavras do nome", () => {
    expect(initials("Maria Silva Souza")).toBe("MS");
    expect(initials(null)).toBe("?");
  });
});
