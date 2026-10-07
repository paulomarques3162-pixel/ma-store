import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, makeApp } from "../helpers";

/**
 * Rate limit dedicado das rotas de ESCRITA do push.
 *
 * `/api/push/subscribe` é público (Guest Checkout) e grava no banco. Sem um
 * limite próprio, um script poderia inserir milhares de inscrições falsas.
 * O limite global da suíte é alto de propósito (para os testes não travarem),
 * então este teste prova que o limite POR ROTA realmente vale.
 *
 * Arquivo separado: o contador do `@fastify/rate-limit` vive na instância da
 * aplicação, então aqui ele nasce zerado e não afeta os outros testes.
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

describe("rate limit das rotas de push", () => {
  it("bloqueia (429) depois de 20 inscrições no mesmo minuto", async () => {
    let blocked = 0;
    let accepted = 0;

    for (let index = 0; index < 25; index += 1) {
      const response = await api(app, {
        method: "POST",
        url: "/api/push/subscribe",
        payload: {
          endpoint: `https://push.exemplo.test/abuso/${index}`,
          keys: { p256dh: `chave-${index}`, auth: `auth-${index}` },
        },
      });
      if (response.status === 429) blocked += 1;
      if (response.status === 200) accepted += 1;
    }

    expect(accepted).toBe(20);
    expect(blocked).toBe(5);
  });
});
