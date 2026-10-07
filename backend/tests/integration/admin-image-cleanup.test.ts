import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, createAdmin, db, makeApp, resetDatabase } from "../helpers";

/**
 * Limpeza de arquivos de upload com segurança de referência.
 *
 * Regressão que estes testes protegem: remover a foto de um produto (ou excluir
 * o produto) NÃO pode apagar um arquivo que ainda é usado por outro produto
 * (duplicado/biblioteca), por um banner, categoria, marca ou snapshot de pedido.
 * Antes, o arquivo era apagado direto e os demais registros ficavam com a
 * imagem quebrada — a causa raiz das imagens que "somem" da loja.
 */

let app: FastifyInstance;
let admin: { token: string; id: string };
let uploadsDir: string;
let runId: string;
const seeded: string[] = [];

beforeAll(async () => {
  app = await makeApp();
  const { env } = await import("../../src/env.js");
  uploadsDir = resolve(process.cwd(), env.STORAGE_LOCAL_DIR);
  runId = `cleanup-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
});

afterAll(async () => {
  await app.close();
  for (const filename of seeded) await rm(resolve(uploadsDir, filename), { force: true });
  const prisma = await db();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  admin = await createAdmin(app);
});

/** Cria um arquivo real em uploads e devolve a URL relativa usada no banco. */
async function seedFile(label: string): Promise<{ filename: string; url: string }> {
  await mkdir(uploadsDir, { recursive: true });
  const filename = `${runId}-${label}.png`;
  await writeFile(resolve(uploadsDir, filename), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  seeded.push(filename);
  return { filename, url: `/uploads/${filename}` };
}

async function fileExists(filename: string): Promise<boolean> {
  try {
    await stat(resolve(uploadsDir, filename));
    return true;
  } catch {
    return false;
  }
}

async function createProduct(name: string, imageUrls: string[]): Promise<{ id: string }> {
  const response = await api(app, {
    method: "POST",
    url: "/api/admin/products",
    token: admin.token,
    payload: {
      name,
      price: 100,
      stock: 5,
      images: imageUrls.map((url) => ({ url })),
    },
  });
  expect(response.status).toBe(201);
  return response.body.data as { id: string };
}

describe("limpeza de uploads com segurança de referência", () => {
  it("NÃO apaga o arquivo ao remover a imagem de um produto se outro produto ainda a usa (duplicado)", async () => {
    const file = await seedFile("compartilhada");

    const source = await createProduct("Produto Original", [file.url]);
    const duplicate = await api(app, {
      method: "POST",
      url: `/api/admin/products/${source.id}/duplicate`,
      token: admin.token,
    });
    expect(duplicate.status).toBe(201);

    // Remove a imagem apenas do produto original.
    const patch = await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${source.id}`,
      token: admin.token,
      payload: { images: [] },
    });
    expect(patch.status).toBe(200);

    // O arquivo precisa continuar existindo para a cópia.
    expect(await fileExists(file.filename)).toBe(true);

    const copy = duplicate.body.data as { id: string };
    const copyRead = await api(app, { method: "GET", url: `/api/admin/products/${copy.id}`, token: admin.token });
    const images = (copyRead.body.data as { images: Array<{ url: string }> }).images;
    expect(images.map((image) => image.url)).toEqual([file.url]);
  });

  it("apaga o arquivo quando ele deixa de ser referenciado por qualquer produto", async () => {
    const file = await seedFile("unica");
    const product = await createProduct("Produto Único", [file.url]);

    const patch = await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${product.id}`,
      token: admin.token,
      payload: { images: [] },
    });
    expect(patch.status).toBe(200);

    expect(await fileExists(file.filename)).toBe(false);
  });

  it("preserva o arquivo ao excluir um produto se ele ainda estiver em outro produto", async () => {
    const file = await seedFile("hard-delete");
    const first = await createProduct("Produto A", [file.url]);
    await createProduct("Produto B", [file.url]);

    const removed = await api(app, {
      method: "DELETE",
      url: `/api/admin/products/${first.id}?hard=true`,
      token: admin.token,
    });
    expect(removed.status).toBe(200);

    expect(await fileExists(file.filename)).toBe(true);
  });

  it("preserva o arquivo quando ele também é usado como imagem de banner ou categoria", async () => {
    const prisma = await db();
    const bannerFile = await seedFile("banner");
    const categoryFile = await seedFile("categoria");

    await prisma.banner.create({ data: { title: "Banner de Teste", imageUrl: bannerFile.url, active: true } });
    await prisma.category.create({ data: { name: "Cat Teste", slug: `cat-${Date.now()}`, imageUrl: categoryFile.url } });

    const product = await createProduct("Produto com Banner", [bannerFile.url, categoryFile.url]);

    const patch = await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${product.id}`,
      token: admin.token,
      payload: { images: [] },
    });
    expect(patch.status).toBe(200);

    expect(await fileExists(bannerFile.filename)).toBe(true);
    expect(await fileExists(categoryFile.filename)).toBe(true);
  });

  it("preserva o arquivo quando ele ainda aparece em snapshot de pedido", async () => {
    const prisma = await db();
    const file = await seedFile("pedido");

    // Cria um pedido mínimo com snapshot da imagem.
    const user = await prisma.user.create({
      data: {
        name: "Cliente Snapshot",
        email: `snapshot-${Date.now()}-${Math.random().toString(16).slice(2, 6)}@teste.local`,
        passwordHash: "x",
      },
    });
    const order = await prisma.order.create({
      data: {
        number: `PED-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        userId: user.id,
        subtotal: "10.00",
        shippingCost: "0.00",
        discount: "0.00",
        total: "10.00",
        shippingAddress: { cep: "01310100", city: "Sao Paulo", state: "SP" },
        items: {
          create: [
            {
              nameSnapshot: "Item de Teste",
              skuSnapshot: "SKU-TESTE",
              imageSnapshot: file.url,
              unitPrice: "10.00",
              quantity: 1,
              total: "10.00",
            },
          ],
        },
      },
    });
    expect(order.id).toBeTruthy();

    const product = await createProduct("Produto com Pedido", [file.url]);
    const patch = await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${product.id}`,
      token: admin.token,
      payload: { images: [] },
    });
    expect(patch.status).toBe(200);

    expect(await fileExists(file.filename)).toBe(true);
  });
});
