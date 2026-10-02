import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, createAdmin, createClient, db, makeApp, resetDatabase } from "../helpers";

/**
 * Integração HTTP real (servidor ouvindo, upload multipart via FormData):
 * valida TODA a cadeia do upload de imagens — POST /api/admin/uploads,
 * gravação em disco, rota pública GET /uploads/:arquivo e biblioteca.
 */

let app: FastifyInstance;
let baseUrl: string;
let admin: { token: string; id: string };
let uploadsDir: string;
const uploadedFiles: string[] = [];

/** PNG mínimo com IHDR válido (o `image-size` lê as dimensões daqui). */
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

beforeAll(async () => {
  app = await makeApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Não foi possível obter a porta do servidor.");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const { env } = await import("../../src/env.js");
  uploadsDir = resolve(process.cwd(), env.STORAGE_LOCAL_DIR);
});

afterAll(async () => {
  await app.close();
  for (const filename of uploadedFiles) {
    await rm(resolve(uploadsDir, filename), { force: true });
  }
  const prisma = await db();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  admin = await createAdmin(app);
});

async function upload(
  file: { bytes: Uint8Array; type: string; name: string },
  token?: string,
): Promise<{ status: number; body: { data?: { url?: string; filename?: string }; error?: { code: string; message: string } } }> {
  const form = new FormData();
  form.append("file", new Blob([file.bytes], { type: file.type }), file.name);
  const response = await fetch(`${baseUrl}/api/admin/uploads`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const body = (await response.json().catch(() => null)) as {
    data?: { url?: string; filename?: string };
    error?: { code: string; message: string };
  };
  return { status: response.status, body: body ?? {} };
}

describe("upload de imagens (HTTP real)", () => {
  it("faz upload de PNG, grava no disco e serve pela rota pública /uploads", async () => {
    const result = await upload({ bytes: pngBuffer(), type: "image/png", name: "foto.png" }, admin.token);

    expect(result.status).toBe(201);
    const url = result.body.data?.url;
    expect(url).toMatch(/^\/uploads\/[A-Za-z0-9._-]+\.png$/);
    if (url) uploadedFiles.push(url.split("/").pop()!);

    // A URL retornada PRECISA ser acessível — é o ponto que quebrava (404).
    const image = await fetch(`${baseUrl}${url}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type") ?? "").toContain("image/png");
    const bytes = new Uint8Array(await image.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("a biblioteca lista o arquivo enviado", async () => {
    const result = await upload({ bytes: pngBuffer(), type: "image/png", name: "listada.png" }, admin.token);
    const filename = result.body.data?.filename;
    expect(filename).toBeTruthy();
    if (filename) uploadedFiles.push(filename);

    const response = await api(app, { method: "GET", url: `/api/admin/uploads?search=${filename}`, token: admin.token });
    expect(response.status).toBe(200);
    const items = (response.body.data as { items: Array<{ filename: string; url: string }> }).items;
    expect(items.some((item) => item.filename === filename)).toBe(true);
  });

  it("recusa arquivo que não é imagem (422)", async () => {
    const result = await upload(
      { bytes: new TextEncoder().encode("<?php echo 'x'; ?>"), type: "image/png", name: "malicioso.png" },
      admin.token,
    );
    expect(result.status).toBe(422);
    expect(result.body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("exige autenticação (401)", async () => {
    const result = await upload({ bytes: pngBuffer(), type: "image/png", name: "sem-token.png" });
    expect(result.status).toBe(401);
  });

  it("recusa usuário CLIENT (403)", async () => {
    const client = await createClient(app);
    const result = await upload({ bytes: pngBuffer(), type: "image/png", name: "cliente.png" }, client.accessToken);
    expect(result.status).toBe(403);
  });

  it("arquivo inexistente em /uploads devolve 404 no formato da API", async () => {
    const response = await fetch(`${baseUrl}/uploads/nao-existe-${Date.now()}.png`);
    expect(response.status).toBe(404);
    const body = (await response.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    expect(body?.error?.code).toBe("NOT_FOUND");
  });
});
