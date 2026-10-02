/**
 * Validacao da cotacao no fechamento do pedido.
 *
 * Regra de seguranca central: o preco do frete vem SEMPRE das opcoes gravadas
 * na cotacao (PostgreSQL), nunca do frontend. A cotacao tem validade, pertence
 * a uma sessao opaca e so pode ser usada uma vez (idempotencia por quoteId).
 */
import { prisma } from "../../db.js";
import { shippingError } from "../../lib/errors.js";
import { decimalToNumber } from "../../lib/serialize.js";

export type QuoteSelectionInput = {
  quoteId: string;
  shippingMethodId: string;
  sessionId?: string | null;
  /** Subtotal recalculado no servidor a partir do catalogo. */
  subtotal: number;
  /** Peso total recalculado no servidor. */
  totalWeightGrams: number;
};

export type ResolvedQuoteSelection = {
  quoteId: string;
  methodId: string;
  methodCode: string | null;
  methodName: string;
  methodDescription: string | null;
  price: number;
  deliveryDays: number | null;
  zoneId: string | null;
  ruleId: string | null;
};

/**
 * Valida e resolve uma selecao de frete a partir da cotacao persistida.
 * Lanca erro padronizado quando a cotacao nao existe, expirou, e de outra
 * sessao, ja foi usada ou nao contem a modalidade escolhida.
 */
export async function resolveQuoteSelection(input: QuoteSelectionInput): Promise<ResolvedQuoteSelection> {
  const quote = await prisma.shippingQuote.findUnique({
    where: { id: input.quoteId },
    include: { options: true },
  });

  if (!quote) {
    throw shippingError("SHIPPING_QUOTE_NOT_FOUND", "Cotacao de frete nao encontrada. Recalcule o frete.");
  }
  if (quote.usedAt) {
    throw shippingError("SHIPPING_QUOTE_INVALID", "Esta cotacao de frete ja foi utilizada. Recalcule o frete.");
  }
  if (quote.expiresAt.getTime() <= Date.now()) {
    throw shippingError("SHIPPING_QUOTE_EXPIRED", "A cotacao de frete expirou. Recalcule o frete.");
  }

  // Cotacao vinculada a uma sessao so pode ser usada pela mesma sessao.
  if (quote.sessionId && quote.sessionId !== (input.sessionId ?? null)) {
    throw shippingError("SHIPPING_QUOTE_INVALID", "Esta cotacao de frete pertence a outra sessao.");
  }

  // Revalidacao de integridade: peso/subtotal nao podem ter mudado desde a cotacao.
  const storedSubtotal = decimalToNumber(quote.subtotal);
  const subtotalChanged = Math.abs(storedSubtotal - input.subtotal) > 0.001;
  const weightChanged = Math.abs(quote.totalWeightGrams - input.totalWeightGrams) > 1;
  if (subtotalChanged || weightChanged) {
    throw shippingError(
      "SHIPPING_QUOTE_EXPIRED",
      "O carrinho mudou desde a cotacao de frete. Recalcule o frete.",
    );
  }

  const option = quote.options.find((entry) => entry.shippingMethodId === input.shippingMethodId);
  if (!option) {
    throw shippingError("SHIPPING_QUOTE_INVALID", "A modalidade escolhida nao esta nesta cotacao.");
  }

  // Modalidade precisa continuar ativa no momento do pedido.
  const method = await prisma.shippingMethod.findUnique({
    where: { id: input.shippingMethodId },
    select: { active: true },
  });
  if (!method || !method.active) {
    throw shippingError("SHIPPING_QUOTE_INVALID", "Esta modalidade de frete nao esta mais disponivel.");
  }

  return {
    quoteId: quote.id,
    methodId: option.shippingMethodId,
    methodCode: option.code,
    methodName: option.name,
    methodDescription: option.description,
    price: decimalToNumber(option.price),
    deliveryDays: option.deliveryDays,
    zoneId: option.zoneId,
    ruleId: option.ruleId,
  };
}

/** Busca o pedido ja criado com esta cotacao (idempotencia / duplo clique). */
export async function findPedidoByQuoteId(quoteId: string): Promise<number | null> {
  const existing = await prisma.pedido.findUnique({ where: { freteQuoteId: quoteId }, select: { id: true } });
  return existing?.id ?? null;
}
