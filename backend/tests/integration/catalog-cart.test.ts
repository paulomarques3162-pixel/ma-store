import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, createClient, createShopFixture, db, makeApp, resetDatabase } from "../helpers";

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  const prisma = await db();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

async function fixtureWithCatalog() {
  const prisma = await db();
  const { product, category } = await createShopFixture({ stock: 5, price: "100.00" });

  await prisma.product.create({
    data: {
      name: "Perfume Barato",
      slug: "perfume-barato",
      sku: `SKU-BARATO-${Date.now()}`,
      price: "50.00",
      stock: 3,
      categoryId: category.id,
      active: true,
      isLaunch: true,
    },
  });

  await prisma.product.create({
    data: {
      name: "Perfume Esgotado",
      slug: "perfume-esgotado",
      sku: `SKU-ZERO-${Date.now()}`,
      price: "80.00",
      stock: 0,
      categoryId: category.id,
      active: true,
    },
  });

  await prisma.product.create({
    data: {
      name: "Perfume Oculto",
      slug: "perfume-oculto",
      sku: `SKU-OFF-${Date.now()}`,
      price: "10.00",
      stock: 100,
      active: false,
    },
  });

  return { product, category };
}

describe("catalogo publico", () => {
  it("lista apenas produtos ativos com paginacao", async () => {
    await fixtureWithCatalog();
    const response = await api(app, { method: "GET", url: "/api/products" });

    expect(response.status).toBe(200);
    const data = response.body.data as Array<{ slug: string }>;
    expect(data.map((p) => p.slug)).not.toContain("perfume-oculto");
    expect((response.body.meta as { total: number }).total).toBe(3);
  });

  it("busca por nome, marca, categoria e SKU", async () => {
    await fixtureWithCatalog();

    const byName = await api(app, { method: "GET", url: "/api/products?search=Barato" });
    expect((byName.body.data as unknown[]).length).toBe(1);

    const byCategory = await api(app, { method: "GET", url: "/api/products?search=Categoria" });
    expect((byCategory.body.data as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it("filtra por faixa de preco, disponibilidade e lancamento", async () => {
    await fixtureWithCatalog();

    const priceRange = await api(app, { method: "GET", url: "/api/products?minPrice=60&maxPrice=120" });
    const prices = (priceRange.body.data as Array<{ price: string | number }>).map((p) => Number(p.price));
    expect(prices.every((p) => p >= 60 && p <= 120)).toBe(true);

    const inStock = await api(app, { method: "GET", url: "/api/products?inStock=true" });
    const available = inStock.body.data as Array<{ slug: string }>;
    expect(available.map((p) => p.slug)).not.toContain("perfume-esgotado");

    const launches = await api(app, { method: "GET", url: "/api/products?launch=true" });
    expect((launches.body.data as Array<{ slug: string }>).map((p) => p.slug)).toEqual(["perfume-barato"]);
  });

  it("ordena por preco", async () => {
    await fixtureWithCatalog();

    const asc = await api(app, { method: "GET", url: "/api/products?sort=price_asc" });
    const ascPrices = (asc.body.data as Array<{ price: string | number }>).map((p) => Number(p.price));
    expect(ascPrices).toEqual([...ascPrices].sort((a, b) => a - b));

    const desc = await api(app, { method: "GET", url: "/api/products?sort=price_desc" });
    const descPrices = (desc.body.data as Array<{ price: string | number }>).map((p) => Number(p.price));
    expect(descPrices).toEqual([...descPrices].sort((a, b) => b - a));
  });

  it("respeita o teto de itens por pagina e sinaliza paginacao", async () => {
    await fixtureWithCatalog();
    const response = await api(app, { method: "GET", url: "/api/products?perPage=2&page=1" });
    expect((response.body.data as unknown[]).length).toBe(2);
    expect((response.body.meta as { hasNext: boolean }).hasNext).toBe(true);
  });

  it("retorna o detalhe, relacionados, facetas e disponibilidade", async () => {
    const { product } = await fixtureWithCatalog();

    const detail = await api(app, { method: "GET", url: `/api/products/${product.slug}` });
    expect(detail.status).toBe(200);
    expect((detail.body.data as { sku: string }).sku).toBe(product.sku);

    const related = await api(app, { method: "GET", url: `/api/products/${product.slug}/related` });
    expect(related.status).toBe(200);

    const facets = await api(app, { method: "GET", url: "/api/products/facets" });
    expect(facets.status).toBe(200);

    const availability = await api(app, { method: "GET", url: `/api/products/${product.slug}/availability` });
    expect((availability.body.data as { available: boolean }).available).toBe(true);
  });

  it("nao expoe custo nem dados internos do produto", async () => {
    const prisma = await db();
    const { product } = await createShopFixture();
    await prisma.product.update({ where: { id: product.id }, data: { costPrice: "12.34" } });

    const detail = await api(app, { method: "GET", url: `/api/products/${product.slug}` });
    const serialized = JSON.stringify(detail.body);
    expect(serialized).not.toContain("costPrice");
    expect(serialized).not.toContain("12.34");
  });

  it("404 para produto inexistente", async () => {
    const response = await api(app, { method: "GET", url: "/api/products/nao-existe" });
    expect(response.status).toBe(404);
  });

  it("lista categorias e marcas ativas", async () => {
    await fixtureWithCatalog();
    const categories = await api(app, { method: "GET", url: "/api/categories" });
    expect(categories.status).toBe(200);
    expect((categories.body.data as unknown[]).length).toBeGreaterThanOrEqual(1);

    const brands = await api(app, { method: "GET", url: "/api/brands" });
    expect(brands.status).toBe(200);
  });
});

describe("carrinho", () => {
  it("adiciona, acumula, atualiza, remove e limpa", async () => {
    const { product } = await fixtureWithCatalog();
    const client = await createClient(app);
    const auth = { token: client.accessToken };

    const added = await api(app, { method: "POST", url: "/api/cart/items", ...auth, payload: { productId: product.id, quantity: 2 } });
    expect(added.status).toBe(200);
    expect((added.body.data as { summary: { totalItems: number } }).summary.totalItems).toBe(2);

    const accumulated = await api(app, { method: "POST", url: "/api/cart/items", ...auth, payload: { productId: product.id, quantity: 1 } });
    expect((accumulated.body.data as { summary: { totalItems: number } }).summary.totalItems).toBe(3);

    const cart = accumulated.body.data as { items: Array<{ id: string }> };
    const itemId = cart.items[0]!.id;

    const updated = await api(app, { method: "PATCH", url: `/api/cart/items/${itemId}`, ...auth, payload: { quantity: 4 } });
    expect((updated.body.data as { summary: { totalItems: number } }).summary.totalItems).toBe(4);

    const zero = await api(app, { method: "PATCH", url: `/api/cart/items/${itemId}`, ...auth, payload: { quantity: 0 } });
    expect((zero.body.data as { items: unknown[] }).items).toHaveLength(0);

    await api(app, { method: "POST", url: "/api/cart/items", ...auth, payload: { productId: product.id, quantity: 1 } });
    const cleared = await api(app, { method: "DELETE", url: "/api/cart", ...auth });
    expect((cleared.body.data as { items: unknown[] }).items).toHaveLength(0);
  });

  it("calcula o subtotal no servidor", async () => {
    const { product } = await fixtureWithCatalog();
    const client = await createClient(app);

    const response = await api(app, {
      method: "POST",
      url: "/api/cart/items",
      token: client.accessToken,
      payload: { productId: product.id, quantity: 3 },
    });

    expect((response.body.data as { summary: { subtotal: number } }).summary.subtotal).toBe(300);
  });

  it("recusa quantidade acima do estoque disponivel", async () => {
    const { product } = await fixtureWithCatalog();
    const client = await createClient(app);

    const response = await api(app, {
      method: "POST",
      url: "/api/cart/items",
      token: client.accessToken,
      payload: { productId: product.id, quantity: 999 },
    });

    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("INSUFFICIENT_STOCK");
  });

  it("recusa produto inexistente ou inativo", async () => {
    const prisma = await db();
    const client = await createClient(app);
    const hidden = await prisma.product.create({
      data: { name: "Oculto", slug: `oculto-${Date.now()}`, sku: `OFF-${Date.now()}`, price: "10.00", stock: 5, active: false },
    });

    const response = await api(app, {
      method: "POST",
      url: "/api/cart/items",
      token: client.accessToken,
      payload: { productId: hidden.id, quantity: 1 },
    });
    expect(response.status).toBe(404);
  });

  it("mantem carrinhos independentes por usuario", async () => {
    const { product } = await fixtureWithCatalog();
    const a = await createClient(app);
    const b = await createClient(app);

    await api(app, { method: "POST", url: "/api/cart/items", token: a.accessToken, payload: { productId: product.id, quantity: 1 } });

    const cartB = await api(app, { method: "GET", url: "/api/cart", token: b.accessToken });
    expect((cartB.body.data as { items: unknown[] }).items).toHaveLength(0);
  });

  it("nao permite alterar item do carrinho de outro usuario", async () => {
    const { product } = await fixtureWithCatalog();
    const a = await createClient(app);
    const b = await createClient(app);

    const cartA = await api(app, {
      method: "POST",
      url: "/api/cart/items",
      token: a.accessToken,
      payload: { productId: product.id, quantity: 1 },
    });
    const itemId = (cartA.body.data as { items: Array<{ id: string }> }).items[0]!.id;

    const attempt = await api(app, {
      method: "PATCH",
      url: `/api/cart/items/${itemId}`,
      token: b.accessToken,
      payload: { quantity: 5 },
    });
    expect(attempt.status).toBe(404);
  });

  it("exige autenticacao", async () => {
    const response = await api(app, { method: "GET", url: "/api/cart" });
    expect(response.status).toBe(401);
  });
});

describe("favoritos", () => {
  it("favorita, lista, consulta ids e desfavorita", async () => {
    const { product } = await fixtureWithCatalog();
    const client = await createClient(app);
    const auth = { token: client.accessToken };

    const added = await api(app, { method: "POST", url: `/api/favorites/${product.id}`, ...auth });
    expect(added.status).toBe(200);

    const duplicated = await api(app, { method: "POST", url: `/api/favorites/${product.id}`, ...auth });
    expect(duplicated.status).toBe(409);

    const list = await api(app, { method: "GET", url: "/api/favorites", ...auth });
    expect((list.body.data as unknown[]).length).toBe(1);

    const ids = await api(app, { method: "GET", url: "/api/favorites/ids", ...auth });
    expect(ids.body.data).toEqual([product.id]);

    const removed = await api(app, { method: "DELETE", url: `/api/favorites/${product.id}`, ...auth });
    expect(removed.status).toBe(200);

    const empty = await api(app, { method: "GET", url: "/api/favorites", ...auth });
    expect((empty.body.data as unknown[]).length).toBe(0);
  });
});
