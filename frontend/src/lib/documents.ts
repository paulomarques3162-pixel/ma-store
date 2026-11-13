/**
 * Validação de CPF/CNPJ no navegador.
 *
 * A validação do servidor é a autoritativa (e existe — ver
 * `backend/src/lib/documents.ts`). Esta cópia serve para dar feedback imediato
 * ao cliente antes de enviar o checkout, evitando uma cobrança recusada no
 * Mercado Pago por documento inválido.
 *
 * Mesmas regras: apenas dígitos, rejeita sequências repetidas e confere os
 * dígitos verificadores (módulo 11).
 */

export function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function allSameDigits(value: string): boolean {
  return value.length > 0 && new Set(value).size === 1;
}

export function isValidCpf(value: string | null | undefined): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || allSameDigits(cpf)) return false;

  const digits = cpf.split("").map(Number);
  const first = (() => {
    let sum = 0;
    for (let i = 0; i < 9; i += 1) sum += digits[i]! * (10 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  })();
  if (first !== digits[9]) return false;

  let sum = 0;
  for (let i = 0; i < 10; i += 1) sum += digits[i]! * (11 - i);
  const rest = (sum * 10) % 11;
  return (rest === 10 ? 0 : rest) === digits[10];
}

export function isValidCnpj(value: string | null | undefined): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || allSameDigits(cnpj)) return false;

  const digits = cnpj.split("").map(Number);
  const compute = (length: number): number => {
    let weight = length - 7;
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      sum += digits[i]! * weight;
      weight -= 1;
      if (weight < 2) weight = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return compute(12) === digits[12] && compute(13) === digits[13];
}

/** Aceita CPF (11 dígitos) ou CNPJ (14 dígitos) válidos. */
export function isValidDocument(value: string | null | undefined): boolean {
  const digits = onlyDigits(value);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

/** "CPF" | "CNPJ" a partir da quantidade de dígitos (null quando inválido). */
export function documentTypeOf(value: string | null | undefined): "CPF" | "CNPJ" | null {
  const digits = onlyDigits(value);
  if (digits.length === 11) return "CPF";
  if (digits.length === 14) return "CNPJ";
  return null;
}
