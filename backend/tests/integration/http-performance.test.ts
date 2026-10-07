import { brotliDecompressSync, gunzipSync } from "node:zlib";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, makeApp, resetDatabase } from "../helpers";

/**
 * Compressão HTTP da API (performance real).
 *
 * A vitrine é um SPA: cada página baixa JSON. Sem compressão a listagem de
 * produtos passa de 14 KB e o navegador paga isso em redes móveis. Estes testes
 * garantem que:
 *  - respostas grandes de JSON saem comprimidas (brotli/gzip) quando o cliente
 *    aceita;
 *  - o conteúdo descomprimido é IDÊNTICO ao original (nada é corrompido);
 *  - respostas pequenas NÃO ganham cabeçalho de compressão (seriam maiores);
 *  - sem `Accept-Encoding` a resposta continua em texto puro (compatibilidade).
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
  // Payload realista: 20 produtos com 2 imagens cada (como na vitrine).
  await resetDatabase();
  const prisma = await db();
  await prisma.product.createMany({
    data: Array.from({ length: 20 }, (_, index) => ({
      name: `Perfume de Teste ${index + 1}`,
      slug: `perfume-de-teste-${index + 1}`,
      sku: `SKU-PERF-${index + 1}`,
      shortDescription: "Fragrância importada para medição de payload.",
      description: "Descrição longa de teste usada para medir a compressão HTTP da listagem pública.",
      price: 100 + index,
      comparePrice: 150 + index,
      stock: 10,
      active: true,
    })),
  });
  const products = await prisma.product.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  await prisma.productImage.createMany({
    data: products.flatMap((product) => [
      { productId: product.id, url: `/uploads/teste-${product.id}-1.png`, position: 0 },
      { productId: product.id, url: `/uploads/teste-${product.id}-2.png`, position: 1 },
    ]),
  });
});

afterAll(async () => {
  await app.close();
  const prisma = await db();
  await prisma.$disconnect();
});

function decode(encoding: string | undefined, payload: Buffer): Buffer {
  if (encoding === "br") return brotliDecompressSync(payload);
  if (encoding === "gzip") return gunzipSync(payload);
  return payload;
}

describe("compressão HTTP", () => {
  it("comprime a listagem de produtos quando o cliente aceita brotli/gzip", async () => {
    const plain = await app.inject({ method: "GET", url: "/api/products?perPage=20" });
    const compressed = await app.inject({
      method: "GET",
      url: "/api/products?perPage=20",
      headers: { "accept-encoding": "gzip, deflate, br" },
    });

    expect(compressed.statusCode).toBe(200);
    const encoding = compressed.headers["content-encoding"];
    expect(["br", "gzip"]).toContain(encoding);

    // Conteúdo idêntico ao original (compressão não pode alterar o JSON).
    const decoded = decode(encoding as string, compressed.rawPayload).toString("utf8");
    expect(decoded).toBe(plain.body);

    // E o ganho é real: pelo menos 50% menor no fio.
    if (plain.rawPayload.length > 1024) {
      expect(compressed.rawPayload.length).toBeLessThan(plain.rawPayload.length * 0.5);
    }
  });

  it("não comprime resposta pequena (o cabeçalho custaria mais que o ganho)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { "accept-encoding": "gzip, deflate, br" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.length).toBeLessThan(1024);
    expect(response.headers["content-encoding"]).toBeUndefined();
  });

  it("sem Accept-Encoding entrega JSON em texto puro", async () => {
    const response = await app.inject({ method: "GET", url: "/api/products?perPage=20" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(() => JSON.parse(response.body)).not.toThrow();
  });
});
