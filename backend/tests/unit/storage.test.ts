import { describe, expect, it } from "vitest";
import { detectImageMime, validateImage } from "../../src/services/storage";

/** PNG mínimo com IHDR válido (800x600) — suficiente para o image-size. */
function pngBuffer(width = 800, height = 600): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    (width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    (height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    0x08, 0x02, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

describe("detectImageMime", () => {
  it("identifica imagens por magic bytes", () => {
    expect(detectImageMime(pngBuffer())).toBe("image/png");
    expect(detectImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("image/jpeg");
    expect(detectImageMime(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]))).toBe("image/gif");
  });

  it("rejeita arquivo que não é imagem (mesmo com extensão falsa)", () => {
    const text = new TextEncoder().encode("<?php echo 'x'; ?>");
    expect(detectImageMime(text)).toBeNull();
  });
});

describe("validateImage", () => {
  const maxBytes = 5 * 1024 * 1024;

  it("aceita PNG dentro dos limites", () => {
    const result = validateImage(pngBuffer(), maxBytes);
    expect(result.ok).toBe(true);
    expect(result.mime).toBe("image/png");
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it("rejeita imagem pequena demais", () => {
    expect(validateImage(pngBuffer(50, 50), maxBytes).ok).toBe(false);
  });

  it("rejeita arquivo acima do limite", () => {
    expect(validateImage(pngBuffer(), 10).ok).toBe(false);
  });

  it("rejeita conteúdo que não é imagem", () => {
    expect(validateImage(new TextEncoder().encode("não sou imagem"), maxBytes).ok).toBe(false);
  });
});
