import { describe, expect, it, vi } from "vitest";
import {
  buildDeliveryUrl,
  buildUploadSignature,
  CloudinaryUploadError,
  publicIdForUrl,
  uploadImageToCloudinary,
  type CloudinaryConfig,
} from "../../src/services/cloudinary";

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

const config: CloudinaryConfig = {
  cloudName: "demo",
  apiKey: "key-123",
  apiSecret: "secret-xyz",
  folder: "ma-store",
};

describe("buildUploadSignature", () => {
  it("e estavel e independe da ordem dos parametros", () => {
    const a = buildUploadSignature({ timestamp: 123, public_id: "x/y", folder: "f" }, "secret");
    const b = buildUploadSignature({ folder: "f", public_id: "x/y", timestamp: 123 }, "secret");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{40}$/);
  });

  it("muda quando o segredo ou um parametro muda", () => {
    const base = buildUploadSignature({ timestamp: 123 }, "secret");
    expect(buildUploadSignature({ timestamp: 123 }, "other-secret")).not.toBe(base);
    expect(buildUploadSignature({ timestamp: 124 }, "secret")).not.toBe(base);
  });

  it("ignora parametros vazios", () => {
    expect(buildUploadSignature({ timestamp: 1, folder: "" }, "s")).toBe(buildUploadSignature({ timestamp: 1 }, "s"));
  });
});

describe("buildDeliveryUrl", () => {
  it("aplica f_auto/q_auto:good e versao", () => {
    const url = buildDeliveryUrl("ma-store/recuperadas/abc", { version: 17, format: "webp", cloudName: "demo" });
    expect(url).toBe("https://res.cloudinary.com/demo/image/upload/f_auto,q_auto:good/v17/ma-store/recuperadas/abc.webp");
  });

  it("public_id deterministico evita duplicar o mesmo endereco", () => {
    expect(publicIdForUrl("https://x/a.jpg", "ma-store")).toBe(publicIdForUrl("https://x/a.jpg", "ma-store"));
    expect(publicIdForUrl("https://x/a.jpg", "ma-store")).not.toBe(publicIdForUrl("https://x/b.jpg", "ma-store"));
  });
});

describe("uploadImageToCloudinary", () => {
  it("valida a imagem ANTES de qualquer requisicao de rede", async () => {
    const fetchImpl = vi.fn();
    await expect(
      uploadImageToCloudinary(Buffer.from("<?php echo 1; ?>"), {}, { fetch: fetchImpl as unknown as typeof fetch, config }),
    ).rejects.toThrow(/imagem válida|imagem invalida|válida/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("envia multipart assinado e devolve URL otimizada", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      expect(form.get("api_key")).toBe("key-123");
      expect(String(form.get("folder"))).toBe("ma-store");
      expect(form.get("signature")).toMatch(/^[a-f0-9]{40}$/);
      expect(form.get("file")).toBeInstanceOf(Blob);
      return new Response(
        JSON.stringify({
          secure_url: "https://res.cloudinary.com/demo/image/upload/v9/ma-store/recuperadas/abc.png",
          public_id: "ma-store/recuperadas/abc",
          format: "png",
          width: 200,
          height: 200,
          bytes: 1234,
          version: 9,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await uploadImageToCloudinary(
      pngBuffer(),
      { publicId: "ma-store/recuperadas/abc" },
      { fetch: fetchImpl as unknown as typeof fetch, config, now: () => new Date(1_700_000_000_000) },
    );

    expect(result.publicId).toBe("ma-store/recuperadas/abc");
    expect(result.url).toBe("https://res.cloudinary.com/demo/image/upload/f_auto,q_auto:good/v9/ma-store/recuperadas/abc.png");
    expect(result.provider).toBe("cloudinary");
    expect(result.sizeBytes).toBe(1234);
  });

  it("propaga falha do Cloudinary sem expor detalhes internos", async () => {
    const fetchImpl = vi.fn(async () => new Response("invalid signature xyz", { status: 401 }));
    await expect(
      uploadImageToCloudinary(pngBuffer(), {}, { fetch: fetchImpl as unknown as typeof fetch, config }),
    ).rejects.toBeInstanceOf(CloudinaryUploadError);
  });

  it("recusa quando nao ha configuracao", async () => {
    await expect(uploadImageToCloudinary(pngBuffer(), {}, { config: null })).rejects.toBeInstanceOf(CloudinaryUploadError);
  });
});
