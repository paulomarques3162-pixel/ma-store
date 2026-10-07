import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createAdmin, db, makeApp, resetDatabase } from "../helpers";

/**
 * E2E REAL do fluxo de imagem de produto (sem mock de HTTP).
 *
 * Percorre exatamente a cadeia que quebrava:
 *
 *   ADMIN → upload multipart real → arquivo GRAVADO no disco → URL devolvida
 *   → URL acessível por HTTP (200 + Content-Type + bytes reais)
 *   → URL salva no produto → produto PERSISTIDO no banco
 *   → catálogo público devolve a imagem → página do produto devolve a imagem
 *   → refresh (nova requisição) continua funcionando
 *   → segunda imagem e SUBSTITUIÇÃO da capa funcionam
 *
 * O servidor ouve em uma porta real, então o upload e o download passam pela
 * mesma pilha (multipart, static, compressão) que roda em produção.
 */

let app: FastifyInstance;
let baseUrl: string;
let uploadsDir: string;
let admin: { token: string; id: string };
const createdFiles: string[] = [];

/** PNG válido com IHDR real (o validador lê largura/altura daqui). */
function pngBuffer(width = 900, height = 900, seed = 200): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    (width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    (height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    0x08, 0x02, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, seed,
  ]);
}

async function uploadImage(bytes: Uint8Array, filename: string, token: string) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), filename);
  const response = await fetch(`${baseUrl}/api/admin/uploads`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const body = (await response.json()) as { data?: { url: string; filename: string; width: number; height: number } };
  if (body.data?.filename) createdFiles.push(body.data.filename);
  return { status: response.status, data: body.data };
}

/** Busca a URL pública da imagem e devolve status/cabeçalhos/bytes. */
async function fetchImage(url: string) {
  const response = await fetch(`${baseUrl}${url}`, { headers: { "accept-encoding": "gzip, deflate, br" } });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    cacheControl: response.headers.get("cache-control") ?? "",
    contentEncoding: response.headers.get("content-encoding"),
    bytes,
  };
}

beforeAll(async () => {
  app = await makeApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Sem porta para o servidor de teste.");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const { env } = await import("../../src/env.js");
  uploadsDir = resolve(process.cwd(), env.STORAGE_LOCAL_DIR);

  await resetDatabase();
  admin = await createAdmin(app);
});

afterAll(async () => {
  await app.close();
  for (const filename of createdFiles) await rm(resolve(uploadsDir, filename), { force: true });
  const prisma = await db();
  await prisma.$disconnect();
});

describe("E2E de imagem de produto", () => {
  it("upload → disco → HTTP → produto → catálogo → página → refresh → substituição", async () => {
    const prisma = await db();

    // ---------------------------------------------------------------- 1. UPLOAD
    const first = await uploadImage(pngBuffer(900, 900, 11), "capa.png", admin.token);
    expect(first.status).toBe(201);
    const coverUrl = first.data!.url;
    expect(coverUrl).toMatch(/^\/uploads\/[A-Za-z0-9._-]+\.png$/);

    // ------------------------------------------------ 2. ARQUIVO NO DISCO REAL
    const { stat } = await import("node:fs/promises");
    const onDisk = await stat(resolve(uploadsDir, first.data!.filename));
    expect(onDisk.isFile()).toBe(true);
    expect(onDisk.size).toBeGreaterThan(0);

    // ------------------------------------------- 3. URL PÚBLICA SERVE A IMAGEM
    const served = await fetchImage(coverUrl);
    expect(served.status).toBe(200);
    expect(served.contentType).toContain("image/png");
    expect(served.cacheControl).toContain("immutable");
    // Imagem não é recomprimida (já é comprimida).
    expect(served.contentEncoding).toBeNull();
    // E o conteúdo é a imagem de verdade (assinatura PNG), não um placeholder.
    expect(Array.from(served.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

    // -------------------------------------- 4. PRODUTO SALVO COM ESSA IMAGEM
    const created = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: {
        name: "Produto E2E de Imagem",
        price: 249.9,
        stock: 7,
        active: true,
        images: [{ url: coverUrl, position: 0, focalPoint: "center" }],
      },
    });
    expect(created.status).toBe(201);
    const product = created.body.data as { id: string; slug: string; images: Array<{ url: string; position: number }> };

    // A URL persistida é RELATIVA (nunca `http://localhost:3333/...`).
    const stored = await prisma.productImage.findFirst({ where: { productId: product.id } });
    expect(stored?.url).toBe(coverUrl);
    expect(stored?.url.startsWith("http")).toBe(false);

    // ------------------------------------------------- 5. CATÁLOGO PÚBLICO
    const list = await api(app, { method: "GET", url: "/api/products?perPage=50" });
    expect(list.status).toBe(200);
    const items = (list.body.data as Array<{ slug: string; images: Array<{ url: string }> }>) ?? [];
    const inCatalog = items.find((item) => item.slug === product.slug);
    expect(inCatalog, "produto publicado deve aparecer no catálogo").toBeTruthy();
    expect(inCatalog!.images[0]!.url).toBe(coverUrl);

    // A URL que o catálogo devolve é carregável de verdade.
    const catalogImage = await fetchImage(inCatalog!.images[0]!.url);
    expect(catalogImage.status).toBe(200);
    expect(catalogImage.contentType).toContain("image/png");

    // ------------------------------------------------ 6. PÁGINA DO PRODUTO
    const detail = await api(app, { method: "GET", url: `/api/products/${product.slug}` });
    expect(detail.status).toBe(200);
    const detailProduct = detail.body.data as { images: Array<{ url: string }> };
    expect(detailProduct.images).toHaveLength(1);
    expect((await fetchImage(detailProduct.images[0]!.url)).status).toBe(200);

    // -------------------------------------------------------- 7. REFRESH
    // Nova requisição (simula F5): continua 200 e com o mesmo conteúdo.
    const afterRefresh = await fetchImage(coverUrl);
    expect(afterRefresh.status).toBe(200);
    expect(afterRefresh.bytes.length).toBe(served.bytes.length);

    // ------------------------------------- 8. SEGUNDA IMAGEM + SUBSTITUIÇÃO
    const second = await uploadImage(pngBuffer(900, 900, 77), "capa-nova.png", admin.token);
    expect(second.status).toBe(201);
    const newCoverUrl = second.data!.url;
    expect(newCoverUrl).not.toBe(coverUrl);

    const replaced = await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${product.id}`,
      token: admin.token,
      payload: {
        images: [
          { url: newCoverUrl, position: 0, focalPoint: "center" },
          { url: coverUrl, position: 1, focalPoint: "center" },
        ],
      },
    });
    expect(replaced.status).toBe(200);

    const afterReplace = await api(app, { method: "GET", url: `/api/products/${product.slug}` });
    const replacedImages = (afterReplace.body.data as { images: Array<{ url: string; position: number }> }).images;
    expect(replacedImages[0]!.url).toBe(newCoverUrl);
    expect(replacedImages[1]!.url).toBe(coverUrl);
    // As DUAS imagens continuam acessíveis (a antiga não foi apagada).
    expect((await fetchImage(newCoverUrl)).status).toBe(200);
    expect((await fetchImage(coverUrl)).status).toBe(200);
  });
});
