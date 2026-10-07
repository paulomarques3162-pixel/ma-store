import { describe, expect, it } from "vitest";
import { compressImageFile } from "./image-compression";

/**
 * A compressão real depende de canvas (jsdom não implementa). Aqui garantimos o
 * comportamento seguro: formatos que não devem ser reencodados e arquivos que
 * não são imagem passam intactos.
 */
describe("compressImageFile", () => {
  it("não altera arquivos que não são imagem", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "nota.txt", { type: "text/plain" });
    const result = await compressImageFile(file);
    expect(result).toBe(file);
  });

  it("preserva GIF/AVIF (não reencoda)", async () => {
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38])], "anim.gif", { type: "image/gif" });
    expect(await compressImageFile(gif)).toBe(gif);
    const avif = new File([new Uint8Array([0, 0, 0, 0])], "foto.avif", { type: "image/avif" });
    expect(await compressImageFile(avif)).toBe(avif);
  });
});
