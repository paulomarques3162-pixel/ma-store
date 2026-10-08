import type { FastifyInstance } from "fastify";

/** Cria a aplicacao com logger desligado (testes limpos). */
export async function makeApp(): Promise<FastifyInstance> {
  const { buildApp } = await import("../src/app.js");
  // TEST_VERBOSE=1 habilita o log do Pino para depurar falhas na suite.
  return buildApp({ logger: process.env.TEST_VERBOSE === "1" });
}

/** Cliente Prisma do processo de teste (o mesmo usado pela app). */
export async function db() {
  const { prisma } = await import("../src/db.js");
  return prisma;
}

/** Limpa TODAS as tabelas do schema public (isolamento entre arquivos). */
export async function resetDatabase(): Promise<void> {
  const prisma = await db();
  // `_prisma_migrations` NUNCA entra na limpeza: apagar o historico faria o
  // Prisma tentar reaplicar todas as migrations em um banco ja migrado.
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
       AND table_name <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.table_name}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

type ApiOptions = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  token?: string;
  payload?: unknown;
  headers?: Record<string, string>;
};

export type ApiResult = {
  status: number;
  body: { data?: unknown; meta?: unknown; error?: { code: string; message: string; requestId: string; details?: unknown } };
  headers: Record<string, unknown>;
};

/** Atalho para chamar a API via `app.inject` (sem abrir porta de rede). */
export async function api(app: FastifyInstance, options: ApiOptions): Promise<ApiResult> {
  const response = await app.inject({
    method: options.method,
    url: options.url,
    payload: options.payload as never,
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.payload !== undefined ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });

  let body: ApiResult["body"] = {};
  try {
    body = response.body ? JSON.parse(response.body) : {};
  } catch {
    body = { error: { code: "PARSE", message: response.body, requestId: "" } };
  }

  return { status: response.statusCode, body, headers: response.headers as Record<string, unknown> };
}

/** Registra um cliente novo e devolve tokens + dados. */
export async function createClient(
  app: FastifyInstance,
  overrides: { name?: string; email?: string; password?: string; phone?: string } = {},
) {
  const email = overrides.email ?? `cliente-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@teste.local`;
  const password = overrides.password ?? "Cliente@123";

  const response = await api(app, {
    method: "POST",
    url: "/api/auth/register",
    payload: {
      name: overrides.name ?? "Cliente de Teste",
      email,
      phone: overrides.phone,
      password,
      confirmPassword: password,
      acceptTerms: true,
    },
  });

  if (response.status !== 201) {
    throw new Error(`Falha ao criar cliente: ${response.status} ${JSON.stringify(response.body)}`);
  }

  const data = response.body.data as { accessToken: string; refreshToken: string; user: { id: string; email: string } };
  return { email, password, ...data };
}

/** Cria um administrador direto no banco e devolve o token. */
export async function createAdmin(app: FastifyInstance, emailPrefix = "admin") {
  const prisma = await db();
  const { hashPassword } = await import("../src/lib/password.js");

  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}@teste.local`;
  const password = "Admin@12345";

  await prisma.user.create({
    data: {
      name: "Administrador de Teste",
      email,
      passwordHash: await hashPassword(password),
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  const login = await api(app, { method: "POST", url: "/api/auth/login", payload: { email, password } });
  const data = login.body.data as { accessToken: string; user: { id: string } };
  return { email, password, token: data.accessToken, id: data.user.id };
}

/** Cria categoria + produto + modalidade de frete para os testes de compra. */
export async function createShopFixture(options: { stock?: number; price?: string } = {}) {
  const prisma = await db();

  const category = await prisma.category.create({
    data: { name: "Categoria de Teste", slug: `cat-${Date.now()}`, active: true },
  });

  const product = await prisma.product.create({
    data: {
      name: "Perfume de Teste 100ml",
      slug: `produto-${Date.now()}`,
      sku: `SKU-${Date.now()}`,
      price: options.price ?? "100.00",
      comparePrice: "150.00",
      stock: options.stock ?? 10,
      minStock: 1,
      volume: "100ml",
      categoryId: category.id,
      active: true,
    },
  });

  const shipping = await prisma.shippingMethod.findFirst({ where: { active: true } })
    ?? (await prisma.shippingMethod.create({
        data: { name: "Entrega de Teste", price: "20.00", minDays: 2, maxDays: 6, active: true, regions: [] },
      }));

  return { category, product, shipping };
}

/**
 * Configura o motor de frete PROPRIO (v2) para testes de checkout Guest.
 * Cria admin + settings + zona + modalidade + regra e devolve os ids.
 */
export async function enableLocalShippingForGuest(app: FastifyInstance) {
  const admin = await createAdmin(app, "ship-admin");

  const settings = await api(app, {
    method: "PUT",
    url: "/api/admin/shipping/settings",
    token: admin.token,
    payload: {
      enabled: true,
      originZipCode: "13610000",
      packagePaddingGrams: 100,
      defaultHandlingDays: 1,
      defaultDeliveryDays: 5,
      freeShippingEnabled: false,
      showEstimateDisclaimer: true,
    },
  });
  if (settings.status !== 200) {
    throw new Error(`Falha ao configurar frete: ${settings.status} ${JSON.stringify(settings.body)}`);
  }

  const zone = await api(app, {
    method: "POST",
    url: "/api/admin/shipping/zones",
    token: admin.token,
    payload: {
      name: "Zona de Teste",
      state: "SP",
      zipCodeFrom: "13600000",
      zipCodeTo: "13699999",
      active: true,
      priority: 0,
    },
  });
  const zoneId = (zone.body.data as { id: string }).id;

  const method = await api(app, {
    method: "POST",
    url: "/api/admin/shipping/methods",
    token: admin.token,
    payload: { name: "Entrega de Teste", code: "STANDARD", description: "Entrega padrao", active: true, priority: 5 },
  });
  const methodId = (method.body.data as { id: string }).id;

  const rule = await api(app, {
    method: "POST",
    url: "/api/admin/shipping/rules",
    token: admin.token,
    payload: { zoneId, shippingMethodId: methodId, minWeightGrams: 0, maxWeightGrams: 5000, price: 20, deliveryDays: 4 },
  });
  if (rule.status !== 201) {
    throw new Error(`Falha ao criar regra de frete: ${rule.status} ${JSON.stringify(rule.body)}`);
  }

  return { admin, zoneId, methodId };
}

/** Cota o frete no motor proprio e devolve a primeira opcao + quoteId. */
export async function quoteGuestShipping(
  app: FastifyInstance,
  productId: string,
  quantity = 1,
  cep = "13630000",
) {
  const response = await api(app, {
    method: "POST",
    url: "/api/shipping/quote",
    payload: { cep, sessionId: "sess-guest", items: [{ productId, quantity }] },
  });
  if (response.status !== 200) {
    throw new Error(`Falha ao cotar frete: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const data = response.body.data as {
    quoteId: string;
    options: Array<{ methodId: string; code: string | null; name: string; price: number }>;
  };
  return { quoteId: data.quoteId, options: data.options, first: data.options[0]! };
}

export const ADDRESS = {
  cep: "01310100",
  street: "Avenida de Teste",
  number: "100",
  district: "Bela Vista",
  city: "Sao Paulo",
  state: "SP",
};
