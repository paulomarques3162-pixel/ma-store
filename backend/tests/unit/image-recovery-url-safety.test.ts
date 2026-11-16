import { describe, expect, it, vi } from "vitest";
import { assertSafeUrl, isBlockedIp, safeFetch, RemoteNetworkError, UnsafeUrlError } from "../../src/services/image-recovery/url-safety";

const resolvePublic = async () => ["93.184.216.34"];

describe("isBlockedIp", () => {
  it("bloqueia loopback, redes privadas e metadata de nuvem", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.9",
      "192.168.1.1",
      "169.254.169.254",
      "100.100.100.200",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("permite IPs publicos", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });
});

describe("assertSafeUrl", () => {
  it("aceita http/https publicos", async () => {
    const result = await assertSafeUrl("https://images.example.com/a.jpg", { resolve: resolvePublic });
    expect(result.url.hostname).toBe("images.example.com");
    expect(result.addresses).toEqual(["93.184.216.34"]);
  });

  it("recusa protocolos diferentes de HTTP(S)", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafeUrl("ftp://example.com/a.jpg")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafeUrl("javascript:alert(1)")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("recusa localhost, hosts internos e IPs privados literais", async () => {
    for (const url of [
      "http://localhost/a.jpg",
      "http://127.0.0.1/a.jpg",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/a.jpg",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://db.internal/a.jpg",
      "http://192.168.0.10/a.jpg",
    ]) {
      await expect(assertSafeUrl(url), url).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });

  it("recusa URL com credenciais embutidas", async () => {
    await expect(assertSafeUrl("http://user:pass@example.com/a.jpg", { resolve: resolvePublic })).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("recusa quando o DNS resolve para IP privado (inclusive resposta mista)", async () => {
    await expect(
      assertSafeUrl("http://evil.example.com/a.jpg", { resolve: async () => ["10.0.0.5"] }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);

    await expect(
      assertSafeUrl("http://evil.example.com/a.jpg", { resolve: async () => ["93.184.216.34", "192.168.0.2"] }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe("safeFetch", () => {
  it("revalida o destino de cada redirect e bloqueia rede interna", async () => {
    const transport = vi.fn(async () => ({
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data" },
      body: Buffer.alloc(0),
      truncated: false,
    }));

    await expect(
      safeFetch("https://example.com/a.jpg", { transport, resolve: resolvePublic }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    // A requisicao para o destino interno NUNCA aconteceu.
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("segue redirect publico e devolve a URL final", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ status: 301, headers: { location: "https://cdn.example.com/b.jpg" }, body: Buffer.alloc(0), truncated: false })
      .mockResolvedValueOnce({ status: 200, headers: { "content-type": "image/jpeg", "content-length": "4" }, body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), truncated: false });

    const result = await safeFetch("https://example.com/a.jpg", { transport, resolve: resolvePublic });
    expect(result.status).toBe(200);
    expect(result.redirects).toBe(1);
    expect(result.finalUrl).toBe("https://cdn.example.com/b.jpg");
    expect(result.contentType).toBe("image/jpeg");
  });

  it("limita o numero de redirects", async () => {
    const transport = vi.fn(async () => ({
      status: 302,
      headers: { location: "https://example.com/loop" },
      body: Buffer.alloc(0),
      truncated: false,
    }));
    await expect(
      safeFetch("https://example.com/a.jpg", { transport, resolve: resolvePublic, maxRedirects: 2 }),
    ).rejects.toBeInstanceOf(RemoteNetworkError);
  });

  it("para de ler ao atingir probeBytes (nao baixa o arquivo inteiro)", async () => {
    const transport = vi.fn(async (input) => ({
      status: 200,
      headers: { "content-type": "image/png" },
      body: Buffer.alloc(Math.min(input.probeBytes, 10)),
      truncated: true,
    }));
    const result = await safeFetch("https://example.com/a.png", { transport, resolve: resolvePublic, probeBytes: 10 });
    expect(result.truncated).toBe(true);
    expect(result.body.length).toBe(10);
    expect(transport.mock.calls[0]![0].probeBytes).toBe(10);
  });
});
