import { MercadoPagoConfig, Payment } from "mercadopago";
import { env } from "../../env.js";

/**
 * Cliente oficial do Mercado Pago (backend).
 *
 * O Access Token fica SOMENTE aqui, lido do ambiente, e nunca e logado nem
 * enviado ao frontend. O cliente e reaproveitado entre chamadas.
 */
let cachedToken: string | null = null;
let cachedPayment: Payment | null = null;

export function getPaymentClient(): Payment {
  const token = env.MERCADOPAGO_ACCESS_TOKEN.trim();
  if (!token) {
    throw new Error("MERCADOPAGO_ACCESS_TOKEN nao configurado.");
  }
  if (!cachedPayment || cachedToken !== token) {
    const config = new MercadoPagoConfig({
      accessToken: token,
      options: { timeout: 10_000 },
    });
    cachedPayment = new Payment(config);
    cachedToken = token;
  }
  return cachedPayment;
}
