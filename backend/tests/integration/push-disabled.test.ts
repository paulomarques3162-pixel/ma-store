import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api, createAdmin, db, makeApp, resetDatabase } from "../helpers";

/**
 * Push DESATIVADO (sem chaves VAPID).
 *
 * Regra do projeto: sem VAPID a loja continua funcionando, o produto continua
 * sendo criado normalmente e o push fica explicitamente desligado — nenhuma
 * notificação falsa é apresentada como enviada.
 *
 * Este arquivo é separado de `push.test.ts` de propósito: lá o push é ligado
 * (`enablePush()`) e o serviço memoiza a configuração; aqui ele nasce desligado,
 * então o caminho "sem VAPID" é realmente exercitado.
 */

const { sendNotification, setVapidDetails } = vi.hoisted(() => ({
  sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
  setVapidDetails: vi.fn(),
}));

vi.mock("web-push", () => ({ default: { setVapidDetails, sendNotification } }));

let app: FastifyInstance;
let admin: { token: string; id: string };

beforeAll(async () => {
  const { env } = await import("../../src/env.js");
  env.VAPID_PUBLIC_KEY = "";
  env.VAPID_PRIVATE_KEY = "";
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
});

describe("push desativado (sem VAPID)", () => {
  it("GET /api/push/public-key informa enabled=false e key=null", async () => {
    const response = await api(app, { method: "GET", url: "/api/push/public-key" });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ enabled: false, key: null });
  });

  it("cria o produto normalmente e não tenta enviar nada", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      token: admin.token,
      payload: { name: "Produto Sem VAPID", price: 123.45, stock: 4, active: true },
    });
    expect(response.status).toBe(201);

    const product = response.body.data as { id: string; active: boolean };
    expect(product.active).toBe(true);

    // A publicação é registrada mesmo sem push (a marca é de publicação, não de envio).
    const prisma = await db();
    const stored = await prisma.product.findUnique({ where: { id: product.id }, select: { notifiedAt: true } });
    expect(stored?.notifiedAt).toBeInstanceOf(Date);

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(sendNotification).not.toHaveBeenCalled();
    expect(setVapidDetails).not.toHaveBeenCalled();
  });
});
