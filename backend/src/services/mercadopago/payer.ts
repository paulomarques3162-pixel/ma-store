import type { Prisma } from "@prisma/client";
import type { MercadoPagoPayerAddress } from "./index.js";

/**
 * Extrai o endereco do pagador a partir do snapshot de endereco do pedido.
 *
 * O boleto (`bolbradesco`) EXIGE `zip_code`, `street_name`, `street_number`,
 * `neighborhood`, `city` e `federal_unit`. O snapshot do pedido pode ter sido
 * gravado em dois formatos historicos (`cep`/`logradouro` e `zipCode`/`street`),
 * entao aceitamos ambos — sem NUNCA inventar um endereco.
 *
 * Retorna `null` quando falta algum campo essencial; quem chama deve responder
 * 422 com mensagem clara em vez de deixar o gateway recusar.
 */
export function payerAddressFromSnapshot(endereco: Prisma.JsonValue | null | undefined): MercadoPagoPayerAddress | null {
  const record = (endereco ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };

  const zipCode = pick("cep", "zipCode", "postalCode").replace(/\D/g, "");
  const streetName = pick("logradouro", "street", "streetName");
  const streetNumber = pick("numero", "number", "streetNumber") || "S/N";
  const neighborhood = pick("bairro", "neighborhood");
  const city = pick("cidade", "city");
  const federalUnit = pick("uf", "state", "federalUnit").toUpperCase();
  const complement = pick("complemento", "complement");

  if (zipCode.length !== 8 || !streetName || !neighborhood || !city || federalUnit.length !== 2) {
    return null;
  }

  return {
    zipCode,
    streetName,
    streetNumber,
    neighborhood,
    city,
    federalUnit,
    ...(complement ? { complement } : {}),
  };
}

/** Divide "Nome Completo" em primeiro nome + sobrenome (sem perder o restante). */
export function splitFullName(fullName: string | null | undefined): { firstName?: string; lastName?: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
  };
}
