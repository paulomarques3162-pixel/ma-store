import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { env } from "../env.js";
import { deliveryError, validationError } from "../lib/errors.js";
import { MIME_BY_EXT, validateImage } from "./storage.js";

/**
 * Prova de entrega (foto do motoboy).
 *
 * Armazenamento PRIVADO: os arquivos NAO ficam no diretorio publico `/uploads`.
 * Sao gravados em `DELIVERY_PROOF_DIR` e servidos apenas pelo endpoint
 * autenticado `GET /api/delivery/:id/proof` (ADMIN ou entregador responsavel).
 *
 * Validacoes (nunca confia no nome/MIME do cliente): magic bytes, tamanho e
 * dimensoes — reaproveita `validateImage` do modulo de storage existente.
 */

const REF_PREFIX = "delivery-proofs";

export type SavedDeliveryProof = {
  /** Referencia interna gravada no banco. Nunca e uma URL publica. */
  ref: string;
  mime: string;
  width: number;
  height: number;
  size: number;
};

function safeSegment(value: string): string {
  // IDs sao cuids/ints; sanitizamos por precaucao contra path traversal.
  return value.replace(/[^A-Za-z0-9_-]/g, "");
}

function proofBaseDir(): string {
  return resolve(process.cwd(), env.DELIVERY_PROOF_DIR);
}

/** Valida e grava a foto da prova. Lanca AppError (422) quando invalida. */
export async function saveDeliveryProof(deliveryId: string, buffer: Uint8Array): Promise<SavedDeliveryProof> {
  const maxBytes = env.UPLOAD_MAX_MB * 1024 * 1024;
  const result = validateImage(buffer, maxBytes);
  if (!result.ok) throw validationError(result.reason ?? "Imagem invalida.");

  const segment = safeSegment(deliveryId);
  if (!segment) throw validationError("Entrega invalida.");

  const dir = resolve(proofBaseDir(), segment);
  const filename = `${Date.now()}-${randomBytes(8).toString("hex")}.${result.ext}`;
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, filename), buffer);

  return {
    ref: `${REF_PREFIX}/${segment}/${filename}`,
    mime: result.mime!,
    width: result.width!,
    height: result.height!,
    size: buffer.length,
  };
}

/** Confere se a referencia pertence a entrega informada (anti path traversal). */
export function proofRefBelongsToDelivery(ref: string, deliveryId: string): boolean {
  const expected = `${REF_PREFIX}/${safeSegment(deliveryId)}/`;
  if (!ref.startsWith(expected)) return false;
  const rest = ref.slice(expected.length);
  return /^[A-Za-z0-9._-]+$/.test(rest) && !rest.includes("..");
}

export async function readDeliveryProof(ref: string): Promise<{ buffer: Buffer; mime: string }> {
  if (!ref.startsWith(`${REF_PREFIX}/`)) throw deliveryError("DELIVERY_NOT_FOUND", "Prova de entrega nao encontrada.");

  const relative = ref.slice(REF_PREFIX.length + 1);
  const base = proofBaseDir();
  const target = resolve(base, relative);
  // Nunca sai do diretorio de provas.
  if (target !== base && !target.startsWith(base + sep)) {
    throw deliveryError("DELIVERY_NOT_FOUND", "Prova de entrega nao encontrada.");
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(target);
  } catch {
    throw deliveryError("DELIVERY_NOT_FOUND", "Prova de entrega nao encontrada.");
  }

  const ext = extname(target).slice(1).toLowerCase();
  return { buffer, mime: MIME_BY_EXT[ext] ?? "application/octet-stream" };
}

/** Remove uma prova (best-effort, usado em reenvio antes da confirmacao). */
export async function deleteDeliveryProof(ref: string): Promise<void> {
  if (!ref.startsWith(`${REF_PREFIX}/`)) return;
  const base = proofBaseDir();
  const target = resolve(base, ref.slice(REF_PREFIX.length + 1));
  if (target !== base && !target.startsWith(base + sep)) return;
  try {
    await rm(target, { force: true });
  } catch {
    /* prova orfa nao bloqueia o fluxo */
  }
}
