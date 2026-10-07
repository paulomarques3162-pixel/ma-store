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

export const ADDRESS = {
  cep: "01310100",
  street: "Avenida de Teste",
  number: "100",
  district: "Bela Vista",
  city: "Sao Paulo",
  state: "SP",
};
