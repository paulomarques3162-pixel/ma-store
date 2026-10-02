import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADDRESS, api, createAdmin, createClient, createShopFixture, db, makeApp, resetDatabase } from "../helpers";

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

describe("cadastro", () => {
  it("cria conta e devolve tokens sem expor a senha", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/auth/register",
      payload: {
        name: "Maria Silva",
        email: "maria@teste.local",
        phone: "11999999999",
        password: "Maria@12345",
        confirmPassword: "Maria@12345",
        acceptTerms: true,
      },
    });

    expect(response.status).toBe(201);
    const data = response.body.data as Record<string, unknown>;
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
    expect(JSON.stringify(data)).not.toContain("passwordHash");
    expect(JSON.stringify(data)).not.toContain("Maria@12345");
  });

  it("normaliza o e-mail para minusculas", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/auth/register",
      payload: {
        name: "Teste Email",
        email: "TESTE.EMAIL@TESTE.LOCAL",
        password: "Teste@12345",
        confirmPassword: "Teste@12345",
        acceptTerms: true,
      },
    });
    expect(response.status).toBe(201);
    expect((response.body.data as { user: { email: string } }).user.email).toBe("teste.email@teste.local");
  });

  it("rejeita e-mail duplicado (case-insensitive)", async () => {
    await createClient(app, { email: "dup@teste.local" });
    const response = await api(app, {
      method: "POST",
      url: "/api/auth/register",
      payload: {
        name: "Outro",
        email: "DUP@teste.local",
        password: "Teste@12345",
        confirmPassword: "Teste@12345",
        acceptTerms: true,
      },
    });
    expect(response.status).toBe(409);
  });

  it("rejeita senhas diferentes e senha fraca", async () => {
    const mismatch = await api(app, {
      method: "POST",
      url: "/api/auth/register",
      payload: {
        name: "Teste",
        email: "m@teste.local",
        password: "Teste@12345",
        confirmPassword: "Outra@12345",
        acceptTerms: true,
      },
    });
    expect(mismatch.status).toBe(422);

    const weak = await api(app, {
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "Teste", email: "w@teste.local", password: "123", confirmPassword: "123", acceptTerms: true },
    });
    expect(weak.status).toBe(422);
  });

  it("exige aceite dos termos", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "Teste", email: "t@teste.local", password: "Teste@12345", confirmPassword: "Teste@12345" },
    });
    expect(response.status).toBe(422);
  });
});

describe("login e sessao", () => {
  it("autentica e permite acessar dados proprios", async () => {
    const client = await createClient(app, { email: "login@teste.local" });

    const me = await api(app, { method: "GET", url: "/api/auth/me", token: client.accessToken });
    expect(me.status).toBe(200);
    expect((me.body.data as { email: string }).email).toBe("login@teste.local");
  });

  it("recusa senha incorreta com mensagem generica", async () => {
    await createClient(app, { email: "senha@teste.local" });
    const response = await api(app, {
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "senha@teste.local", password: "errada-123" },
    });
    expect(response.status).toBe(401);
    expect(response.body.error?.message).toContain("incorretos");
  });

  it("nao revela se o e-mail existe", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "naoexiste@teste.local", password: "qualquer123" },
    });
    expect(response.status).toBe(401);
    expect(response.body.error?.message).toContain("incorretos");
  });

  it("bloqueia a conta apos 5 tentativas", async () => {
    await createClient(app, { email: "brute@teste.local" });

    for (let i = 0; i < 5; i += 1) {
      await api(app, { method: "POST", url: "/api/auth/login", payload: { email: "brute@teste.local", password: "errada" } });
    }

    const blocked = await api(app, {
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "brute@teste.local", password: "Cliente@123" },
    });
    expect(blocked.status).toBe(401);
    expect(blocked.body.error?.message).toContain("bloqueada");
  });

  it("rotaciona o refresh token e revoga o antigo", async () => {
    const client = await createClient(app, { email: "refresh@teste.local" });

    const refreshed = await api(app, {
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: client.refreshToken },
    });
    expect(refreshed.status).toBe(200);
    const newTokens = refreshed.body.data as { refreshToken: string };
    expect(newTokens.refreshToken).not.toBe(client.refreshToken);

    const reused = await api(app, {
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: client.refreshToken },
    });
    expect(reused.status).toBe(401);
  });

  it("logout encerra a sessao", async () => {
    const client = await createClient(app, { email: "logout@teste.local" });
    const logout = await api(app, {
      method: "POST",
      url: "/api/auth/logout",
      token: client.accessToken,
      payload: { refreshToken: client.refreshToken },
    });
    expect(logout.status).toBe(200);

    const refresh = await api(app, {
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: client.refreshToken },
    });
    expect(refresh.status).toBe(401);
  });

  it("rejeita token invalido com 401 (nunca 500)", async () => {
    const response = await api(app, { method: "GET", url: "/api/auth/me", token: "invalido.tokens.aqui" });
    expect(response.status).toBe(401);
  });

  it("fluxo completo de recuperacao de senha", async () => {
    const client = await createClient(app, { email: "recuperar@teste.local" });

    const forgot = await api(app, { method: "POST", url: "/api/auth/forgot-password", payload: { email: "recuperar@teste.local" } });
    expect(forgot.status).toBe(200);
    const token = (forgot.body.data as { devToken: string }).devToken;
    expect(token).toBeTruthy();

    const reset = await api(app, {
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { token, password: "NovaSenha@123", confirmPassword: "NovaSenha@123" },
    });
    expect(reset.status).toBe(200);

    const oldPassword = await api(app, {
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "recuperar@teste.local", password: client.password },
    });
    expect(oldPassword.status).toBe(401);

    const newPassword = await api(app, {
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "recuperar@teste.local", password: "NovaSenha@123" },
    });
    expect(newPassword.status).toBe(200);
  });

  it("recuperacao nao revela se o e-mail existe", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/auth/forgot-password",
      payload: { email: "qualquer@teste.local" },
    });
    expect(response.status).toBe(200);
    expect((response.body.data as { devToken: string | null }).devToken).toBeNull();
  });

  it("troca de senha exige a senha atual", async () => {
    const client = await createClient(app, { email: "trocar@teste.local" });

    const wrong = await api(app, {
      method: "POST",
      url: "/api/auth/change-password",
      token: client.accessToken,
      payload: { currentPassword: "errada", newPassword: "Nova@12345", confirmPassword: "Nova@12345" },
    });
    expect(wrong.status).toBe(422);

    const ok = await api(app, {
      method: "POST",
      url: "/api/auth/change-password",
      token: client.accessToken,
      payload: { currentPassword: client.password, newPassword: "Nova@12345", confirmPassword: "Nova@12345" },
    });
    expect(ok.status).toBe(200);
  });
});

describe("autorizacao", () => {
  it("cliente nao acessa o painel administrativo", async () => {
    const client = await createClient(app);
    const routes = [
      "/api/admin/dashboard",
      "/api/admin/products",
      "/api/admin/orders",
      "/api/admin/users",
      "/api/admin/coupons",
      "/api/admin/audit-logs",
      "/api/admin/lab/run",
    ];

    for (const url of routes) {
      const response = await api(app, {
        method: url.endsWith("/run") ? "POST" : "GET",
        url,
        token: client.accessToken,
        payload: url.endsWith("/run") ? {} : undefined,
      });
      expect(response.status, `rota ${url}`).toBe(403);
    }
  });

  it("admin acessa o painel", async () => {
    const admin = await createAdmin(app);
    const response = await api(app, { method: "GET", url: "/api/admin/dashboard", token: admin.token });
    expect(response.status).toBe(200);
  });
});

describe("enderecos", () => {
  it("cria, lista, define como padrao e remove", async () => {
    const client = await createClient(app);
    const auth = { token: client.accessToken };

    const created = await api(app, { method: "POST", url: "/api/users/me/addresses", ...auth, payload: ADDRESS });
    expect(created.status).toBe(201);
    const id = (created.body.data as { id: string }).id;

    const second = await api(app, {
      method: "POST",
      url: "/api/users/me/addresses",
      ...auth,
      payload: { ...ADDRESS, street: "Rua Dois" },
    });
    expect(second.status).toBe(201);
    const secondId = (second.body.data as { id: string }).id;
    expect((second.body.data as { isDefault: boolean }).isDefault).toBe(false);

    const setDefault = await api(app, { method: "POST", url: `/api/users/me/addresses/${secondId}/default`, ...auth });
    expect(setDefault.status).toBe(200);

    const list = await api(app, { method: "GET", url: "/api/users/me/addresses", ...auth });
    const addresses = list.body.data as Array<{ id: string; isDefault: boolean }>;
    expect(addresses).toHaveLength(2);
    expect(addresses.find((a) => a.id === secondId)?.isDefault).toBe(true);
    expect(addresses.filter((a) => a.isDefault)).toHaveLength(1);

    const removed = await api(app, { method: "DELETE", url: `/api/users/me/addresses/${id}`, ...auth });
    expect(removed.status).toBe(200);
  });

  it("nao permite alterar endereco de outro usuario", async () => {
    const owner = await createClient(app);
    const intruder = await createClient(app);

    const created = await api(app, {
      method: "POST",
      url: "/api/users/me/addresses",
      token: owner.accessToken,
      payload: ADDRESS,
    });
    const id = (created.body.data as { id: string }).id;

    const attempt = await api(app, {
      method: "PATCH",
      url: `/api/users/me/addresses/${id}`,
      token: intruder.accessToken,
      payload: { street: "Rua Invadida" },
    });
    expect(attempt.status).toBe(404);
  });
});
