import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listUploads } from "../../src/services/storage";
import { generateSku } from "../../src/modules/catalog/catalog.service";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mastore-uploads-"));
  await writeFile(join(dir, "b.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0x00]));
  await writeFile(join(dir, "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(join(dir, "notes.txt"), "não é imagem");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("listUploads (biblioteca de imagens)", () => {
  it("lista apenas imagens e ignora outros arquivos", async () => {
    const result = await listUploads({ directory: dir, page: 1, perPage: 10 });
    expect(result.items.map((item) => item.filename).sort()).toEqual(["a.png", "b.jpg"]);
    expect(result.total).toBe(2);
    expect(result.items[0]!.url).toMatch(/^\/uploads\//);
    expect(result.items[0]!.size).toBeGreaterThan(0);
  });

  it("pagina os resultados", async () => {
    const result = await listUploads({ directory: dir, page: 2, perPage: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result.page).toBe(2);
  });

  it("busca por nome do arquivo", async () => {
    const result = await listUploads({ directory: dir, search: "a.png" });
    expect(result.items.map((item) => item.filename)).toEqual(["a.png"]);
  });

  it("diretório inexistente devolve resultado vazio (nunca lança)", async () => {
    const result = await listUploads({ directory: join(dir, "nao-existe") });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe("generateSku", () => {
  it("gera um SKU legível a partir do nome", () => {
    expect(generateSku("Perfume Asad Bourbon 100ml")).toMatch(/^PERFUME-ASAD-BOURBON-100ML-[A-Z0-9]+$/);
  });

  it("usa PRODUTO quando o nome não gera base válida", () => {
    expect(generateSku("///")).toMatch(/^PRODUTO-[A-Z0-9]+$/);
  });
});
