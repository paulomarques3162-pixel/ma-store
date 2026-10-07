import { loadMercadoPago } from "@mercadopago/sdk-js";

/**
 * Integracao com o SDK oficial do Mercado Pago no navegador.
 *
 * Responsabilidade unica: tokenizar o cartao. O numero, a validade e o CVV
 * NUNCA sao enviados ao backend da MA STORE — apenas o token gerado aqui.
 * A Public Key e publica por definicao; o Access Token e o Webhook Secret
 * jamais chegam ao frontend.
 */

export type CardTokenInput = {
  cardNumber: string;
  cardholderName: string;
  cardExpirationMonth: string;
  cardExpirationYear: string;
  securityCode: string;
  identificationType: string;
  identificationNumber: string;
};

export type CardTokenResult = {
  id: string;
  paymentMethodId?: string;
  issuerId?: string;
};

type MercadoPagoInstance = {
  createCardToken: (data: Record<string, string>) => Promise<{
    id?: string;
    payment_method_id?: string;
    issuer_id?: string | number;
  }>;
};

type MercadoPagoConstructor = new (publicKey: string, options?: Record<string, unknown>) => MercadoPagoInstance;

let instancePromise: Promise<MercadoPagoInstance> | null = null;

/** Carrega o SDK oficial uma unica vez e instancia com a Public Key. */
export async function getMercadoPago(publicKey: string): Promise<MercadoPagoInstance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const loaded = (await loadMercadoPago()) as unknown;
      const candidate =
        typeof loaded === "function"
          ? loaded
          : ((loaded as { default?: unknown } | null)?.default ?? (globalThis as { MercadoPago?: unknown }).MercadoPago);
      if (typeof candidate !== "function") {
        throw new Error("Nao foi possivel carregar o SDK do Mercado Pago.");
      }
      return new (candidate as MercadoPagoConstructor)(publicKey, { locale: "pt-BR" });
    })().catch((error) => {
      // Permite tentar novamente numa proxima submissao.
      instancePromise = null;
      throw error;
    });
  }
  return instancePromise;
}

/** Tokeniza os dados do cartao e devolve apenas o token. */
export async function tokenizeCard(publicKey: string, input: CardTokenInput): Promise<CardTokenResult> {
  const mercadoPago = await getMercadoPago(publicKey);
  const token = await mercadoPago.createCardToken({
    cardNumber: input.cardNumber.replace(/\D/g, ""),
    cardholderName: input.cardholderName,
    cardExpirationMonth: input.cardExpirationMonth,
    cardExpirationYear: input.cardExpirationYear,
    securityCode: input.securityCode,
    identificationType: input.identificationType,
    identificationNumber: input.identificationNumber.replace(/\D/g, ""),
  });

  if (!token?.id) {
    throw new Error("Não foi possível validar o cartão. Confira os dados e tente novamente.");
  }

  return {
    id: token.id,
    paymentMethodId: token.payment_method_id,
    issuerId: token.issuer_id !== undefined ? String(token.issuer_id) : undefined,
  };
}
