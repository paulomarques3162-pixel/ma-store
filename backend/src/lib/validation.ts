import { z } from "zod";
import { validationError } from "./errors.js";
import { ORDER_STATUSES } from "./order-status.js";

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

/** Remove tudo que nao for digito. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Normaliza CEP ("00000-000" -> "00000000") ou lanca erro de validacao. */
export function normalizeCep(input: string): string {
  const digits = onlyDigits(input);
  if (digits.length !== 8) {
    throw validationError("CEP inválido. Informe 8 dígitos.");
  }
  return digits;
}

export function isValidCep(input: string): boolean {
  return onlyDigits(input).length === 8;
}

export function isValidUf(value: string): boolean {
  return (UFS as readonly string[]).includes(value.toUpperCase());
}

/** WhatsApp: 10 a 13 digitos (com ou sem DDI/DDD). */
export function isValidWhatsapp(value: string): boolean {
  const digits = onlyDigits(value);
  return digits.length >= 10 && digits.length <= 13;
}

const cepField = z
  .string()
  .trim()
  .transform((value) => onlyDigits(value))
  .refine((value) => value.length === 8, { message: "Informe um CEP valido (8 digitos)." });

const ufField = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => (UFS as readonly string[]).includes(value), { message: "UF invalida." });

export const customerSchema = z.object({
  nome: z.string().trim().min(3, "Informe o nome completo.").max(200),
  whatsapp: z
    .string()
    .trim()
    .refine((value) => isValidWhatsapp(value), { message: "Informe um WhatsApp valido com DDD." }),
  email: z
    .string()
    .trim()
    .email("Informe um e-mail valido.")
    .max(200)
    .optional()
    .or(z.literal("")),
});

export const addressSchema = z.object({
  cep: cepField,
  logradouro: z.string().trim().min(2, "Informe o logradouro.").max(200),
  numero: z.string().trim().min(1, "Informe o numero.").max(30),
  complemento: z.string().trim().max(120).optional().or(z.literal("")),
  bairro: z.string().trim().min(2, "Informe o bairro.").max(150),
  cidade: z.string().trim().min(2, "Informe a cidade.").max(150),
  uf: ufField,
});

export const productItemSchema = z.object({
  id: z.string().trim().min(1, "Produto invalido.").max(120),
  nome: z.string().trim().max(255).optional(),
  quantidade: z.coerce.number().int("Quantidade deve ser inteira.").positive("Quantidade deve ser maior que zero.").max(999),
  preco: z.coerce.number().nonnegative("Preco invalido.").optional(),
  peso_unitario: z.coerce.number().nonnegative("Peso invalido.").optional(),
});

export const shippingQuoteSchema = z.object({
  cep: cepField,
  items: z.array(productItemSchema).max(200).default([]),
});

export const createPedidoSchema = z.object({
  cliente: customerSchema,
  endereco: addressSchema,
  produtos: z.array(productItemSchema).min(1, "Informe ao menos um produto.").max(200),
  frete: z
    .object({
      id: z.string().trim().max(60).optional(),
      nome: z.string().trim().max(255).optional(),
      valor: z.coerce.number().nonnegative().optional(),
      prazo: z.string().trim().max(255).optional(),
    })
    .optional(),
  observacoes: z.string().trim().max(500).optional().or(z.literal("")),
});

export const adminUpdatePedidoSchema = z.object({
  status_atual: z.enum(ORDER_STATUSES),
  recebido_por: z.string().trim().max(255).optional().or(z.literal("")),
});

export type CreatePedidoInput = z.infer<typeof createPedidoSchema>;
export type ShippingQuoteInput = z.infer<typeof shippingQuoteSchema>;
export type AdminUpdatePedidoInput = z.infer<typeof adminUpdatePedidoSchema>;
