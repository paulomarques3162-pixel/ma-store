import { describe, expect, it } from "vitest";
import { documentTypeOf, isValidCnpj, isValidCpf, isValidDocument, onlyDigits } from "./documents";

describe("documentos (CPF/CNPJ)", () => {
  it("aceita CPF válido com e sem máscara", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
  });

  it("recusa CPF inválido, repetido ou incompleto", () => {
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
  });

  it("aceita CNPJ válido e recusa inválido", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
  });

  it("detecta o tipo e normaliza dígitos", () => {
    expect(documentTypeOf("529.982.247-25")).toBe("CPF");
    expect(documentTypeOf("11.222.333/0001-81")).toBe("CNPJ");
    expect(documentTypeOf("1")).toBeNull();
    expect(onlyDigits("529.982.247-25")).toBe("52998224725");
    expect(isValidDocument("")).toBe(false);
  });
});
