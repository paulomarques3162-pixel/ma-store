import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, createAdmin, createClient, db, makeApp, resetDatabase } from "../helpers";
import { hashPassword } from "../../src/lib/password";

let app: FastifyInstance;
let baseUrl: string;
let admin: { token: string; id: string };

/** PNG mínimo com IHDR válido (o `image-size` lê as dimensões daqui). */
function pngBuffer(width = 800, height = 600): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    (width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    (height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    0x08, 0x02, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

beforeAll(async () => {
  app = await makeApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Sem porta");
  baseUrl = `http://127.0.0.1:${address.port}`;
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

type Driver = { id: string; email: string; password: string; token: string };

async function makeDriver(over: { name?: string; email?: string; password?: string; status?: "ACTIVE" | "BLOCKED" } = {}): Promise<Driver> {
  const prisma = await db();
  const email = over.email ?? `motoboy-${Date.now()}-${Math.random().toString(16).slice(2, 6)}@test.local`;
  const password = over.password ?? "Motoboy@123";
  const user = await prisma.user.create({
    data: {
      name: over.name ?? "Motoboy de Teste",
      email,
      passwordHash: await hashPassword(password),
      role: "DELIVERY_PERSON",
      status: over.status ?? "ACTIVE",
    },
  });
  const login = await api(app, { method: "POST", url: "/api/auth/login", payload: { email, password } });
  const token = (login.body.data as { accessToken?: string } | undefined)?.accessToken ?? "";
  return { id: user.id, email, password, token };
}

async function makePedido(statusAtual = "Pronto para Envio") {
  const prisma = await db();
  return prisma.pedido.create({
    data: {
      tokenRastreioUnico: `tok-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      clienteNome: "Cliente Teste",
      clienteWhatsapp: "11999990000",
      enderecoCompleto: {
        cep: "13610000",
        logradouro: "Rua das Flores",
        numero: "123",
        complemento: null,
        bairro: "Centro",
        cidade: "Pirassununga",
        uf: "SP",
      },
      produtosCarrinho: [{ id: "p1", nome: "Produto", quantidade: 1, preco: 100, peso_unitario: 0.5 }],
      statusAtual,
    },
  });
}

async function assign(pedidoId: number, driverId: string) {
  return api(app, { method: "POST", url: "/api/admin/delivery/assign", token: admin.token, payload: { pedidoId, driverId } });
}

async function uploadProof(deliveryId: string, token: string, bytes: Uint8Array, type = "image/png") {
  const form = new FormData();
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.append("file", new Blob([arrayBuffer], { type }), "proof.png");
  const response = await fetch(`${baseUrl}/api/delivery/${deliveryId}/photo`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as { data?: { proofPhotoRef?: string }; error?: { code?: string } } | null };
}

describe("entrega — autenticacao e autorizacao", () => {
  it("entregador faz login e acessa apenas as proprias entregas", async () => {
    const d1 = await makeDriver({ name: "Moto 1" });
    const d2 = await makeDriver({ name: "Moto 2" });
    const p1 = await makePedido();
    const p2 = await makePedido();

    const a1 = (await assign(p1.id, d1.id)).body.data as { delivery: { id: string } };
    await assign(p2.id, d2.id);

    const mine = await api(app, { method: "GET", url: "/api/delivery/my", token: d1.token });
    expect(mine.status).toBe(200);
    const deliveries = (mine.body.data as { deliveries: Array<{ id: string }> }).deliveries;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.id).toBe(a1.delivery.id);
  });

  it("nao vaza dados de outro entregador via detailed (403)", async () => {
    const d1 = await makeDriver();
    const d2 = await makeDriver();
    const p1 = await makePedido();
    const a1 = (await assign(p1.id, d1.id)).body.data as { delivery: { id: string } };

    const response = await api(app, { method: "GET", url: `/api/delivery/${a1.delivery.id}`, token: d2.token });
    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("NOT_AUTHORIZED");
  });

  it("cliente nao acessa endpoints administrativos nem o modulo de entregador", async () => {
    const client = await createClient(app);
    const admin1 = await api(app, { method: "GET", url: "/api/admin/delivery", token: client.accessToken });
    expect(admin1.status).toBe(403);
    const driver1 = await api(app, { method: "GET", url: "/api/delivery/my", token: client.accessToken });
    expect(driver1.status).toBe(403);
  });

  it("admin acessa todas as entregas", async () => {
    const d1 = await makeDriver();
    const p1 = await makePedido();
    await assign(p1.id, d1.id);
    const response = await api(app, { method: "GET", url: "/api/admin/delivery", token: admin.token });
    expect(response.status).toBe(200);
    expect((response.body.data as { deliveries: unknown[] }).deliveries.length).toBeGreaterThan(0);
  });

  it("nao aceita driverId do frontend como autorizacao em /my", async () => {
    const d1 = await makeDriver();
    const d2 = await makeDriver();
    const p1 = await makePedido();
    await assign(p1.id, d1.id);

    const response = await api(app, {
      method: "GET",
      url: `/api/delivery/my?driverId=${d2.id}`,
      token: d2.token,
    });
    expect(response.status).toBe(200);
    expect((response.body.data as { deliveries: unknown[] }).deliveries).toHaveLength(0);
  });
});

describe("entrega — atribuicao (admin)", () => {
  it("atribui ao entregador, registra evento e notifica", async () => {
    const driver = await makeDriver();
    const pedido = await makePedido();
    const response = await assign(pedido.id, driver.id);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const delivery = (response.body.data as { delivery: { status: string; driver: { id: string } } }).delivery;
    expect(delivery.status).toBe("ASSIGNED");
    expect(delivery.driver.id).toBe(driver.id);

    const prisma = await db();
    const events = await prisma.deliveryEvent.findMany({ where: { delivery: { pedidoId: pedido.id } } });
    expect(events.some((event) => event.status === "ASSIGNED")).toBe(true);
    const notifications = await prisma.notification.count({ where: { userId: driver.id } });
    expect(notifications).toBe(1);
  });

  it("rejeita cliente como entregador", async () => {
    const client = await createClient(app);
    const pedido = await makePedido();
    const response = await assign(pedido.id, client.user.id);
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("INVALID_DRIVER");
  });

  it("rejeita entregador desativado", async () => {
    const driver = await makeDriver({ status: "BLOCKED" });
    const pedido = await makePedido();
    const response = await assign(pedido.id, driver.id);
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("INVALID_DRIVER");
  });

  it("rejeita entregador inexistente", async () => {
    const pedido = await makePedido();
    const response = await assign(pedido.id, "nao-existe");
    expect(response.status).toBe(404);
    expect(response.body.error?.code).toBe("DRIVER_NOT_FOUND");
  });
});

describe("entrega — inicio", () => {
  it("inicia a entrega, grava startedAt do servidor, evento e status do pedido", async () => {
    const driver = await makeDriver();
    const pedido = await makePedido();
    const delivery = (await assign(pedido.id, driver.id)).body.data as { delivery: { id: string } };

    const response = await api(app, {
      method: "POST",
      url: `/api/delivery/${delivery.delivery.id}/start`,
      token: driver.token,
      payload: { latitude: -22.12, longitude: -47.12, locationAccuracy: 12.4 },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const started = (response.body.data as { status: string; startedAt: string | null }).status;
    expect(started).toBe("OUT_FOR_DELIVERY");

    const prisma = await db();
    const row = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.delivery.id } });
    expect(row.startedAt).not.toBeNull();
    const updatedPedido = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    expect(updatedPedido.statusAtual).toBe("Saiu para Entrega");
  });

  it("impede outro entregador de iniciar", async () => {
    const d1 = await makeDriver();
    const d2 = await makeDriver();
    const pedido = await makePedido();
    const delivery = (await assign(pedido.id, d1.id)).body.data as { delivery: { id: string } };

    const response = await api(app, {
      method: "POST",
      url: `/api/delivery/${delivery.delivery.id}/start`,
      token: d2.token,
      payload: {},
    });
    expect(response.status).toBe(403);
  });
});

describe("entrega — foto e confirmacao", () => {
  async function setup() {
    const driver = await makeDriver();
    const pedido = await makePedido();
    const deliveryId = ((await assign(pedido.id, driver.id)).body.data as { delivery: { id: string } }).delivery.id;
    await api(app, { method: "POST", url: `/api/delivery/${deliveryId}/start`, token: driver.token, payload: {} });
    return { driver, pedido, deliveryId };
  }

  it("exige nome do recebedor", async () => {
    const { driver, deliveryId } = await setup();
    const response = await api(app, {
      method: "POST",
      url: `/api/delivery/${deliveryId}/confirm`,
      token: driver.token,
      payload: { recipientName: "", proofPhotoRef: "delivery-proofs/x/y.png" },
    });
    expect(response.status).toBe(422);
  });

  it("exige foto da entrega", async () => {
    const { driver, deliveryId } = await setup();
    const response = await api(app, {
      method: "POST",
      url: `/api/delivery/${deliveryId}/confirm`,
      token: driver.token,
      payload: { recipientName: "Joao" },
    });
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("PROOF_REQUIRED");
  });

  it("rejeita foto que nao pertence a entrega", async () => {
    const { driver, deliveryId } = await setup();
    const response = await api(app, {
      method: "POST",
      url: `/api/delivery/${deliveryId}/confirm`,
      token: driver.token,
      payload: { recipientName: "Joao", proofPhotoRef: "delivery-proofs/outra-entrega/x.png" },
    });
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("PROOF_REQUIRED");
  });

  it("confirma com prova, servidor grava timestamp/recebedor e atualiza o pedido", async () => {
    const { driver, pedido, deliveryId } = await setup();
    const uploaded = await uploadProof(deliveryId, driver.token, pngBuffer());
    expect(uploaded.status).toBe(201);
    const ref = uploaded.body?.data?.proofPhotoRef as string;

    const response = await api(app, {
      method: "POST",
      url: `/api/delivery/${deliveryId}/confirm`,
      token: driver.token,
      payload: {
        recipientName: "Joao da Silva",
        notes: "Recebido pelo porteiro",
        proofPhotoRef: ref,
        latitude: -22.1,
        longitude: -47.1,
        locationAccuracy: 8,
        // Campos que devem ser IGNORADOS (nunca confiar no frontend):
        status: "FAILED",
        deliveredAt: "2000-01-01T00:00:00.000Z",
        driverId: "outro",
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const result = response.body.data as { status: string; recipientName: string; deliveredAt: string };
    expect(result.status).toBe("DELIVERED");
    expect(result.recipientName).toBe("Joao da Silva");

    const prisma = await db();
    const row = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(row.status).toBe("DELIVERED");
    expect(row.deliveredAt).not.toBeNull();
    expect(row.deliveredAt!.getFullYear()).toBeGreaterThan(2020); // timestamp do servidor, nao do payload
    const updatedPedido = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    expect(updatedPedido.statusAtual).toBe("Entregue");
    expect(updatedPedido.recebidoPor).toBe("Joao da Silva");
    expect(updatedPedido.dataEntrega).not.toBeNull();
  });

  it("confirmacao e idempotente (dois cliques nao duplicam evento)", async () => {
    const { driver, deliveryId } = await setup();
    const ref = (await uploadProof(deliveryId, driver.token, pngBuffer())).body?.data?.proofPhotoRef as string;
    const payload = { recipientName: "Maria", proofPhotoRef: ref };

    const first = await api(app, { method: "POST", url: `/api/delivery/${deliveryId}/confirm`, token: driver.token, payload });
    const second = await api(app, { method: "POST", url: `/api/delivery/${deliveryId}/confirm`, token: driver.token, payload });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const prisma = await db();
    const deliveredEvents = await prisma.deliveryEvent.count({ where: { deliveryId, status: "DELIVERED" } });
    expect(deliveredEvents).toBe(1);
  });

  it("bloqueia reenvio de foto por outro entregador", async () => {
    const { deliveryId } = await setup();
    const other = await makeDriver();
    const response = await uploadProof(deliveryId, other.token, pngBuffer());
    expect(response.status).toBe(403);
  });

  it("rejeita arquivo que nao e imagem", async () => {
    const { driver, deliveryId } = await setup();
    const response = await uploadProof(deliveryId, driver.token, new TextEncoder().encode("nao sou imagem"));
    expect(response.status).toBe(422);
  });
});

describe("entrega — nao entrega", () => {
  it("exige motivo", async () => {
    const driver = await makeDriver();
    const pedido = await makePedido();
    const deliveryId = ((await assign(pedido.id, driver.id)).body.data as { delivery: { id: string } }).delivery.id;
    await api(app, { method: "POST", url: `/api/delivery/${deliveryId}/start`, token: driver.token, payload: {} });

    const response = await api(app, {
      method: "POST",
      url: `/api/delivery/${deliveryId}/fail`,
      token: driver.token,
      payload: { reason: "INVALIDO" },
    });
    expect(response.status).toBe(422);
  });

  it("OUTRO exige descricao", async () => {
    const driver = await makeDriver();
    const pedido = await makePedido();
    const deliveryId = ((await assign(pedido.id, driver.id)).body.data as { delivery: { id: string } }).delivery.id;

    const response = await api(app, {
      method: "POST",
      url: `/api/delivery/${deliveryId}/fail`,
      token: driver.token,
      payload: { reason: "OUTRO" },
    });
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("FAILURE_REASON_REQUIRED");
  });

  it("marca como nao entregue, cria evento e devolve o pedido ao fluxo administrativo", async () => {
    const driver = await makeDriver();
    const pedido = await makePedido();
    const deliveryId = ((await assign(pedido.id, driver.id)).body.data as { delivery: { id: string } }).delivery.id;

    const response = await api(app, {
      method: "POST",
      url: `/api/delivery/${deliveryId}/fail`,
      token: driver.token,
      payload: { reason: "CLIENTE_AUSENTE", notes: "Tentativa as 14:35" },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((response.body.data as { status: string }).status).toBe("FAILED");

    const prisma = await db();
    const events = await prisma.deliveryEvent.findMany({ where: { deliveryId, status: "FAILED" } });
    expect(events).toHaveLength(1);
    const updated = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    expect(updated.statusAtual).toBe("Pronto para Envio");
  });

  it("nao permite editar entrega ja entregue", async () => {
    const driver = await makeDriver();
    const pedido = await makePedido();
    const deliveryId = ((await assign(pedido.id, driver.id)).body.data as { delivery: { id: string } }).delivery.id;
    await api(app, { method: "POST", url: `/api/delivery/${deliveryId}/start`, token: driver.token, payload: {} });
    const ref = (await uploadProof(deliveryId, driver.token, pngBuffer())).body?.data?.proofPhotoRef as string;
    await api(app, { method: "POST", url: `/api/delivery/${deliveryId}/confirm`, token: driver.token, payload: { recipientName: "Ana", proofPhotoRef: ref } });

    const fail = await api(app, {
      method: "POST",
      url: `/api/delivery/${deliveryId}/fail`,
      token: driver.token,
      payload: { reason: "CLIENTE_AUSENTE" },
    });
    expect(fail.status).toBe(409);
    expect(fail.body.error?.code).toBe("DELIVERY_ALREADY_COMPLETED");
  });
});

describe("entrega — relatorio por entregador", () => {
  it("agrega concluidas, falhas e em andamento por entregador", async () => {
    const ana = await makeDriver({ name: "Ana Entregadora" });
    const beto = await makeDriver({ name: "Beto Entregador" });
    const p1 = await makePedido();
    const p2 = await makePedido();
    const p3 = await makePedido();

    const del1 = ((await assign(p1.id, ana.id)).body.data as { delivery: { id: string } }).delivery.id;
    const del2 = ((await assign(p2.id, ana.id)).body.data as { delivery: { id: string } }).delivery.id;
    const del3 = ((await assign(p3.id, beto.id)).body.data as { delivery: { id: string } }).delivery.id;

    const prisma = await db();
    await prisma.delivery.update({ where: { id: del1 }, data: { status: "DELIVERED", deliveredAt: new Date(), recipientName: "Ana Maria" } });
    await prisma.delivery.update({ where: { id: del2 }, data: { status: "FAILED", failureReason: "CLIENTE_AUSENTE" } });
    void del3; // permanece ASSIGNED (em andamento)

    const response = await api(app, { method: "GET", url: "/api/admin/delivery/report", token: admin.token });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const data = response.body.data as { rows: Array<Record<string, number | string>> };

    const anaRow = data.rows.find((row) => row.driverId === ana.id);
    expect(anaRow?.delivered).toBe(1);
    expect(anaRow?.failed).toBe(1);
    expect(anaRow?.total).toBe(2);
    expect(anaRow?.successRate).toBe(50);

    const betoRow = data.rows.find((row) => row.driverId === beto.id);
    expect(betoRow?.inProgress).toBe(1);
    expect(betoRow?.delivered).toBe(0);
  });

  it("respeita o periodo informado", async () => {
    const driver = await makeDriver();
    const pedido = await makePedido();
    await assign(pedido.id, driver.id);

    const prisma = await db();
    const delivery = await prisma.delivery.findFirstOrThrow({ where: { driverId: driver.id } });
    await prisma.delivery.update({ where: { id: delivery.id }, data: { createdAt: new Date("2000-01-01T00:00:00") } });

    const response = await api(app, {
      method: "GET",
      url: "/api/admin/delivery/report?from=2025-01-01&to=2030-01-01",
      token: admin.token,
    });
    expect(response.status).toBe(200);
    const rows = (response.body.data as { rows: Array<{ driverId: string }> }).rows;
    expect(rows.find((row) => row.driverId === driver.id)).toBeUndefined();
  });

  it("entregador nao acessa o relatorio (RBAC)", async () => {
    const driver = await makeDriver();
    const response = await api(app, { method: "GET", url: "/api/admin/delivery/report", token: driver.token });
    expect(response.status).toBe(403);
  });
});

describe("entrega — prova privada", () => {
  it("admin e o entregador responsavel acessam a prova; outro nao", async () => {
    const driver = await makeDriver();
    const other = await makeDriver();
    const pedido = await makePedido();
    const deliveryId = ((await assign(pedido.id, driver.id)).body.data as { delivery: { id: string } }).delivery.id;
    await api(app, { method: "POST", url: `/api/delivery/${deliveryId}/start`, token: driver.token, payload: {} });
    const ref = (await uploadProof(deliveryId, driver.token, pngBuffer())).body?.data?.proofPhotoRef as string;
    await api(app, { method: "POST", url: `/api/delivery/${deliveryId}/confirm`, token: driver.token, payload: { recipientName: "Ana", proofPhotoRef: ref } });

    const owner = await api(app, { method: "GET", url: `/api/delivery/${deliveryId}/proof`, token: driver.token });
    expect(owner.status).toBe(200);
    expect(owner.headers["content-type"]).toContain("image/png");

    const adminView = await api(app, { method: "GET", url: `/api/admin/delivery/${deliveryId}/proof`, token: admin.token });
    expect(adminView.status).toBe(200);

    const stranger = await api(app, { method: "GET", url: `/api/delivery/${deliveryId}/proof`, token: other.token });
    expect(stranger.status).toBe(403);
  });
});
