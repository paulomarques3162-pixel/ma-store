import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, createAdmin, db, makeApp, resetDatabase } from "../helpers";

/**
 * Integração com PostgreSQL REAL:
 *  - POST/PATCH /api/admin/products (criação com e sem SKU, edição de galeria);
 *  - GET /api/admin/uploads (biblioteca de imagens paginada/buscável).
 *
 * Requer `TEST_DATABASE_URL` apontando para um Postgres de testes
 * (`docker compose up -d db` sobe um). O `globalSetup` aplica as migrations.
 */

let app: FastifyInstance;
let admin: { token: string; id: string; email: string };
let uploadsDir: string;
let runId: string;
const seededFiles: string[] = [];

beforeAll(async () => {
  app = await makeApp();
  const { env } = await import("../../src/env.js");
  uploadsDir = resolve(process.cwd(), env.STORAGE_LOCAL_DIR);
  runId = `it-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
});

afterAll(async () => {
  await app.close();
  for (const filename of seededFiles) {
    await rm(resolve(uploadsDir, filename), { force: true });
  }
  const prisma = await db();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  admin = await createAdmin(app);
});

/** Cria arquivos de imagem reais no diretório de uploads (para a biblioteca). */
async function seedUploads(count: number): Promise<string[]> {
  await mkdir(uploadsDir, { recursive: true });
  const created: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const filename = `${runId}-${String(index).padStart(2, "0")}.png`;
    await writeFile(resolve(uploadsDir, filename), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    seededFiles.push(filename);
    created.push(filename);
  }
  return created;
}

describe("POST /api/admin/products", () => {
  it("cria produto SEM SKU e gera um código único", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Perfume Sem Codigo", price: 149.9, stock: 5 },
    });

    expect(response.status).toBe(201);
    const product = response.body.data as { id: string; sku: string; slug: string };
    expect(product.slug).toBe("perfume-sem-codigo");
    expect(product.sku).toMatch(/^PERFUME-SEM-CODIGO-[A-Z0-9]+$/);

    const prisma = await db();
    const persisted = await prisma.product.findUnique({ where: { id: product.id }, select: { sku: true } });
    expect(persisted?.sku).toBe(product.sku);
  });

  it("cria produto COM SKU informado", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Perfume Com Codigo", sku: "MEU-SKU-001", price: 200, stock: 3 },
    });

    expect(response.status).toBe(201);
    expect((response.body.data as { sku: string }).sku).toBe("MEU-SKU-001");
  });

  it("persiste a galeria de imagens com posição e enquadramento", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: {
        name: "Perfume Com Fotos",
        price: 99.9,
        stock: 1,
        images: [
          { url: "/uploads/frente.png", alt: "frente", focalPoint: "top" },
          { url: "https://cdn.exemplo.test/lado.png", alt: "lado" },
        ],
      },
    });

    expect(response.status).toBe(201);
    const images = (response.body.data as { images: Array<{ url: string; position: number; focalPoint: string }> }).images;
    expect(images).toHaveLength(2);
    expect(images[0]!.url).toBe("/uploads/frente.png");
    expect(images[0]!.position).toBe(0);
    expect(images[0]!.focalPoint).toBe("top");
    expect(images[1]!.position).toBe(1);
    expect(images[1]!.focalPoint).toBe("center");
  });

  it("gera SKUs diferentes para produtos sem SKU", async () => {
    const a = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Produto Repetido", price: 10, stock: 1 },
    });
    const b = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Produto Repetido", price: 10, stock: 1 },
    });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((a.body.data as { sku: string }).sku).not.toBe((b.body.data as { sku: string }).sku);
  });
});

describe("PATCH /api/admin/products/:id", () => {
  async function createProduct(images: Array<{ url: string; alt?: string; focalPoint?: string }> = []) {
    const response = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Produto Editavel", sku: `EDIT-${Date.now()}`, price: 100, stock: 10, images },
    });
    expect(response.status).toBe(201);
    return response.body.data as { id: string; images: Array<{ id: string; url: string; position: number }> };
  }

  it("edita preço e estoque preservando a galeria quando `images` não é enviado", async () => {
    const product = await createProduct([{ url: "/uploads/a.png" }, { url: "/uploads/b.png" }]);

    const response = await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${product.id}`,
      token: admin.token,
      payload: { price: 79.9, stock: 42 },
    });

    expect(response.status).toBe(200);
    const updated = response.body.data as { price: number; stock: number; images: unknown[] };
    expect(updated.price).toBe(79.9);
    expect(updated.stock).toBe(42);
    expect(updated.images).toHaveLength(2);
  });

  it("substitui a galeria e reordena as posições", async () => {
    const product = await createProduct([{ url: "/uploads/antiga.png" }]);

    const response = await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${product.id}`,
      token: admin.token,
      payload: {
        images: [
          { url: "/uploads/capa-nova.png", focalPoint: "center" },
          { url: "/uploads/detalhe-novo.png", focalPoint: "bottom" },
        ],
      },
    });

    expect(response.status).toBe(200);
    const images = (response.body.data as { images: Array<{ url: string; position: number; focalPoint: string }> }).images;
    expect(images.map((image) => image.url)).toEqual(["/uploads/capa-nova.png", "/uploads/detalhe-novo.png"]);
    expect(images.map((image) => image.position)).toEqual([0, 1]);
    expect(images[1]!.focalPoint).toBe("bottom");
  });

  it("remove uma imagem específica mantendo as demais", async () => {
    const product = await createProduct([
      { url: "/uploads/1.png" },
      { url: "/uploads/2.png" },
      { url: "/uploads/3.png" },
    ]);

    const response = await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${product.id}`,
      token: admin.token,
      payload: { images: [{ url: "/uploads/1.png" }, { url: "/uploads/3.png" }] },
    });

    expect(response.status).toBe(200);
    const images = (response.body.data as { images: Array<{ url: string }> }).images;
    expect(images.map((image) => image.url)).toEqual(["/uploads/1.png", "/uploads/3.png"]);
  });

  it("rejeita URL de imagem perigosa", async () => {
    const product = await createProduct();
    const response = await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${product.id}`,
      token: admin.token,
      payload: { images: [{ url: "javascript:alert(1)" }] },
    });

    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/admin/uploads (biblioteca)", () => {
  it("lista as imagens salvas com URL relativa e paginação", async () => {
    await seedUploads(5);

    const firstPage = await api(app, {
      method: "GET",
      url: `/api/admin/uploads?search=${runId}&page=1&perPage=2`,
      token: admin.token,
    });

    expect(firstPage.status).toBe(200);
    const data = firstPage.body.data as {
      items: Array<{ filename: string; url: string; size: number; createdAt: string }>;
      total: number;
      page: number;
      perPage: number;
    };
    expect(data.total).toBe(5);
    expect(data.page).toBe(1);
    expect(data.perPage).toBe(2);
    expect(data.items).toHaveLength(2);
    for (const item of data.items) {
      expect(item.filename.startsWith(runId)).toBe(true);
      expect(item.url).toBe(`/uploads/${item.filename}`);
      expect(item.size).toBeGreaterThan(0);
    }

    const lastPage = await api(app, {
      method: "GET",
      url: `/api/admin/uploads?search=${runId}&page=3&perPage=2`,
      token: admin.token,
    });
    expect((lastPage.body.data as { items: unknown[] }).items).toHaveLength(1);
  });

  it("filtra pela busca de nome", async () => {
    await seedUploads(3);

    const response = await api(app, {
      method: "GET",
      url: `/api/admin/uploads?search=${runId}-02&page=1&perPage=24`,
      token: admin.token,
    });

    const data = response.body.data as { items: Array<{ filename: string }>; total: number };
    expect(data.total).toBe(1);
    expect(data.items[0]!.filename).toBe(`${runId}-02.png`);
  });

  it("exige administrador", async () => {
    const response = await api(app, { method: "GET", url: "/api/admin/uploads" });
    expect(response.status).toBe(401);
  });
});
