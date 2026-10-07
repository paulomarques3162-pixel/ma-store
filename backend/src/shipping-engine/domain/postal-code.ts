import type { Brand } from "./brand.js";
import { invalidPostalCode } from "./errors.js";

/** CEP brasileiro normalizado (somente 8 dígitos). */
export type PostalCode = Brand<string, "PostalCode">;

export const POSTAL_CODE_LENGTH = 8;

/** Remove máscara e qualquer caractere que não seja dígito. */
export function postalCodeDigits(input: string): string {
  return String(input ?? "").replace(/\D/g, "");
}

export function isValidPostalCode(input: string): boolean {
  return postalCodeDigits(input).length === POSTAL_CODE_LENGTH;
}

/** Valida e normaliza (aceita com ou sem máscara). Lança `INVALID_POSTAL_CODE`. */
export function normalizePostalCode(input: string): PostalCode {
  const digits = postalCodeDigits(input);
  if (digits.length !== POSTAL_CODE_LENGTH) {
    throw invalidPostalCode();
  }
  return digits as PostalCode;
}

/** Formata para exibição: `12345678` -> `12345-678`. */
export function formatPostalCode(input: string): string {
  const digits = postalCodeDigits(input);
  if (digits.length !== POSTAL_CODE_LENGTH) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}
