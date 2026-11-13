import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IMAGE_VARIANT_WIDTHS,
  getImageVariant,
  isTransformable,
  isVariantWidth,
  variantPath,
} from "../../src/services/image-variants.js";

/**
 * O pipeline de imagens NUNCA altera o original: ele gera variantes WebP em
 * `<uploads>/.cache/<largura>/`. Estes testes usam uma imagem real (sharp) para
 * garantir que a conversão funciona e que os limites de segurança valem.
 */
describe("variantes de imagem", () => {
  let dir: string;
  const filename = "1700000000-abcdef.png";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ma-store-img-"));
    await mkdir(dir, { recursive: true });
    // Original 1600x1200 (simula foto de celular).
    const original = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: { r: 30, g: 40, b: 50 } },
    })
      .png()
      .toBuffer();
    await writeFile(join(dir, filename), original);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("aceita apenas as larguras suportadas", () => {
    expect(isVariantWidth(640)).toBe(true);
    expect(isVariantWidth("960")).toBe(true);
    expect(isVariantWidth(1000)).toBe(false);
    expect(isVariantWidth("abc")).toBe(false);
  });

  it("bloqueia path traversal no nome do arquivo", () => {
    expect(variantPath("../etc/passwd", 640, dir)).toBeNull();
    expect(variantPath("ok.png", 640, dir)).toContain(join(".cache", "640", "ok.png.webp"));
  });

  it("não transforma GIF (perderia a animação)", () => {
    expect(isTransformable("anim.gif")).toBe(false);
    expect(isTransformable("foto.jpg")).toBe(true);
  });

  it("gera WebP na largura pedida sem alterar o original", async () => {
    const before = await readFile(join(dir, filename));
    const result = await getImageVariant(filename, 640, { directory: dir });

    expect(result).not.toBeNull();
    const metadata = await sharp(result!.buffer).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(640);

    const after = await readFile(join(dir, filename));
    expect(after.equals(before)).toBe(true);
  });

  it("não aumenta imagens pequenas (withoutEnlargement)", async () => {
    const small = "1700000001-small.png";
    await writeFile(
      join(dir, small),
      await sharp({ create: { width: 300, height: 300, channels: 3, background: "#fff" } }).png().toBuffer(),
    );

    const result = await getImageVariant(small, 1280, { directory: dir });
    expect(result).not.toBeNull();
    expect((await sharp(result!.buffer).metadata()).width).toBe(300);
  });

  it("devolve null para arquivo inexistente (frontend cai no original)", async () => {
    expect(await getImageVariant("nao-existe.jpg", 640, { directory: dir })).toBeNull();
  });

  it("reaproveita a variante gravada em disco", async () => {
    const result = await getImageVariant(filename, 320, { directory: dir });
    expect(result?.generated).toBe(true);

    const cached = await getImageVariant(filename, 320, { directory: dir });
    expect(cached?.generated).toBe(false);
    expect(cached?.buffer.equals(result!.buffer)).toBe(true);
  });

  it("mantém a lista de larguras alinhada com o frontend", () => {
    expect([...IMAGE_VARIANT_WIDTHS]).toEqual([320, 640, 960, 1280]);
  });
});
