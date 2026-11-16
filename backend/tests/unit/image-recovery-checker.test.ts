import { describe, expect, it, vi } from "vitest";
import {
  checkImageUrl,
  classifyImageResponse,
  isRecoverableStatus,
  isWorkingStatus,
} from "../../src/services/image-recovery/checker";
import { RemoteNetworkError } from "../../src/services/image-recovery/url-safety";

/** PNG minimo com IHDR valido (200x200). */
function pngBuffer(width = 200, height = 200): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    (width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    (height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    0x08, 0x02, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

const pngResponse = (overrides: Record<string, unknown> = {}) => ({
  status: 200,
  headers: {},
  body: pngBuffer(),
  finalUrl: "https://example.com/a.png",
  redirects: 0,
  truncated: false,
  contentType: "image/png",
  contentLength: pngBuffer().length,
  ...overrides,
});

describe("classifyImageResponse", () => {
  it("classifica imagem acessivel externa como RECOVERABLE", () => {
    const result = classifyImageResponse(pngResponse(), "https://example.com/a.png");
    expect(result.status).toBe("RECOVERABLE");
    expect(result.format).toBe("png");
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
    expect(result.retryable).toBe(false);
    expect(isRecoverableStatus(result.status)).toBe(true);
    expect(isWorkingStatus(result.status)).toBe(true);
  });

  it("imagem ja no Cloudinary e AVAILABLE", () => {
    const url = "https://res.cloudinary.com/demo/image/upload/v1/produto.jpg";
    const result = classifyImageResponse(pngResponse({ finalUrl: url }), url);
    expect(result.status).toBe("AVAILABLE");
    expect(result.alreadyHosted).toBe(true);
  });

  it("redirecionamento vira REDIRECT (e continua recuperavel)", () => {
    const result = classifyImageResponse(
      pngResponse({ redirects: 1, finalUrl: "https://cdn.example.com/a.png" }),
      "https://example.com/a.png",
    );
    expect(result.status).toBe("REDIRECT");
    expect(result.redirected).toBe(true);
    expect(isRecoverableStatus(result.status)).toBe(true);
  });

  it("HTML ou JSON no lugar de imagem vira INVALID_CONTENT", () => {
    const html = classifyImageResponse(
      pngResponse({ contentType: "text/html; charset=utf-8", body: Buffer.from("<html>not found</html>") }),
      "https://example.com/a.png",
    );
    expect(html.status).toBe("INVALID_CONTENT");
  });

  it("detecta extensao falsa / arquivo que nao e imagem pelos magic bytes", () => {
    const result = classifyImageResponse(
      pngResponse({ contentType: "image/jpeg", body: Buffer.from("<?php echo 1; ?>") }),
      "https://example.com/fake.jpg",
    );
    expect(result.status).toBe("INVALID_CONTENT");
  });

  it("204 sem corpo nao e imagem", () => {
    const result = classifyImageResponse(pngResponse({ status: 204, body: Buffer.alloc(0) }), "https://example.com/a.png");
    expect(result.status).toBe("INVALID_CONTENT");
  });

  it("mapeia erros HTTP conhecidos", () => {
    const notFound = classifyImageResponse(pngResponse({ status: 404, body: Buffer.alloc(0) }), "https://example.com/a.png");
    expect(notFound.status).toBe("NOT_FOUND");

    const unavailable = classifyImageResponse(pngResponse({ status: 503, body: Buffer.alloc(0) }), "https://example.com/a.png");
    expect(unavailable.status).toBe("SERVER_UNAVAILABLE");
    expect(unavailable.retryable).toBe(true);

    const blocked = classifyImageResponse(pngResponse({ status: 403, body: Buffer.alloc(0) }), "https://example.com/a.png");
    expect(blocked.status).toBe("ACCESS_BLOCKED");

    const limited = classifyImageResponse(pngResponse({ status: 429, body: Buffer.alloc(0) }), "https://example.com/a.png");
    expect(limited.status).toBe("ACCESS_BLOCKED");
    expect(limited.retryable).toBe(true);
  });
});

describe("checkImageUrl", () => {
  it("nao repete 404 (erro definitivo)", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 404,
      headers: {},
      body: Buffer.alloc(0),
      finalUrl: "https://example.com/a.png",
      redirects: 0,
      truncated: false,
      contentType: "text/html",
      contentLength: 0,
    }));
    const result = await checkImageUrl("https://example.com/a.png", { fetch: fetchImpl, sleep: async () => undefined });
    expect(result.status).toBe("NOT_FOUND");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("timeout e erro temporario (nao vira imagem perdida) e tenta novamente", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new RemoteNetworkError("timeout", "ETIMEDOUT");
    });
    const sleep = vi.fn(async () => undefined);
    const result = await checkImageUrl("https://example.com/a.png", { fetch: fetchImpl, sleep });
    expect(result.status).toBe("SERVER_UNAVAILABLE");
    expect(result.retryable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalled();
  });

  it("converte erro de DNS em CONNECTION_ERROR temporario", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new RemoteNetworkError("dns", "ENOTFOUND");
    });
    const result = await checkImageUrl("https://example.com/a.png", { fetch: fetchImpl, sleep: async () => undefined });
    expect(result.status).toBe("CONNECTION_ERROR");
    expect(result.retryable).toBe(true);
  });

  it("SSRF e classificado como URL INVALIDA", async () => {
    const { UnsafeUrlError } = await import("../../src/services/image-recovery/url-safety");
    const fetchImpl = vi.fn(async () => {
      throw new UnsafeUrlError("IP privado", "IP_PRIVADO");
    });
    const result = await checkImageUrl("http://127.0.0.1/a.png", { fetch: fetchImpl });
    expect(result.status).toBe("INVALID_URL");
    expect(result.retryable).toBe(false);
  });
});
