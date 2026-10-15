import { MercadoPagoConfig, Payment } from "mercadopago";
import { getActiveAccessToken } from "./config.js";

/**
 * Cliente oficial do Mercado Pago (backend).
 *
 * O Access Token fica SOMENTE aqui, lido do ambiente ATIVO (sandbox x producao)
 * e validado quanto ao formato antes do uso. Nunca e logado nem enviado ao
 * frontend. O cliente e reaproveitado entre chamadas.
 */
let cachedToken: string | null = null;
let cachedPayment: Payment | null = null;

export function getPaymentClient(): Payment {
  // `getActiveAccessToken()` lanca se a credencial estiver ausente ou se o
  // formato nao corresponder ao ambiente (ex.: APP_USR- em sandbox).
  const token = getActiveAccessToken();
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
