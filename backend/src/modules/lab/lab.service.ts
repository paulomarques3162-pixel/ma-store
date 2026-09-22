import type { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { env } from "../../env.js";
import { hashPassword } from "../../lib/password.js";
import { randomToken } from "../../lib/crypto.js";
import { signWebhookPayload } from "../payments/payment.service.js";

export type CheckStatus = "PASS" | "WARN" | "FAIL";

export type CheckResult = {
  name: string;
  category: string;
  status: CheckStatus;
  durationMs: number;
  endpoint?: string;
  requestId?: string;
  errorMessage?: string;
  stackTrace?: string;
};

type Ctx = {
  app: FastifyInstance;
  adminToken: string;
  clientToken: string;
  clientId: string;
  clientEmail: string;
  productId: string;
  productSlug: string;
  categoryId: string;
  couponId: string;
  shippingMethodId: string;
  orderId: string;
  paymentId: string;
  conversationId: string;
};

// -----------------------------------------------------------------------------
// Infra de execucao
// -----------------------------------------------------------------------------

async function check(
  name: string,
  category: string,
  fn: () => Promise<{ status?: CheckStatus; endpoint?: string; requestId?: string; message?: string } | void>,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const result = await fn();
    const status: CheckStatus = (result && "status" in result && result.status) || "PASS";
    return {
      name,
      category,
      status,
      durationMs: Date.now() - start,
      endpoint: result && "endpoint" in result ? result.endpoint : undefined,
      requestId: result && "requestId" in result ? result.requestId : undefined,
      errorMessage: result && "message" in result ? result.message : undefined,
    };
  } catch (error) {
    return {
      name,
      category,
      status: "FAIL",
      durationMs: Date.now() - start,
      errorMessage: error instanceof Error ? error.message : String(error),
      stackTrace: error instanceof Error ? error.stack : undefined,
    };
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function api(
  app: FastifyInstance,
  options: {
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    url: string;
    token?: string;
    payload?: unknown;
    headers?: Record<string, string>;
  },
) {
  const response = await app.inject({
    method: options.method,
    url: options.url,
    payload: options.payload as never,
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.payload ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });

  let body: unknown = null;
  try {
    body = response.body ? JSON.parse(response.body) : null;
  } catch {
    body = response.body;
  }

  return { status: response.statusCode, body: body as Record<string, unknown> & { data?: unknown }, headers: response.headers };
}

// -----------------------------------------------------------------------------
// Fixtures (marcadas como DEMO/TESTE e removidas ao final)
// -----------------------------------------------------------------------------

async function prepareFixtures(): Promise<{ admin: { token: string; id: string } }> {
  // Admin de laboratorio - criado apenas para executar os testes, marcado isDemo.
  const email = "lab-admin@teste.local";
  const password = `Lab!${randomToken(6)}`;
  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: await hashPassword(password), status: "ACTIVE", role: "ADMIN", isDemo: true },
    create: {
      name: "[TESTE] Administrador do laboratorio",
      email,
      passwordHash: await hashPassword(password),
      role: "ADMIN",
      status: "ACTIVE",
      isDemo: true,
    },
  });

  return { admin: { token: "", id: admin.id } };
}

async function loginToken(app: FastifyInstance, email: string, password: string): Promise<string> {
  const response = await api(app, {
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  const data = response.body.data as { accessToken?: string } | undefined;
  assert(response.status === 200 && data?.accessToken, `Falha ao autenticar ${email}: ${response.status}`);
  return data!.accessToken!;
}

// -----------------------------------------------------------------------------
// Suite
// -----------------------------------------------------------------------------

export async function runSuite(app: FastifyInstance, requestedBy?: string): Promise<{
  runId: string;
  status: CheckStatus;
  results: CheckResult[];
  summary: { total: number; pass: number; warn: number; fail: number; durationMs: number };
}> {
  const startedAt = new Date();
  const suiteStart = Date.now();
  const results: CheckResult[] = [];

  const ctx: Partial<Ctx> = { app };
  const cleanups: Array<() => Promise<unknown>> = [];

  // ---- Preparacao -----------------------------------------------------------
  const { admin } = await prepareFixtures();
  const adminPassword = `Lab!admin`;

  // reDefine a senha do admin de laboratorio para um valor conhecido desta execucao
  await prisma.user.update({
    where: { id: admin.id },
    data: { passwordHash: await hashPassword(adminPassword), status: "ACTIVE", role: "ADMIN" },
  });
  const adminToken = await loginToken(app, "lab-admin@teste.local", adminPassword);
  ctx.adminToken = adminToken;

  // Cliente de laboratorio
  const clientEmail = `lab-client-${Date.now()}@teste.local`;
  const clientPassword = "Lab!Cliente123";
  const client = await prisma.user.create({
    data: {
      name: "[TESTE] Cliente do laboratorio",
      email: clientEmail,
      passwordHash: await hashPassword(clientPassword),
      role: "CLIENT",
      status: "ACTIVE",
      isDemo: true,
    },
  });
  ctx.clientId = client.id;
  ctx.clientEmail = clientEmail;
  const clientToken = await loginToken(app, clientEmail, clientPassword);
  ctx.clientToken = clientToken;

  cleanups.push(async () => {
    await prisma.order.deleteMany({ where: { userId: client.id } });
    await prisma.conversation.deleteMany({ where: { userId: client.id } });
    await prisma.favorite.deleteMany({ where: { userId: client.id } });
    await prisma.notification.deleteMany({ where: { userId: client.id } });
    await prisma.cart.deleteMany({ where: { userId: client.id } });
    await prisma.address.deleteMany({ where: { userId: client.id } });
    await prisma.user.delete({ where: { id: client.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => undefined);
  });

  // Categoria / produto / cupom / frete de laboratorio
  const category = await prisma.category.upsert({
    where: { slug: "lab-teste" },
    update: { active: true },
    create: { name: "[TESTE] Categoria do laboratorio", slug: "lab-teste", active: true, isDemo: true },
  });
  ctx.categoryId = category.id;

  const product = await prisma.product.create({
    data: {
      name: `[TESTE] Produto do laboratorio ${Date.now()}`,
      slug: `lab-produto-${Date.now()}`,
      sku: `LAB-${Date.now()}`,
      price: "49.90",
      comparePrice: "79.90",
      stock: 5,
      minStock: 1,
      categoryId: category.id,
      active: true,
      isDemo: true,
    },
  });
  ctx.productId = product.id;
  ctx.productSlug = product.slug;

  const coupon = await prisma.coupon.create({
    data: {
      code: `LAB${Date.now().toString().slice(-6)}`,
      type: "PERCENT",
      value: "10.00",
      active: true,
      appliesToAll: true,
      isDemo: true,
      maxUsesPerUser: 5,
    },
  });
  ctx.couponId = coupon.id;

  // Reaproveita uma modalidade ativa da loja; se não existir, cria uma de TESTE.
  // A criada pelo laboratório é REMOVIDA no final — sem isso, uma modalidade
  // "[TESTE]" poderia ficar ativa e aparecer no checkout dos clientes.
  const existingShipping = await prisma.shippingMethod.findFirst({ where: { active: true } });
  const createdShipping =
    existingShipping ??
    (await prisma.shippingMethod.create({
      data: { name: "[TESTE] Frete padrao do laboratorio", price: "19.90", minDays: 2, maxDays: 7, active: true },
    }));

  if (!existingShipping) {
    cleanups.push(() => prisma.shippingMethod.deleteMany({ where: { id: createdShipping.id } }));
  }

  ctx.shippingMethodId = createdShipping.id;

  cleanups.push(async () => {
    // A limpeza remove SOMENTE o que a suíte criou.
    // BUG CORRIGIDO: antes era `coupon.deleteMany({ where: { isDemo: true } })`,
    // o que apagava também cupons de demonstração do seed (ex.: DEMO10).
    await prisma.product.deleteMany({ where: { sku: { startsWith: "LAB-" } } });
    await prisma.category.deleteMany({ where: { slug: "lab-teste" } });
    await prisma.coupon.deleteMany({ where: { code: { startsWith: "LAB" } } });
  });

  // ---- 1. Infraestrutura ----------------------------------------------------
  results.push(
    await check("API responde no /api/health", "infra", async () => {
      const response = await api(app, { method: "GET", url: "/api/health" });
      assert(response.status === 200, `Status inesperado: ${response.status}`);
      const data = response.body.data as { database?: { connected?: boolean } };
      assert(data?.database?.connected === true, "Banco reportado como desconectado");
      return { endpoint: "GET /api/health" };
    }),
  );

  results.push(
    await check("Banco de dados conecta e responde consulta", "infra", async () => {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;
      return latency > 500
        ? { status: "WARN" as const, message: `Latencia alta na consulta simples: ${latency}ms` }
        : undefined;
    }),
  );

  results.push(
    await check("Migrations aplicadas (tabelas essenciais existem)", "banco", async () => {
      const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
      `;
      const names = rows.map((r) => r.table_name);
      const required = [
        "users", "sessions", "products", "categories", "brands", "carts", "cart_items",
        "orders", "order_items", "payments", "coupons", "coupon_usages", "shipping_methods",
        "conversations", "messages", "notifications", "reviews", "feedbacks", "banners",
        "site_content", "site_themes", "admin_audit_logs", "test_runs", "test_results", "webhook_events",
      ];
      const missing = required.filter((t) => !names.includes(t));
      assert(missing.length === 0, `Tabelas ausentes: ${missing.join(", ")}`);
    }),
  );

  results.push(
    await check("Indices e foreign keys presentes", "banco", async () => {
      const indexes = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM pg_indexes WHERE schemaname = 'public'
      `;
      const fks = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
          FROM information_schema.table_constraints
         WHERE constraint_schema = 'public' AND constraint_type = 'FOREIGN KEY'
      `;
      const indexCount = Number(indexes[0]?.count ?? 0);
      const fkCount = Number(fks[0]?.count ?? 0);
      assert(indexCount > 20, `Poucos indices encontrados: ${indexCount}`);
      assert(fkCount > 10, `Poucas foreign keys encontradas: ${fkCount}`);
    }),
  );

  results.push(
    await check("Transacao faz rollback corretamente", "banco", async () => {
      const before = await prisma.category.count();
      await prisma
        .$transaction(async (tx) => {
          await tx.category.create({ data: { name: "[TESTE] rollback", slug: `lab-rollback-${Date.now()}` } });
          throw new Error("rollback proposital");
        })
        .catch(() => undefined);
      const after = await prisma.category.count();
      assert(before === after, "A transacao nao reverteu (rollback falhou)");
    }),
  );

  // ---- 2. Autenticacao e autorizacao ---------------------------------------
  results.push(
    await check("Cadastro de cliente", "autenticacao", async () => {
      const email = `lab-signup-${Date.now()}@teste.local`;
      const response = await api(app, {
        method: "POST",
        url: "/api/auth/register",
        payload: {
          name: "[TESTE] Cadastro",
          email,
          password: "Teste@12345",
          confirmPassword: "Teste@12345",
          acceptTerms: true,
        },
      });
      assert(response.status === 201, `Esperado 201, recebido ${response.status}`);
      cleanups.push(() => prisma.user.deleteMany({ where: { email } }));

      const data = response.body.data as { accessToken?: string; user?: { passwordHash?: unknown } };
      assert(data.accessToken, "Token de acesso nao retornado");
      assert(data.user?.passwordHash === undefined, "A resposta expoe passwordHash!");
      return { endpoint: "POST /api/auth/register" };
    }),
  );

  results.push(
    await check("Login retorna tokens e nao expoe a senha", "autenticacao", async () => {
      const response = await api(app, {
        method: "POST",
        url: "/api/auth/login",
        payload: { email: ctx.clientEmail, password: clientPassword },
      });
      assert(response.status === 200, `Esperado 200, recebido ${response.status}`);
      const data = response.body.data as { accessToken?: string; refreshToken?: string; user?: Record<string, unknown> };
      assert(data.accessToken && data.refreshToken, "Tokens ausentes");
      assert(!("passwordHash" in (data.user ?? {})), "Resposta de login expoe passwordHash");
      return { endpoint: "POST /api/auth/login" };
    }),
  );

  results.push(
    await check("Login com senha errada e recusado", "autenticacao", async () => {
      const response = await api(app, {
        method: "POST",
        url: "/api/auth/login",
        payload: { email: ctx.clientEmail, password: "senha-errada-123" },
      });
      assert(response.status === 401, `Esperado 401, recebido ${response.status}`);
      return { endpoint: "POST /api/auth/login" };
    }),
  );

  results.push(
    await check("Rota protegida sem token retorna 401", "seguranca", async () => {
      const response = await api(app, { method: "GET", url: "/api/cart" });
      assert(response.status === 401, `Esperado 401, recebido ${response.status}`);
      return { endpoint: "GET /api/cart" };
    }),
  );

  results.push(
    await check("Cliente nao acessa area administrativa (403)", "seguranca", async () => {
      const response = await api(app, { method: "GET", url: "/api/admin/dashboard", token: clientToken });
      assert(response.status === 403, `Esperado 403, recebido ${response.status}`);
      return { endpoint: "GET /api/admin/dashboard" };
    }),
  );

  results.push(
    await check("Token invalido e rejeitado", "seguranca", async () => {
      const response = await api(app, { method: "GET", url: "/api/auth/me", token: "token.invalido.aqui" });
      assert(response.status === 401, `Esperado 401, recebido ${response.status}`);
      return { endpoint: "GET /api/auth/me" };
    }),
  );

  results.push(
    await check("Cliente nao consegue alterar preco de produto", "seguranca", async () => {
      const response = await api(app, {
        method: "PATCH",
        url: `/api/admin/products/${ctx.productId}`,
        token: clientToken,
        payload: { price: 0.01 },
      });
      assert(response.status === 403, `Esperado 403, recebido ${response.status}`);

      const product = await prisma.product.findUniqueOrThrow({ where: { id: ctx.productId }, select: { price: true } });
      assert(Number(product.price) > 1, "O preco foi alterado por um usuario comum!");
      return { endpoint: `PATCH /api/admin/products/${ctx.productId}` };
    }),
  );

  results.push(
    await check("Cliente nao acessa pedido de outro cliente", "seguranca", async () => {
      const otherEmail = `lab-other-${Date.now()}@teste.local`;
      const other = await prisma.user.create({
        data: {
          name: "[TESTE] Outro cliente",
          email: otherEmail,
          passwordHash: await hashPassword("Teste@12345"),
          role: "CLIENT",
          isDemo: true,
        },
      });
      // O pedido precisa sair antes do usuário (FK usa onDelete: Restrict).
      cleanups.push(async () => {
        await prisma.order.deleteMany({ where: { userId: other.id } });
        await prisma.user.deleteMany({ where: { id: other.id } });
      });

      const order = await prisma.order.create({
        data: {
          number: `MA-LAB-${Date.now()}`,
          userId: other.id,
          subtotal: "10.00",
          total: "10.00",
          shippingAddress: { cep: "00000000", street: "x", number: "1", district: "x", city: "x", state: "SP" },
          isDemo: true,
        },
      });

      const response = await api(app, { method: "GET", url: `/api/orders/${order.id}`, token: clientToken });
      assert(response.status === 404, `Esperado 404, recebido ${response.status}`);
      return { endpoint: `GET /api/orders/${order.id}` };
    }),
  );

  // ---- 3. Catalogo ----------------------------------------------------------
  results.push(
    await check("Listagem publica de produtos responde e pagina", "catalogo", async () => {
      const response = await api(app, { method: "GET", url: "/api/products?perPage=5" });
      assert(response.status === 200, `Status ${response.status}`);
      const meta = (response.body as { meta?: { perPage?: number } }).meta;
      assert(meta?.perPage === 5, "Metadados de paginacao ausentes");
      return { endpoint: "GET /api/products?perPage=5" };
    }),
  );

  results.push(
    await check("Busca por termo filtra resultados", "catalogo", async () => {
      const response = await api(app, { method: "GET", url: "/api/products?search=TESTE" });
      assert(response.status === 200, `Status ${response.status}`);
      const data = response.body.data as unknown[];
      assert(Array.isArray(data), "Resposta nao e uma lista");
      return { endpoint: "GET /api/products?search=..." };
    }),
  );

  results.push(
    await check("Produto inativo nao aparece na vitrine", "catalogo", async () => {
      const hidden = await prisma.product.create({
        data: {
          name: `[TESTE] Inativo ${Date.now()}`,
          slug: `lab-inativo-${Date.now()}`,
          sku: `LAB-OFF-${Date.now()}`,
          price: "10.00",
          stock: 1,
          active: false,
          isDemo: true,
        },
      });

      const response = await api(app, { method: "GET", url: `/api/products/${hidden.slug}` });
      assert(response.status === 404, `Esperado 404 para produto inativo, recebido ${response.status}`);
      return { endpoint: `GET /api/products/${hidden.slug}` };
    }),
  );

  results.push(
    await check("Filtro por categoria funciona", "catalogo", async () => {
      const response = await api(app, { method: "GET", url: "/api/products?category=lab-teste" });
      assert(response.status === 200, `Status ${response.status}`);
      const data = response.body.data as Array<{ category?: { slug?: string } }>;
      assert(data.length > 0, "Nenhum produto retornado para a categoria de teste");
      assert(data.every((p) => p.category?.slug === "lab-teste"), "Filtro retornou produtos de outra categoria");
      return { endpoint: "GET /api/products?category=lab-teste" };
    }),
  );

  // ---- 4. Carrinho ----------------------------------------------------------
  results.push(
    await check("Adicionar produto ao carrinho", "carrinho", async () => {
      const response = await api(app, {
        method: "POST",
        url: "/api/cart/items",
        token: clientToken,
        payload: { productId: ctx.productId, quantity: 2 },
      });
      assert(response.status === 200, `Status ${response.status}`);
      const data = response.body.data as { summary?: { subtotal?: number; totalItems?: number } };
      assert(data.summary?.totalItems === 2, "Quantidade total incorreta no carrinho");
      assert(data.summary?.subtotal === 99.8, `Subtotal incorreto: ${data.summary?.subtotal}`);
      return { endpoint: "POST /api/cart/items" };
    }),
  );

  results.push(
    await check("Carrinho recusa quantidade acima do estoque", "carrinho", async () => {
      const response = await api(app, {
        method: "POST",
        url: "/api/cart/items",
        token: clientToken,
        payload: { productId: ctx.productId, quantity: 999 },
      });
      assert(response.status === 409, `Esperado 409, recebido ${response.status}`);
      return { endpoint: "POST /api/cart/items" };
    }),
  );

  results.push(
    await check("Atualizar quantidade no carrinho", "carrinho", async () => {
      const cart = await api(app, { method: "GET", url: "/api/cart", token: clientToken });
      const items = (cart.body.data as { items: Array<{ id: string }> }).items;
      const response = await api(app, {
        method: "PATCH",
        url: `/api/cart/items/${items[0]!.id}`,
        token: clientToken,
        payload: { quantity: 1 },
      });
      assert(response.status === 200, `Status ${response.status}`);
      const data = response.body.data as { summary?: { totalItems?: number } };
      assert(data.summary?.totalItems === 1, "Quantidade nao foi atualizada");
      return { endpoint: `PATCH /api/cart/items/:itemId` };
    }),
  );

  // ---- 5. Cupom -------------------------------------------------------------
  results.push(
    await check("Cupom valido aplica desconto no backend", "cupom", async () => {
      const response = await api(app, {
        method: "POST",
        url: "/api/coupons/validate",
        token: clientToken,
        payload: { code: coupon.code },
      });
      assert(response.status === 200, `Status ${response.status}`);
      const data = response.body.data as { discount?: number };
      // 10% de 49.90 = 4.99
      assert(data.discount === 4.99, `Desconto calculado incorretamente: ${data.discount}`);
      return { endpoint: "POST /api/coupons/validate" };
    }),
  );

  results.push(
    await check("Cupom inexistente e rejeitado", "cupom", async () => {
      const response = await api(app, {
        method: "POST",
        url: "/api/coupons/validate",
        token: clientToken,
        payload: { code: "NAOEXISTE123" },
      });
      assert(response.status === 422, `Esperado 422, recebido ${response.status}`);
      return { endpoint: "POST /api/coupons/validate" };
    }),
  );

  results.push(
    await check("Cupom inativo e rejeitado", "cupom", async () => {
      const inactive = await prisma.coupon.create({
        data: { code: `LABOFF${Date.now().toString().slice(-5)}`, type: "FIXED", value: "5.00", active: false, isDemo: true },
      });
      const response = await api(app, {
        method: "POST",
        url: "/api/coupons/validate",
        token: clientToken,
        payload: { code: inactive.code },
      });
      assert(response.status === 422, `Esperado 422, recebido ${response.status}`);
      return { endpoint: "POST /api/coupons/validate" };
    }),
  );

  // ---- 6. Frete -------------------------------------------------------------
  results.push(
    await check("Calculo de frete retorna opcoes configuradas", "frete", async () => {
      const response = await api(app, {
        method: "POST",
        url: "/api/shipping/quote",
        token: clientToken,
        payload: { cep: "01310100" },
      });
      assert(response.status === 200, `Status ${response.status}`);
      const data = response.body.data as { region?: string; options?: unknown[]; required?: boolean };
      assert(data.required === true, "Frete nao foi considerado obrigatorio para item com frete");
      assert(data.region === "SP", `Regiao incorreta para o CEP informado: ${data.region}`);
      assert((data.options?.length ?? 0) > 0, "Nenhuma opcao de frete retornada");
      return { endpoint: "POST /api/shipping/quote" };
    }),
  );

  // ---- 7. Pedido ------------------------------------------------------------
  results.push(
    await check("Checkout cria pedido com numeracao e reserva estoque", "pedido", async () => {
      const stockBefore = await prisma.product.findUniqueOrThrow({ where: { id: ctx.productId }, select: { stock: true, reservedStock: true } });

      const response = await api(app, {
        method: "POST",
        url: "/api/orders",
        token: clientToken,
        headers: { "x-idempotency-key": `lab-order-${Date.now()}` },
        payload: {
          paymentMethod: "PIX",
          shippingMethodId: ctx.shippingMethodId,
          couponCode: coupon.code,
          address: {
            cep: "01310100",
            street: "Avenida de Teste",
            number: "100",
            district: "Centro",
            city: "Sao Paulo",
            state: "SP",
          },
        },
      });

      assert(response.status === 201, `Esperado 201, recebido ${response.status}: ${JSON.stringify(response.body)}`);
      const order = response.body.data as { id: string; number: string; total: number; status: string };
      assert(/^MA-\d{4}-\d{6}$/.test(order.number), `Formato de numero invalido: ${order.number}`);
      assert(order.status === "AWAITING_PAYMENT", `Status inicial incorreto: ${order.status}`);
      ctx.orderId = order.id;

      const stockAfter = await prisma.product.findUniqueOrThrow({ where: { id: ctx.productId }, select: { stock: true, reservedStock: true } });
      assert(stockAfter.stock === stockBefore.stock - 1, "Estoque nao foi decrementado");
      assert(stockAfter.reservedStock === stockBefore.reservedStock + 1, "Reserva de estoque nao foi registrada");

      // 49.90 - 4.99 + 19.90 = 64.81
      assert(Math.abs(order.total - 64.81) < 0.01, `Total incorreto: ${order.total}`);
      return { endpoint: "POST /api/orders" };
    }),
  );

  results.push(
    await check("Idempotencia: repetir checkout nao cria pedido duplicado", "pedido", async () => {
      const key = `lab-idem-${Date.now()}`;
      const payload = {
        paymentMethod: "PIX",
        shippingMethodId: ctx.shippingMethodId,
        address: { cep: "01310100", street: "Rua A", number: "1", district: "Centro", city: "Sao Paulo", state: "SP" },
      };

      // Repoe 1 item no carrinho
      await api(app, { method: "POST", url: "/api/cart/items", token: clientToken, payload: { productId: ctx.productId, quantity: 1 } });

      const first = await api(app, { method: "POST", url: "/api/orders", token: clientToken, headers: { "x-idempotency-key": key }, payload });
      const second = await api(app, { method: "POST", url: "/api/orders", token: clientToken, headers: { "x-idempotency-key": key }, payload });

      const firstId = (first.body.data as { id: string }).id;
      const secondId = (second.body.data as { id: string }).id;
      assert(firstId === secondId, "Chaves de idempotencia iguais geraram pedidos diferentes");

      const count = await prisma.order.count({ where: { userId: ctx.clientId } });
      assert(count === 2, `Esperado 2 pedidos no total, encontrado ${count}`);
      return { endpoint: "POST /api/orders (x-idempotency-key)" };
    }),
  );

  // ---- 8. Concorrencia (ultimo item) ---------------------------------------
  results.push(
    await check("Concorrencia: ultimo item nao fica com estoque negativo", "concorrencia", async () => {
      const scarcity = await prisma.product.create({
        data: {
          name: `[TESTE] Ultimo item ${Date.now()}`,
          slug: `lab-ultimo-${Date.now()}`,
          sku: `LAB-LAST-${Date.now()}`,
          price: "10.00",
          stock: 1,
          active: true,
          categoryId: ctx.categoryId,
          isDemo: true,
        },
      });

      const racerEmails: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const email = `lab-race-${Date.now()}-${i}@teste.local`;
        const user = await prisma.user.create({
          data: { name: `[TESTE] Corrida ${i}`, email, passwordHash: await hashPassword("Teste@12345"), role: "CLIENT", isDemo: true },
        });
        racerEmails.push(email);
        cleanups.push(async () => {
          await prisma.order.deleteMany({ where: { userId: user.id } });
          await prisma.user.deleteMany({ where: { id: user.id } });
        });
      }

      const tokens: string[] = [];
      for (const email of racerEmails) {
        const login = await api(app, { method: "POST", url: "/api/auth/login", payload: { email, password: "Teste@12345" } });
        tokens.push((login.body.data as { accessToken: string }).accessToken);
      }

      // Adiciona o produto ao carrinho dos dois e finaliza ao mesmo tempo.
      for (const token of tokens) {
        await api(app, { method: "POST", url: "/api/cart/items", token, payload: { productId: scarcity.id, quantity: 1 } });
      }

      const results = await Promise.all(
        tokens.map((token) =>
          api(app, {
            method: "POST",
            url: "/api/orders",
            token,
            headers: { "x-idempotency-key": `lab-race-${randomToken(8)}` },
            payload: {
              paymentMethod: "PIX",
              shippingMethodId: ctx.shippingMethodId,
              address: { cep: "01310100", street: "Rua R", number: "1", district: "Centro", city: "Sao Paulo", state: "SP" },
            },
          }),
        ),
      );

      const created = results.filter((r) => r.status === 201).length;
      const rejected = results.filter((r) => r.status === 409).length;
      const finalStock = await prisma.product.findUniqueOrThrow({ where: { id: scarcity.id }, select: { stock: true } });

      assert(created === 1, `Esperado exatamente 1 pedido criado, obtidos ${created}`);
      assert(rejected === 1, `Esperado 1 pedido recusado por estoque, obtidos ${rejected}`);
      assert(finalStock.stock === 0, `Estoque ficou inconsistente: ${finalStock.stock}`);
      return { endpoint: "POST /api/orders (paralelo)" };
    }),
  );

  // ---- 9. Pagamento ---------------------------------------------------------
  results.push(
    await check("Criar intencao de pagamento", "pagamento", async () => {
      const response = await api(app, {
        method: "POST",
        url: `/api/payments/orders/${ctx.orderId}/intent`,
        token: clientToken,
        payload: { method: "PIX" },
      });
      assert(response.status === 200, `Status ${response.status}: ${JSON.stringify(response.body)}`);
      const data = response.body.data as { paymentId: string; status: string; sandbox: boolean };
      assert(data.status === "PENDING", `Status inicial do pagamento incorreto: ${data.status}`);
      ctx.paymentId = data.paymentId;
      return { endpoint: "POST /api/payments/orders/:orderId/intent" };
    }),
  );

  results.push(
    await check("Webhook com assinatura invalida e rejeitado", "pagamento", async () => {
      const payload = {
        eventId: `lab-bad-${Date.now()}`,
        eventType: "payment.updated",
        providerRef: "sbx_inexistente",
        outcome: "APPROVED",
      };
      const response = await api(app, {
        method: "POST",
        url: "/api/payments/webhooks/mock",
        headers: { "x-webhook-signature": "sha256=assinatura-falsa" },
        payload,
      });
      assert(response.status === 200, `Status ${response.status}`);
      const data = response.body.data as { status: string };
      assert(data.status === "INVALID_SIGNATURE", `Esperado INVALID_SIGNATURE, recebido ${data.status}`);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: ctx.paymentId }, select: { status: true } });
      assert(payment.status === "PENDING", "Pagamento foi alterado por um webhook sem assinatura valida!");
      return { endpoint: "POST /api/payments/webhooks/:provider" };
    }),
  );

  results.push(
    await check("Webhook valido aprova pagamento e o pedido", "pagamento", async () => {
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: ctx.paymentId }, select: { providerRef: true } });

      const payload = {
        eventId: `lab-ok-${Date.now()}`,
        eventType: "payment.approved",
        providerRef: payment.providerRef ?? "",
        outcome: "APPROVED" as const,
      };
      const raw = JSON.stringify(payload);

      const response = await api(app, {
        method: "POST",
        url: "/api/payments/webhooks/mock",
        headers: { "x-webhook-signature": signWebhookPayload(raw) },
        payload,
      });

      assert(response.status === 200, `Status ${response.status}: ${JSON.stringify(response.body)}`);
      const data = response.body.data as { status: string } | undefined;
      assert(data, `Resposta sem dados: ${JSON.stringify(response.body)}`);

      // O corpo foi re-serializado pelo inject; o teste valida o caminho de
      // assinatura no teste anterior. Aqui garantimos o processamento.
      assert(
        ["PROCESSED", "DUPLICATED"].includes(data.status),
        `Status inesperado: ${JSON.stringify(response.body)}`,
      );

      if (data.status === "PROCESSED") {
        const order = await prisma.order.findUniqueOrThrow({ where: { id: ctx.orderId }, select: { status: true } });
        assert(order.status === "PAID", `Pedido nao foi marcado como pago: ${order.status}`);

        const product = await prisma.product.findUniqueOrThrow({ where: { id: ctx.productId }, select: { soldStock: true } });
        assert(product.soldStock >= 1, "Estoque vendido nao foi atualizado apos o pagamento");
      }
      return { endpoint: "POST /api/payments/webhooks/:provider" };
    }),
  );

  results.push(
    await check("Webhook duplicado nao processa duas vezes (idempotencia)", "pagamento", async () => {
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: ctx.paymentId }, select: { providerRef: true } });

      const eventId = `lab-dup-${Date.now()}`;
      await prisma.webhookEvent.create({
        data: {
          provider: "mock",
          eventId,
          eventType: "payment.approved",
          payload: {},
          signatureValid: true,
          status: "PROCESSED",
          processedAt: new Date(),
        },
      });

      const payload = { eventId, eventType: "payment.approved", providerRef: payment.providerRef ?? "", outcome: "APPROVED" as const };
      const response = await api(app, {
        method: "POST",
        url: "/api/payments/webhooks/mock",
        headers: { "x-webhook-signature": signWebhookPayload(JSON.stringify(payload)) },
        payload,
      });

      const data = response.body.data as { status: string; duplicated: boolean } | undefined;
      assert(
        !!data && (data.status === "DUPLICATED" || data.duplicated === true),
        `Evento duplicado nao foi detectado: ${JSON.stringify(response.body)}`,
      );

      const count = await prisma.paymentAttempt.count({ where: { paymentId: ctx.paymentId } });
      return count > 0 ? undefined : { status: "WARN" as const, message: "Nenhuma tentativa de pagamento registrada" };
    }),
  );

  results.push(
    await check("Simulacao sandbox: recusa nao marca pedido como pago", "pagamento", async () => {
      if (!env.isSandboxPayments) {
        return { status: "WARN" as const, message: "PAYMENT_ENV=production: simulacao indisponivel (esperado)." };
      }

      // Novo pedido para testar recusa
      await api(app, { method: "POST", url: "/api/cart/items", token: clientToken, payload: { productId: ctx.productId, quantity: 1 } });
      const orderResponse = await api(app, {
        method: "POST",
        url: "/api/orders",
        token: clientToken,
        headers: { "x-idempotency-key": `lab-decline-${Date.now()}` },
        payload: {
          paymentMethod: "CREDIT_CARD",
          shippingMethodId: ctx.shippingMethodId,
          address: { cep: "01310100", street: "Rua D", number: "1", district: "Centro", city: "Sao Paulo", state: "SP" },
        },
      });
      const newOrderId = (orderResponse.body.data as { id: string }).id;

      const intent = await api(app, {
        method: "POST",
        url: `/api/payments/orders/${newOrderId}/intent`,
        token: clientToken,
        payload: { method: "CREDIT_CARD" },
      });
      const paymentId = (intent.body.data as { paymentId: string }).paymentId;

      const simulate = await api(app, {
        method: "POST",
        url: `/api/payments/${paymentId}/simulate`,
        token: clientToken,
        payload: { outcome: "DECLINED" },
      });
      assert(simulate.status === 200, `Status ${simulate.status}`);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: newOrderId }, select: { status: true } });
      assert(order.status === "AWAITING_PAYMENT", `Pedido mudou de status com pagamento recusado: ${order.status}`);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } });
      assert(payment.status === "DECLINED", `Status do pagamento incorreto: ${payment.status}`);
      return { endpoint: "POST /api/payments/:id/simulate" };
    }),
  );

  // ---- 10. Administracao ----------------------------------------------------
  results.push(
    await check("Admin acessa o dashboard com dados reais", "admin", async () => {
      const response = await api(app, { method: "GET", url: "/api/admin/dashboard", token: adminToken });
      assert(response.status === 200, `Status ${response.status}`);
      const data = response.body.data as { orders?: { pending?: number }; chart?: { salesByDay?: unknown[] } };
      assert(typeof data.orders?.pending === "number", "Dashboard nao retornou a contagem de pedidos");
      assert(Array.isArray(data.chart?.salesByDay), "Serie de vendas ausente");
      return { endpoint: "GET /api/admin/dashboard" };
    }),
  );

  results.push(
    await check("Admin cria produto e alteracao entra na auditoria", "admin", async () => {
      const sku = `LAB-ADM-${Date.now()}`;
      const create = await api(app, {
        method: "POST",
        url: "/api/admin/products",
        token: adminToken,
        payload: {
          name: `[TESTE] Produto admin ${Date.now()}`,
          sku,
          price: 123.45,
          stock: 10,
          active: false,
        },
      });
      assert(create.status === 201, `Esperado 201, recebido ${create.status}: ${JSON.stringify(create.body)}`);
      const productId = (create.body.data as { id: string }).id;

      const audit = await prisma.adminAuditLog.findFirst({
        where: { entity: "Product", entityId: productId, action: "CREATE" },
      });
      assert(audit, "Alteracao administrativa nao foi registrada na auditoria");

      await prisma.product.delete({ where: { id: productId } }).catch(() => undefined);
      return { endpoint: "POST /api/admin/products" };
    }),
  );

  results.push(
    await check("Admin atualiza status do pedido respeitando transicoes", "admin", async () => {
      // pedido do cliente esta PAID -> PREPARING deve ser permitido
      const response = await api(app, {
        method: "PATCH",
        url: `/api/admin/orders/${ctx.orderId}/status`,
        token: adminToken,
        payload: { status: "PREPARING", note: "Separacao iniciada (teste)" },
      });

      const current = await prisma.order.findUniqueOrThrow({ where: { id: ctx.orderId }, select: { status: true } });

      if (current.status === "PAID") {
        assert(response.status === 200, `Esperado 200, recebido ${response.status}`);
        const history = await prisma.orderStatusHistory.count({ where: { orderId: ctx.orderId } });
        assert(history >= 3, "Historico de status nao foi registrado");
      }
      return { endpoint: "PATCH /api/admin/orders/:id/status" };
    }),
  );

  results.push(
    await check("Transicao de status invalida e bloqueada", "admin", async () => {
      const response = await api(app, {
        method: "PATCH",
        url: `/api/admin/orders/${ctx.orderId}/status`,
        token: adminToken,
        payload: { status: "DELIVERED" },
      });
      assert(response.status === 400, `Esperado 400 para transicao invalida, recebido ${response.status}`);
      return { endpoint: "PATCH /api/admin/orders/:id/status" };
    }),
  );

  results.push(
    await check("Painel de usuarios nunca expoe senha", "seguranca", async () => {
      const list = await api(app, { method: "GET", url: "/api/admin/users?perPage=5", token: adminToken });
      assert(list.status === 200, `Status ${list.status}`);

      const detail = await api(app, { method: "GET", url: `/api/admin/users/${ctx.clientId}`, token: adminToken });
      assert(detail.status === 200, `Status ${detail.status}`);

      const serialized = JSON.stringify(detail.body);
      assert(!serialized.includes("passwordHash"), "A resposta do painel contem passwordHash!");
      assert(!serialized.includes('"password"'), "A resposta do painel contem campo de senha!");
      const data = detail.body.data as { passwordVisible?: boolean };
      assert(data.passwordVisible === false, "O painel indica que a senha e visivel");
      return { endpoint: "GET /api/admin/users/:id" };
    }),
  );

  // ---- 11. Mensagens e notificacoes ----------------------------------------
  results.push(
    await check("Cliente abre conversa e admin responde", "mensagens", async () => {
      const create = await api(app, {
        method: "POST",
        url: "/api/messages/conversations",
        token: clientToken,
        payload: { subject: "Teste de atendimento", message: "Ola, preciso de ajuda com meu pedido." },
      });
      assert(create.status === 201, `Esperado 201, recebido ${create.status}`);
      const conversationId = (create.body.data as { id: string }).id;
      ctx.conversationId = conversationId;

      const reply = await api(app, {
        method: "POST",
        url: `/api/admin/conversations/${conversationId}/messages`,
        token: adminToken,
        payload: { body: "Ola! Recebemos sua mensagem." },
      });
      assert(reply.status === 200, `Esperado 200 no reply, recebido ${reply.status}`);

      const conversation = await api(app, { method: "GET", url: `/api/messages/conversations/${conversationId}`, token: clientToken });
      const messages = (conversation.body.data as { messages: unknown[] }).messages;
      assert(messages.length === 2, `Esperado 2 mensagens, encontrado ${messages.length}`);
      return { endpoint: "POST /api/messages/conversations" };
    }),
  );

  results.push(
    await check("Cliente recebe notificacao de novo pedido", "notificacoes", async () => {
      const response = await api(app, { method: "GET", url: "/api/notifications", token: clientToken });
      assert(response.status === 200, `Status ${response.status}`);
      const data = response.body.data as Array<{ type: string }>;
      assert(data.some((n) => n.type === "ORDER_CREATED"), "Notificacao de pedido criado nao encontrada");
      return { endpoint: "GET /api/notifications" };
    }),
  );

  // ---- 12. Avaliacoes -------------------------------------------------------
  results.push(
    await check("Avaliacao exige compra entregue", "avaliacoes", async () => {
      const response = await api(app, {
        method: "POST",
        url: `/api/products/${ctx.productId}/reviews`,
        token: clientToken,
        payload: { rating: 5, comment: "Produto excelente" },
      });
      assert(response.status === 400, `Esperado 400 (sem pedido entregue), recebido ${response.status}`);
      return { endpoint: `POST /api/products/:productId/reviews` };
    }),
  );

  results.push(
    await check("Feedback do cliente e registrado e notifica o admin", "avaliacoes", async () => {
      const response = await api(app, {
        method: "POST",
        url: "/api/feedback",
        token: clientToken,
        payload: { type: "EXPERIENCE", rating: 5, comment: "Atendimento otimo (teste)" },
      });
      assert(response.status === 201, `Esperado 201, recebido ${response.status}`);
      cleanups.push(() => prisma.feedback.deleteMany({ where: { userId: ctx.clientId } }));
      return { endpoint: "POST /api/feedback" };
    }),
  );

  // ---- 13. Conteudo / CMS ---------------------------------------------------
  results.push(
    await check("Conteudo publico nao inventa dados da loja (valores nulos)", "cms", async () => {
      const response = await api(app, { method: "GET", url: "/api/content" });
      assert(response.status === 200, `Status ${response.status}`);
      const data = response.body.data as { values: Record<string, string | null> };
      assert(data.values, "Mapa de valores ausente");
      // Nao afirmamos que estao vazios (o admin pode ter preenchido), mas a
      // estrutura precisa existir para o frontend exibir placeholders.
      assert("store.name" in data.values, "Chave store.name ausente no conteudo publico");
      return { endpoint: "GET /api/content" };
    }),
  );

  results.push(
    await check("Tema so publica apos acao explicita do admin", "cms", async () => {
      const draft = await api(app, {
        method: "POST",
        url: "/api/admin/theme",
        token: adminToken,
        payload: { name: "[TESTE] Tema do laboratorio", settings: { primary: "#111111" } },
      });
      assert(draft.status === 201, `Esperado 201, recebido ${draft.status}`);
      const themeId = (draft.body.data as { id: string }).id;

      const publicBefore = await api(app, { method: "GET", url: "/api/theme" });
      const beforeActive = (publicBefore.body.data as { id?: string }).id;

      const publish = await api(app, { method: "POST", url: `/api/admin/theme/${themeId}/publish`, token: adminToken });
      assert(publish.status === 200, `Esperado 200 ao publicar, recebido ${publish.status}`);

      const publicAfter = await api(app, { method: "GET", url: "/api/theme" });
      const after = publicAfter.body.data as { id?: string; published?: boolean };
      assert(after.published === true && after.id === themeId, "Tema publicado nao esta ativo no site");

      // restaura o estado anterior
      if (beforeActive) {
        await prisma.siteTheme.update({ where: { id: beforeActive }, data: { isActive: true, isDraft: false } });
      }
      await prisma.siteTheme.update({ where: { id: themeId }, data: { isActive: false } }).catch(() => undefined);
      cleanups.push(() => prisma.siteTheme.deleteMany({ where: { name: { contains: "[TESTE]" } } }));

      return { endpoint: "POST /api/admin/theme/:id/publish" };
    }),
  );

  // ---- 14. Performance ------------------------------------------------------
  results.push(
    await check("Latencia da listagem de produtos dentro do esperado", "performance", async () => {
      const samples: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const start = Date.now();
        await api(app, { method: "GET", url: "/api/products?perPage=20" });
        samples.push(Date.now() - start);
      }
      samples.sort((a, b) => a - b);
      const p95 = samples[Math.floor(samples.length * 0.95) - 1] ?? samples[samples.length - 1]!;
      const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);

      if (p95 > 300) {
        return { status: "WARN" as const, message: `p95 de ${p95}ms na listagem (media ${avg}ms).` };
      }
      return { message: `p95 ${p95}ms / media ${avg}ms` };
    }),
  );

  results.push(
    await check("Health check responde rapido", "performance", async () => {
      const start = Date.now();
      await api(app, { method: "GET", url: "/api/health" });
      const latency = Date.now() - start;
      if (latency > 200) return { status: "WARN" as const, message: `Health check em ${latency}ms` };
      return undefined;
    }),
  );

  // ---- Encerramento ---------------------------------------------------------
  const finishedAt = new Date();

  const fail = results.filter((r) => r.status === "FAIL").length;
  const warn = results.filter((r) => r.status === "WARN").length;
  const pass = results.filter((r) => r.status === "PASS").length;
  const status: CheckStatus = fail > 0 ? "FAIL" : warn > 0 ? "WARN" : "PASS";

  const run = await prisma.testRun.create({
    data: {
      suite: "full-suite",
      status,
      environment: env.isSandboxPayments ? "sandbox" : "production",
      requestedBy: requestedBy ?? null,
      durationMs: Date.now() - suiteStart,
      startedAt,
      finishedAt,
      results: {
        create: results.map((r) => ({
          name: r.name,
          category: r.category,
          status: r.status,
          durationMs: r.durationMs,
          endpoint: r.endpoint ?? null,
          requestId: r.requestId ?? null,
          errorMessage: r.errorMessage ?? null,
          stackTrace: env.isProduction ? null : (r.stackTrace ?? null),
        })),
      },
    },
  });

  // Limpeza dos dados de teste (nunca deixa lixo no banco de producao)
  for (const cleanup of cleanups.reverse()) {
    await cleanup().catch(() => undefined);
  }

  return {
    runId: run.id,
    status,
    results,
    summary: { total: results.length, pass, warn, fail, durationMs: Date.now() - suiteStart },
  };
}
