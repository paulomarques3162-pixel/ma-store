import { describe, expect, it } from "vitest";
import {
  decimalToNumber,
  paginate,
  parsePagination,
  serialize,
  slugify,
} from "../../src/lib/serialize";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../../src/lib/password";
import { hmacHex, idempotencyHash, safeEqual, sha256 } from "../../src/lib/crypto";
import { AppError, badRequest, notFound, validationError } from "../../src/lib/errors";

describe("serialize", () => {
  it("converte Decimal para number (inclusive via duck typing)", () => {
    const fakeDecimal = { toNumber: () => 123.45, toFixed: () => "123.45" };
    expect(decimalToNumber(fakeDecimal)).toBe(123.45);
    expect(decimalToNumber("99.90")).toBe(99.9);
    expect(decimalToNumber(null)).toBe(0);
  });

  it("serializa objetos aninhados com Date e Decimal", () => {
    const input = {
      id: "1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      price: { toNumber: () => 10.5, toFixed: () => "10.50" },
      items: [{ total: { toNumber: () => 21, toFixed: () => "21.00" } }],
    };

    const output = serialize(input);
    expect(output.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(output.price).toBe(10.5);
    expect(output.items[0]!.total).toBe(21);
  });

  it("nao vaza propriedades internas de um Decimal", () => {
    const output = serialize({ price: { s: 1, e: 2, d: [1], toNumber: () => 5, toFixed: () => "5.00" } });
    expect(output.price).toBe(5);
    expect(JSON.stringify(output)).not.toContain('"d"');
  });
});

describe("slugify", () => {
  it("remove acentos e normaliza separadores", () => {
    expect(slugify("Perfume Árabe Importado 100ml")).toBe("perfume-arabe-importado-100ml");
    expect(slugify("  MA STORE  ")).toBe("ma-store");
    expect(slugify("Ação & Reação")).toBe("acao-reacao");
  });
});

describe("paginacao", () => {
  it("usa valores padrao seguros", () => {
    expect(parsePagination({})).toEqual({ page: 1, perPage: 20, skip: 0, take: 20 });
  });

  it("respeita o teto de itens por pagina", () => {
    expect(parsePagination({ perPage: 5000 }).perPage).toBe(100);
  });

  it("ignora valores invalidos", () => {
    expect(parsePagination({ page: -3, perPage: "abc" }).page).toBe(1);
  });

  it("calcula metadados", () => {
    const result = paginate(["a", "b"], 10, 2, 2);
    expect(result.meta).toEqual({ page: 2, perPage: 2, total: 10, totalPages: 5, hasNext: true, hasPrev: true });
  });
});

describe("senhas", () => {
  it("faz hash e verifica corretamente", async () => {
    const hash = await hashPassword("Senha@12345");
    expect(hash).not.toContain("Senha@12345");
    expect(await verifyPassword("Senha@12345", hash)).toBe(true);
    expect(await verifyPassword("outra-senha", hash)).toBe(false);
  });

  it("nunca retorna a senha original", async () => {
    const hash = await hashPassword("MinhaSenhaSecreta1");
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("aplica politica minima", () => {
    expect(validatePasswordStrength("curta").ok).toBe(false);
    expect(validatePasswordStrength("somenteletras").ok).toBe(false);
    expect(validatePasswordStrength("12345678").ok).toBe(false);
    expect(validatePasswordStrength("Senha1234").ok).toBe(true);
  });
});

describe("criptografia", () => {
  it("sha256 e deterministico e nao reversivel", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sha256("abc")).not.toBe("abc");
  });

  it("safeEqual compara em tempo constante", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("hmacHex gera assinatura valida e idempotencyHash e estavel", () => {
    expect(hmacHex("segredo", "payload")).toBe(hmacHex("segredo", "payload"));
    expect(hmacHex("segredo", "payload")).not.toBe(hmacHex("outro", "payload"));
    expect(idempotencyHash(["a", 1, null])).toBe(idempotencyHash(["a", 1, null]));
  });
});

describe("erros de aplicacao", () => {
  it("mapeia codigo para status HTTP", () => {
    expect(notFound().statusCode).toBe(404);
    expect(badRequest("x").statusCode).toBe(400);
    expect(validationError("x").statusCode).toBe(422);
  });

  it("e uma instancia de AppError", () => {
    expect(notFound()).toBeInstanceOf(AppError);
  });
});
