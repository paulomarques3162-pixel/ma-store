import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, uploadImage } from "./api";

/**
 * Testa o cliente de upload de imagens (multipart) sem rede real:
 * sucesso, erro do backend e renovação de sessão em 401.
 */

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function imageFile(): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "foto.png", { type: "image/png" });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadImage", () => {
  it("envia o arquivo e devolve a imagem persistida", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> =>
      fakeResponse(201, {
        data: { url: "/uploads/foto.png", filename: "foto.png", mime: "image/png", width: 800, height: 600, size: 4 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("mastore.accessToken", "token-1");

    const result = await uploadImage(imageFile());
    expect(result.url).toBe("/uploads/foto.png");

    const call = fetchMock.mock.calls[0]!;
    expect(String(call[0])).toBe("/api/admin/uploads");
    expect((call[1]?.headers as Record<string, string>).authorization).toBe("Bearer token-1");
    expect(call[1]?.body).toBeInstanceOf(FormData);
  });

  it("transforma erro do backend em ApiError com o código real", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> =>
        fakeResponse(422, { error: { code: "VALIDATION_ERROR", message: "Arquivo não é uma imagem válida." } }),
      ),
    );

    await expect(uploadImage(imageFile())).rejects.toBeInstanceOf(ApiError);
    await expect(uploadImage(imageFile())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Arquivo não é uma imagem válida.",
    });
  });

  it("renova a sessão e repete o upload quando o access token expira", async () => {
    localStorage.setItem("mastore.accessToken", "token-expirado");
    localStorage.setItem("mastore.refreshToken", "refresh-1");

    const fetchMock = vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
      if (url.includes("/auth/refresh")) {
        return fakeResponse(200, { data: { accessToken: "token-novo", refreshToken: "refresh-2" } });
      }
      // Primeira tentativa chega com token antigo; a segunda, renovada.
      return localStorage.getItem("mastore.accessToken") === "token-novo"
        ? fakeResponse(201, {
            data: { url: "/uploads/ok.png", filename: "ok.png", mime: "image/png", width: 800, height: 600, size: 4 },
          })
        : fakeResponse(401, { error: { code: "UNAUTHENTICATED", message: "Sessão expirada." } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadImage(imageFile());
    expect(result.url).toBe("/uploads/ok.png");
    expect(localStorage.getItem("mastore.accessToken")).toBe("token-novo");
    // upload(401) -> refresh(200) -> upload(201)
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
