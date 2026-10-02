import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADDRESS, api, createAdmin, createClient, createShopFixture, db, makeApp, resetDatabase } from "../helpers";

/**
 * Exclusão de produto com contagem de pedidos:
 *  - produto NUNCA vendido -> `?hard=true` exclui de verdade;
 *  - produto COM pedidos   -> hard delete é bloqueado (400) e resta o soft delete.
 * A lista do admin precisa expor `_count.orderItems` para o diálogo decidir.
 */

let app: FastifyInstance;
let admin: { token: string; id: string };

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
  admin = await createAdmin(app);
});

async function listProduct(productId: string) {
  const response = await api(app, { method: "GET", url: "/api/admin/products?perPage=50", token: admin.token });
  const items = response.body.data as Array<{ id: string; sku: string; _count?: { orderItems: number } }>;
  return items.find((item) => item.id === productId);
}

describe("exclusão de produto", () => {
  it("produto sem pedidos: lista mostra 0 pedidos e o hard delete remove de verdade", async () => {
    const { product } = await createShopFixture();

    const listed = await listProduct(product.id);
    expect(listed?._count?.orderItems).toBe(0);

    const removed = await api(app, {
      method: "DELETE",
      url: `/api/admin/products/${product.id}?hard=true`,
      token: admin.token,
    });
    expect(removed.status).toBe(200);
    expect((removed.body.data as { hard: boolean }).hard).toBe(true);

    const after = await api(app, { method: "GET", url: `/api/admin/products/${product.id}`, token: admin.token });
    expect(after.status).toBe(404);
  });

  it("produto com pedidos: conta pedidos, bloqueia hard delete e permite soft delete", async () => {
    const { product, shipping } = await createShopFixture();
    const client = await createClient(app);

    await api(app, {
      method: "POST",
      url: "/api/cart/items",
      token: client.accessToken,
      payload: { productId: product.id, quantity: 1 },
    });
    const order = await api(app, {
      method: "POST",
      url: "/api/orders",
      token: client.accessToken,
      headers: { "x-idempotency-key": `del-${Date.now()}` },
      payload: { paymentMethod: "PIX", shippingMethodId: shipping.id, address: ADDRESS },
    });
    expect(order.status).toBe(201);

    const listed = await listProduct(product.id);
    expect(listed?._count?.orderItems).toBe(1);

    const blocked = await api(app, {
      method: "DELETE",
      url: `/api/admin/products/${product.id}?hard=true`,
      token: admin.token,
    });
    expect(blocked.status).toBe(400);

    const soft = await api(app, {
      method: "DELETE",
      url: `/api/admin/products/${product.id}`,
      token: admin.token,
    });
    expect(soft.status).toBe(200);
    expect((soft.body.data as { hard: boolean; active: boolean }).hard).toBe(false);
    expect((soft.body.data as { active: boolean }).active).toBe(false);
  });
});
