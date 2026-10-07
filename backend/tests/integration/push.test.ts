import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api, createAdmin, db, makeApp, resetDatabase } from "../helpers";

/**
 * Web Push real (backend):
 *  - rotas públicas de inscrição (Guest Checkout: sem conta);
 *  - publicação de produto dispara notificação para quem consentiu;
 *  - inscrição expirada (410) é removida.
 *
 * O `web-push` é mockado: não fazemos chamadas de rede para o serviço de push.
 */

const { sendNotification, setVapidDetails } = vi.hoisted(() => ({
  sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
  setVapidDetails: vi.fn(),
}));

vi.mock("web-push", () => ({ default: { setVapidDetails, sendNotification } }));

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
  sendNotification.mockClear();
  sendNotification.mockResolvedValue({ statusCode: 201 });
});

const SUB_A = {
  endpoint: "https://push.exemplo.test/sub/a",
  keys: { p256dh: "chave-p256dh-a", auth: "auth-a" },
};
const SUB_B = {
  endpoint: "https://push.exemplo.test/sub/b",
  keys: { p256dh: "chave-p256dh-b", auth: "auth-b" },
};

async function enablePush() {
  const { env } = await import("../../src/env.js");
  env.VAPID_PUBLIC_KEY = "test-public-key";
  env.VAPID_PRIVATE_KEY = "test-private-key";
  env.VAPID_SUBJECT = "mailto:teste@teste.local";
}

describe("GET /api/push/public-key", () => {
  it("informa que o push está DESATIVADO quando não há chaves VAPID", async () => {
    const response = await api(app, { method: "GET", url: "/api/push/public-key" });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ enabled: false, key: null });
  });

  it("devolve a chave PÚBLICA quando configurado (nunca a privada)", async () => {
    await enablePush();
    const response = await api(app, { method: "GET", url: "/api/push/public-key" });
    expect(response.status).toBe(200);
    const data = response.body.data as { enabled: boolean; key: string | null };
    expect(data.enabled).toBe(true);
    expect(data.key).toBe("test-public-key");
    expect(JSON.stringify(response.body)).not.toContain("test-private-key");
  });
});

describe("inscrição de push", () => {
  it("registra e remove a inscrição (idempotente por endpoint)", async () => {
    const first = await api(app, { method: "POST", url: "/api/push/subscribe", payload: SUB_A });
    expect(first.status).toBe(200);

    // Repetir a inscrição não duplica.
    const second = await api(app, { method: "POST", url: "/api/push/subscribe", payload: SUB_A });
    expect(second.status).toBe(200);

    const prisma = await db();
    expect(await prisma.pushSubscription.count()).toBe(1);

    const removed = await api(app, {
      method: "POST",
      url: "/api/push/unsubscribe",
      payload: { endpoint: SUB_A.endpoint },
    });
    expect(removed.status).toBe(200);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it("recusa inscrição inválida (422)", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/push/subscribe",
      payload: { endpoint: "nao-e-url", keys: { p256dh: "", auth: "" } },
    });
    expect(response.status).toBe(422);
  });
});

describe("notificação de novo produto", () => {
  it("envia para todos os inscritos quando o produto nasce ATIVO", async () => {
    await enablePush();
    await api(app, { method: "POST", url: "/api/push/subscribe", payload: SUB_A });
    await api(app, { method: "POST", url: "/api/push/subscribe", payload: SUB_B });

    const response = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Novidade Push", price: 123.45, stock: 3, active: true },
    });
    expect(response.status).toBe(201);

    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(2));
    const [, payload] = sendNotification.mock.calls[0]!;
    expect(String(payload)).toContain("Novo produto na MA STORE");
  });

  it("NÃO envia quando o produto é criado inativo", async () => {
    await enablePush();
    await api(app, { method: "POST", url: "/api/push/subscribe", payload: SUB_A });

    const response = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Rascunho", price: 10, stock: 1, active: false },
    });
    expect(response.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("envia quando um produto é ATIVADO depois", async () => {
    await enablePush();
    await api(app, { method: "POST", url: "/api/push/subscribe", payload: SUB_A });

    const created = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Vai Ativar", price: 50, stock: 2, active: false },
    });
    const product = created.body.data as { id: string };

    const patch = await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${product.id}`,
      token: admin.token,
      payload: { active: true },
    });
    expect(patch.status).toBe(200);

    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1));
  });

  it("remove a inscrição expirada (410) sem quebrar o envio", async () => {
    await enablePush();
    await api(app, { method: "POST", url: "/api/push/subscribe", payload: SUB_A });

    sendNotification.mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));

    await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Produto com inscrição expirada", price: 10, stock: 1, active: true },
    });

    await vi.waitFor(async () => {
      const prisma = await db();
      expect(await prisma.pushSubscription.count()).toBe(0);
    });
  });
});

/**
 * Idempotência e concorrência do aviso de "produto novo".
 *
 * Regra de negócio: UM produto publicado gera NO MÁXIMO UM aviso, mesmo com
 * duplo clique, retry de rede, requisições simultâneas ou edição comum. A trava
 * é persistente (`products.notifiedAt`) e reivindicada por UPDATE atômico.
 */
describe("idempotência do aviso de produto novo", () => {
  it("editar um produto já publicado NÃO gera novo aviso", async () => {
    await enablePush();
    await api(app, { method: "POST", url: "/api/push/subscribe", payload: SUB_A });

    const created = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Publicado", price: 99, stock: 5, active: true },
    });
    const product = created.body.data as { id: string };
    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1));
    sendNotification.mockClear();

    // Edições comuns: preço, nome, estoque, descrição, imagem.
    const edits = [
      { price: 89.9 },
      { name: "Publicado Renomeado" },
      { stock: 42 },
      { description: "Descrição nova" },
      { active: true },
      { images: [{ url: "/uploads/nova.jpg", position: 0 }] },
    ];
    for (const payload of edits) {
      const response = await api(app, {
        method: "PATCH",
        url: `/api/admin/products/${product.id}`,
        token: admin.token,
        payload,
      });
      expect(response.status).toBe(200);
    }

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("ativar o mesmo produto duas vezes dispara APENAS um aviso", async () => {
    await enablePush();
    await api(app, { method: "POST", url: "/api/push/subscribe", payload: SUB_A });

    const created = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Ativa Duas Vezes", price: 10, stock: 1, active: false },
    });
    const product = created.body.data as { id: string };

    await api(app, { method: "PATCH", url: `/api/admin/products/${product.id}`, token: admin.token, payload: { active: true } });
    await api(app, { method: "PATCH", url: `/api/admin/products/${product.id}`, token: admin.token, payload: { active: true } });

    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("duas ativações SIMULTÂNEAS não duplicam o aviso (corrida)", async () => {
    await enablePush();
    await api(app, { method: "POST", url: "/api/push/subscribe", payload: SUB_A });

    const created = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Corrida de Ativação", price: 10, stock: 1, active: false },
    });
    const product = created.body.data as { id: string };

    // Ambas as requisições leem `active=false` antes de qualquer gravação.
    const [a, b] = await Promise.all([
      api(app, { method: "PATCH", url: `/api/admin/products/${product.id}`, token: admin.token, payload: { active: true } }),
      api(app, { method: "PATCH", url: `/api/admin/products/${product.id}`, token: admin.token, payload: { active: true } }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);

    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("retry da criação (mesmo SKU) responde 409 e não duplica o aviso", async () => {
    await enablePush();
    await api(app, { method: "POST", url: "/api/push/subscribe", payload: SUB_A });

    const payload = { name: "Retry de Criação", sku: "SKU-RETRY-1", price: 10, stock: 1, active: true };
    const first = await api(app, { method: "POST", url: "/api/admin/products", token: admin.token, payload });
    expect(first.status).toBe(201);

    const retry = await api(app, { method: "POST", url: "/api/admin/products", token: admin.token, payload });
    expect(retry.status).toBe(409);

    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("marca notifiedAt no banco e não reenvia ao republicar (off → on)", async () => {
    await enablePush();
    await api(app, { method: "POST", url: "/api/push/subscribe", payload: SUB_A });

    const created = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Republicar", price: 10, stock: 1, active: true },
    });
    const product = created.body.data as { id: string };
    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1));

    const prisma = await db();
    const stored = await prisma.product.findUnique({ where: { id: product.id }, select: { notifiedAt: true } });
    expect(stored?.notifiedAt).toBeInstanceOf(Date);

    // Desativa e reativa: continua sendo o MESMO produto, não uma novidade.
    await api(app, { method: "PATCH", url: `/api/admin/products/${product.id}`, token: admin.token, payload: { active: false } });
    await api(app, { method: "PATCH", url: `/api/admin/products/${product.id}`, token: admin.token, payload: { active: true } });

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});
