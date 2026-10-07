/**
 * Shipping Engine PROPRIO — dominio puro (sem banco, sem HTTP).
 *
 * Tudo aqui e deterministico e testavel isoladamente. Nenhum valor comercial
 * e definido neste arquivo: apenas normalizacao/validacao e calculos.
 */
import { shippingError } from "../../lib/errors.js";

/** Remove tudo que nao for digito. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Normaliza CEP: aceita "13610-000" e "13610000"; devolve "13610000".
 * Lanca INVALID_ZIP_CODE quando nao houver exatamente 8 digitos.
 */
export function normalizeZipCode(input: string): string {
  const digits = onlyDigits(String(input ?? ""));
  if (digits.length !== 8) {
    throw shippingError("INVALID_ZIP_CODE", "Informe um CEP valido (8 digitos).");
  }
  return digits;
}

export function isValidZipCode(input: string): boolean {
  return onlyDigits(String(input ?? "")).length === 8;
}

/** Converte CEP normalizado em inteiro de 8 digitos (para comparacao de faixa). */
export function zipCodeToInt(input: string): number {
  const digits = normalizeZipCode(input);
  return Number.parseInt(digits, 10);
}

export function formatZipCode(input: string): string {
  const digits = onlyDigits(String(input ?? ""));
  if (digits.length !== 8) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}
