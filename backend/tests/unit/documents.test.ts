import { describe, expect, it } from "vitest";
import {
  documentDigits,
  documentTypeOf,
  isValidCnpj,
  isValidCpf,
  isValidDocument,
} from "../../src/lib/documents.js";

/**
 * CPF/CNPJ: o gateway recusa documento com dígito verificador errado. A
 * validação local evita uma tentativa de cobrança fadada ao erro.
 */
describe("documentos (CPF/CNPJ)", () => {
  it("aceita CPF válido com ou sem máscara", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidDocument("52998224725")).toBe(true);
  });

  it("recusa CPF com dígito verificador errado", () => {
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("123.456.789-00")).toBe(false);
  });

  it("recusa sequências repetidas e tamanhos inválidos", () => {
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("00000000000")).toBe(false);
    expect(isValidCpf("5299822472")).toBe(false);
    expect(isValidDocument("")).toBe(false);
    expect(isValidDocument(null)).toBe(false);
  });

  it("aceita CNPJ válido e recusa inválido", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
    expect(isValidCnpj("11111111111111")).toBe(false);
    expect(isValidDocument("11222333000181")).toBe(true);
  });

  it("normaliza para dígitos e identifica o tipo", () => {
    expect(documentDigits("529.982.247-25")).toBe("52998224725");
    expect(documentTypeOf("529.982.247-25")).toBe("CPF");
    expect(documentTypeOf("11.222.333/0001-81")).toBe("CNPJ");
    expect(documentTypeOf("123")).toBeNull();
  });
});
