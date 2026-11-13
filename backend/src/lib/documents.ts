/**
 * Validacao de CPF/CNPJ (documento do pagador).
 *
 * O Mercado Pago REJEITA boleto/PIX com documento invalido, e a mensagem que
 * volta do gateway e generica ("invalid payer identification"). Validar o
 * digito verificador ANTES de chamar o gateway evita uma cobranca recusada,
 * deixa a mensagem clara para o cliente e protege a conta contra lixo.
 *
 * Regras aplicadas:
 *  - remove qualquer mascara (pontos, tracos, barras);
 *  - exige 11 (CPF) ou 14 (CNPJ) digitos;
 *  - rejeita sequencias repetidas (000.000.000-00, 111.111.111-11, ...);
 *  - confere os digitos verificadores pelo modulo 11 oficial.
 */

export function documentDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function allSameDigits(value: string): boolean {
  return value.length > 0 && new Set(value).size === 1;
}

/** Confere os dois digitos verificadores do CPF (modulo 11, pesos 10..2 / 11..2). */
export function isValidCpf(value: string | null | undefined): boolean {
  const cpf = documentDigits(value);
  if (cpf.length !== 11 || allSameDigits(cpf)) return false;

  const digits = cpf.split("").map(Number);
  const firstCheck = (() => {
    let sum = 0;
    for (let index = 0; index < 9; index += 1) sum += digits[index]! * (10 - index);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  })();
  if (firstCheck !== digits[9]) return false;

  let sum = 0;
  for (let index = 0; index < 10; index += 1) sum += digits[index]! * (11 - index);
  const secondRest = (sum * 10) % 11;
  const secondCheck = secondRest === 10 ? 0 : secondRest;
  return secondCheck === digits[10];
}

/** Confere os dois digitos verificadores do CNPJ (modulo 11, pesos 5..2 repetidos). */
export function isValidCnpj(value: string | null | undefined): boolean {
  const cnpj = documentDigits(value);
  if (cnpj.length !== 14 || allSameDigits(cnpj)) return false;

  const digits = cnpj.split("").map(Number);
  const compute = (length: number): number => {
    let weight = length - 7;
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += digits[index]! * weight;
      weight -= 1;
      if (weight < 2) weight = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return compute(12) === digits[12] && compute(13) === digits[13];
}

/** `true` quando o documento tem 11 digitos e e um CPF valido. */
export function isValidDocument(value: string | null | undefined): boolean {
  const digits = documentDigits(value);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

/** Tipo do documento a partir da quantidade de digitos (null = invalido). */
export function documentTypeOf(value: string | null | undefined): "CPF" | "CNPJ" | null {
  const digits = documentDigits(value);
  if (digits.length === 11) return "CPF";
  if (digits.length === 14) return "CNPJ";
  return null;
}
