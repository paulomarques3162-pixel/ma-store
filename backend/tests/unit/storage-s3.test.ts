import { describe, expect, it } from "vitest";

/**
 * Testes dos helpers PUROS do driver de objetos (sem rede).
 *
 * As variaveis sao definidas ANTES do import dinamico para que o singleton de
 * `env` seja construido com o driver S3 configurado.
 */
process.env.STORAGE_DRIVER = "s3";
process.env.STORAGE_S3_BUCKET = "ma-store-test";
process.env.STORAGE_S3_REGION = "sa-east-1";
process.env.STORAGE_S3_PREFIX = "uploads/";

const { objectKey, resolveObjectUrl, filenameFromUrl } = await import("../../src/services/storage-s3");

describe("storage S3 — helpers", () => {
  it("monta a chave com o prefixo normalizado", () => {
    expect(objectKey("123-abc.png")).toBe("uploads/123-abc.png");
  });

  it("resolve a URL publica padrao da AWS", () => {
    expect(resolveObjectUrl("123-abc.png")).toBe(
      "https://ma-store-test.s3.sa-east-1.amazonaws.com/uploads/123-abc.png",
    );
  });

  it("extrai o nome do arquivo ignorando query/fragmento", () => {
    expect(filenameFromUrl("https://cdn.test/uploads/123-abc.png?v=2")).toBe("123-abc.png");
    expect(filenameFromUrl("https://cdn.test/uploads/123-abc.webp#x")).toBe("123-abc.webp");
  });
});
