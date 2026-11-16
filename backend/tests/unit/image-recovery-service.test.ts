import { beforeEach, describe, expect, it, vi } from "vitest";

/** PNG 200x200 valido (passa na validacao de magic bytes + dimensoes). */
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

const h = vi.hoisted(() => {
  const state: { asset: Record<string, unknown> | null } = { asset: null };

  const applyData = (data: Record<string, unknown>) => {
    const next = { ...(state.asset ?? {}) };
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in (value as object)) {
        next[key] = Number(next[key] ?? 0) + Number((value as { increment: number }).increment);
      } else {
        next[key] = value;
      }
    }
    next.updatedAt = new Date();
    state.asset = next;
    return next;
  };

  const prisma = {
    imageRecoveryAsset: {
      findUnique: vi.fn(async () => state.asset),
      findUniqueOrThrow: vi.fn(async () => state.asset),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => applyData(data)),
    },
    imageRecoveryLog: { create: vi.fn(async () => ({})) },
    productImage: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    banner: { findUnique: vi.fn(), update: vi.fn() },
    category: { findUnique: vi.fn(), update: vi.fn() },
    brand: { findUnique: vi.fn(), update: vi.fn() },
    product: { findUnique: vi.fn(async () => ({ name: "Perfume Teste" })) },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(prisma);
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };

  return { state, prisma };
});

vi.mock("../../src/db.js", () => ({ prisma: h.prisma }));
vi.mock("../../src/services/cloudinary.js", () => ({
  isCloudinaryConfigured: vi.fn(() => true),
  deleteCloudinaryAsset: vi.fn(async () => true),
}));
vi.mock("../../src/services/storage-provider.js", () => ({
  saveImage: vi.fn(),
  storageStatus: vi.fn(() => ({ driver: "cloudinary", persistent: true, cloudinaryConfigured: true, cloudinaryFolder: "ma-store" })),
}));
vi.mock("../../src/services/image-recovery/checker.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/image-recovery/checker")>();
  return { ...actual, checkImageUrl: vi.fn() };
});
vi.mock("../../src/services/image-recovery/url-safety.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/image-recovery/url-safety")>();
  return { ...actual, safeFetch: vi.fn() };
});

import { checkImageUrl, type ImageCheckResult } from "../../src/services/image-recovery/checker";
import { safeFetch } from "../../src/services/image-recovery/url-safety";
import { deleteCloudinaryAsset } from "../../src/services/cloudinary";
import { saveImage } from "../../src/services/storage-provider";
import { confirmAsset, recoverAsset } from "../../src/services/image-recovery/recovery.service";

const baseAsset = {
  id: "asset-1",
  assetType: "PRODUCT_IMAGE",
  assetId: "image-1",
  productId: "product-1",
  label: "Perfume Teste — imagem 1",
  field: "url",
  currentUrl: "https://old.example.com/perfume.jpg",
  originalUrl: "https://old.example.com/perfume.jpg",
  status: "RECOVERABLE",
  httpStatus: null,
  contentType: null,
  format: null,
  width: null,
  height: null,
  sizeBytes: null,
  finalUrl: null,
  redirected: false,
  newUrl: null,
  publicId: null,
  storageProvider: null,
  failureReason: null,
  attempts: 0,
  lastCheckedAt: null,
  nextCheckAt: null,
  recoveredAt: null,
  lastAdminId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const okCheck = (status: ImageCheckResult["status"] = "RECOVERABLE"): ImageCheckResult => ({
  status,
  httpStatus: 200,
  contentType: "image/png",
  format: "png",
  width: 200,
  height: 200,
  sizeBytes: pngBuffer().length,
  finalUrl: "https://old.example.com/perfume.jpg",
  redirected: false,
  reason: null,
  retryable: false,
  alreadyHosted: false,
});

beforeEach(() => {
  h.state.asset = { ...baseAsset };
  vi.clearAllMocks();
  vi.mocked(safeFetch).mockResolvedValue({
    status: 200,
    headers: { "content-type": "image/png" },
    body: pngBuffer(),
    finalUrl: "https://old.example.com/perfume.jpg",
    redirects: 0,
    truncated: false,
    contentType: "image/png",
    contentLength: pngBuffer().length,
  });
  vi.mocked(saveImage).mockResolvedValue({
    url: "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto:good/v1/ma-store/recuperadas/asset-1.png",
    filename: "ma-store/recuperadas/asset-1",
    mime: "image/png",
    width: 200,
    height: 200,
    size: pngBuffer().length,
  });
});

describe("recoverAsset", () => {
  it("copia para o Cloudinary e deixa AGUARDANDO CONFIRMACAO sem tocar no produto", async () => {
    vi.mocked(checkImageUrl).mockResolvedValueOnce(okCheck("RECOVERABLE")).mockResolvedValueOnce(okCheck("AVAILABLE"));

    const outcome = await recoverAsset("asset-1", "admin-1");

    expect(outcome.ok).toBe(true);
    expect(h.state.asset?.status).toBe("PENDING_CONFIRMATION");
    expect(h.state.asset?.newUrl).toContain("res.cloudinary.com");
    expect(h.state.asset?.publicId).toBe("ma-store/recuperadas/asset-1");
    expect(h.state.asset?.storageProvider).toBe("cloudinary");
    // Regra de ouro: o produto NAO e alterado antes da confirmacao.
    expect(h.prisma.productImage.update).not.toHaveBeenCalled();
  });

  it("nao substitui nada quando o upload ao Cloudinary falha", async () => {
    vi.mocked(checkImageUrl).mockResolvedValueOnce(okCheck("RECOVERABLE"));
    vi.mocked(saveImage).mockRejectedValueOnce(new Error("Cloudinary recusou o envio (HTTP 401)."));

    const outcome = await recoverAsset("asset-1", "admin-1");

    expect(outcome.ok).toBe(false);
    expect(h.state.asset?.status).toBe("RECOVERABLE");
    expect(h.state.asset?.newUrl).toBeNull();
    expect(h.prisma.productImage.update).not.toHaveBeenCalled();
  });

  it("nao baixa imagem quando a URL original esta indisponivel", async () => {
    vi.mocked(checkImageUrl).mockResolvedValueOnce({
      ...okCheck("NOT_FOUND"),
      httpStatus: 404,
      retryable: false,
      reason: "Arquivo nao encontrado (HTTP 404).",
    });

    const outcome = await recoverAsset("asset-1");
    expect(outcome.ok).toBe(false);
    expect(h.state.asset?.status).toBe("NOT_FOUND");
    expect(safeFetch).not.toHaveBeenCalled();
    expect(saveImage).not.toHaveBeenCalled();
  });
});

describe("confirmAsset", () => {
  it("substitui SOMENTE a referencia de imagem e preserva a URL antiga", async () => {
    h.state.asset = {
      ...baseAsset,
      status: "PENDING_CONFIRMATION",
      newUrl: "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto:good/v1/ma-store/recuperadas/asset-1.png",
      publicId: "ma-store/recuperadas/asset-1",
      storageProvider: "cloudinary",
      format: "png",
      width: 200,
      height: 200,
      sizeBytes: 1000,
    };
    h.prisma.productImage.findUnique.mockResolvedValue({
      id: "image-1",
      productId: "product-1",
      url: "https://old.example.com/perfume.jpg",
      originalUrl: null,
    });
    h.prisma.productImage.update.mockResolvedValue({});

    const outcome = await confirmAsset("asset-1", "replace", "admin-1");

    expect(outcome.updatedTarget).toBe(true);
    expect(h.prisma.productImage.update).toHaveBeenCalledTimes(1);
    const updateCalls = h.prisma.productImage.update.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    const updateArg = updateCalls[0]![0];
    expect(updateArg.data.url).toContain("res.cloudinary.com");
    expect(updateArg.data.originalUrl).toBe("https://old.example.com/perfume.jpg");
    expect(updateArg.data.publicId).toBe("ma-store/recuperadas/asset-1");
    expect(updateArg.data.recoveryStatus).toBe("RECOVERED");
    // Nunca envia campos de preco/nome/estoque para a atualizacao.
    expect(updateArg.data).not.toHaveProperty("price");
    expect(updateArg.data).not.toHaveProperty("name");
    expect(updateArg.data).not.toHaveProperty("stock");
    expect(h.state.asset?.status).toBe("RECOVERED");
    expect(h.state.asset?.originalUrl).toBe("https://old.example.com/perfume.jpg");
  });

  it("manter a antiga nao altera o produto e descarta a copia pendente", async () => {
    h.state.asset = {
      ...baseAsset,
      status: "PENDING_CONFIRMATION",
      newUrl: "https://res.cloudinary.com/demo/image/upload/v1/x.png",
      publicId: "ma-store/recuperadas/asset-1",
      storageProvider: "cloudinary",
    };

    const outcome = await confirmAsset("asset-1", "keep", "admin-1");

    expect(outcome.updatedTarget).toBe(false);
    expect(h.prisma.productImage.update).not.toHaveBeenCalled();
    expect(deleteCloudinaryAsset).toHaveBeenCalledWith("ma-store/recuperadas/asset-1");
    expect(h.state.asset?.newUrl).toBeNull();
    expect(h.state.asset?.currentUrl).toBe("https://old.example.com/perfume.jpg");
  });

  it("recusa confirmar sem pre-visualizacao pendente", async () => {
    await expect(confirmAsset("asset-1", "replace")).rejects.toThrow(/pendente/i);
    expect(h.prisma.productImage.update).not.toHaveBeenCalled();
  });
});
