import { describe, expect, it, vi } from "vitest";
import { ApiError, api, buildQuery, envelopeExtras, errorMessage, errorRequestId, fieldErrors, tokenStore } from "@/lib/api";
import { mockApi } from "@/tests/mocks";

describe("cliente HTTP", () => {
  it("monta a query ignorando valores vazios", () => {
    expect(buildQuery({ page: 1, search: "", active: undefined, flag: true })).toBe("?page=1&flag=true");
    expect(buildQuery()).toBe("");
    expect(buildQuery({ tags: ["a", "b"] })).toBe("?tags=a%2Cb");
  });

  it("desembrulha o envelope { data }", async () => {
    mockApi([{ path: "/products", data: [{ id: "1" }], meta: { page: 1, perPage: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false } }]);

    const result = await api.list<Array<{ id: string }>>("/products");
    expect(result.data).toEqual([{ id: "1" }]);
    expect(result.meta?.total).toBe(1);
  });

  it("preserva campos extras do envelope (ex.: statusCounts)", async () => {
    mockApi([
      {
        path: "/admin/orders",
        data: [{ id: "o1" }],
        meta: { page: 1, perPage: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
      },
    ]);

    // Simula o campo extra anexado pelo backend (o helper preserva sem poluir).
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "o1" }], meta: { page: 1 }, statusCounts: { PAID: 3 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.list<Array<{ id: string }>>("/admin/orders");
    expect(envelopeExtras(result.data)).toEqual({ statusCounts: { PAID: 3 } });
  });

  it("transforma o envelope de erro em ApiError com requestId e detalhes", async () => {
    mockApi([
      {
        path: "/auth/register",
        status: 422,
        error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", requestId: "req-1" },
      },
    ]);

    await expect(api.post("/auth/register", {}, { auth: false })).rejects.toBeInstanceOf(ApiError);
  });

  it("expõe erros por campo quando o backend devolve detalhes do Zod", () => {
    const error = new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "Dados inválidos.",
      details: [
        { field: "email", message: "E-mail inválido." },
        { field: "password", message: "Senha fraca." },
      ],
    });

    expect(fieldErrors(error)).toEqual({ email: "E-mail inválido.", password: "Senha fraca." });
    expect(fieldErrors(new Error("x"))).toEqual({});
  });

  it("devolve mensagem amigável e requestId a partir do erro", () => {
    const error = new ApiError(500, { code: "INTERNAL_ERROR", message: "Não foi possível concluir.", requestId: "abc" });
    expect(errorMessage(error)).toBe("Não foi possível concluir.");
    expect(errorRequestId(error)).toBe("abc");
    expect(errorMessage("outro erro")).toBe("Não foi possível concluir a operação. Tente novamente.");
  });

  it("trata falha de rede como NETWORK_ERROR e não vaza stack", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    try {
      await api.get("/products");
      throw new Error("deveria ter falhado");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.code).toBe("NETWORK_ERROR");
      expect(apiError.message).toContain("internet");
      expect(apiError.message).not.toContain("Failed to fetch");
    }
  });

  it("tenta renovar o token em 401 e repete a requisição", async () => {
    tokenStore.set("access-antigo", "refresh-valido");

    let callCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/auth/refresh")) {
        return new Response(JSON.stringify({ data: { accessToken: "access-novo", refreshToken: "refresh-novo" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      callCount += 1;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "expirado" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ data: { id: "u1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await api.get<{ id: string }>("/auth/me");
    expect(result).toEqual({ id: "u1" });
    expect(tokenStore.getAccess()).toBe("access-novo");
  });

  it("limpa os tokens quando o refresh também falha", async () => {
    tokenStore.set("access-antigo", "refresh-invalido");

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/refresh")) {
        return new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "invalido" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "expirado" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }));

    await expect(api.get("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(tokenStore.getAccess()).toBeNull();
  });
});
