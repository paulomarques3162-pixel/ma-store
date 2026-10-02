/**
 * PIX estático — geração do BR Code (EMV, padrão Banco Central).
 *
 * Isto NÃO é uma cobrança com confirmação automática: é o "copia e cola"/QR
 * que aponta para a CHAVE PIX configurada pela loja. O valor cai direto na
 * conta do recebedor e a confirmação é manual (app do banco) ou por webhook do
 * banco/provedor. NUNCA marcamos o pedido como pago só porque o QR foi gerado.
 *
 * Referência: especificação EMV® QRCPS-MPM / BR Code (BACEN).
 */

function tlv(id: string, value: string): string {
  const length = value.length.toString().padStart(2, "0");
  return `${id}${length}${value}`;
}

/** CRC16/CCITT-FALSE — obrigatório no campo 63 do BR Code. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function sanitize(text: string, maxLength: number): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 .,-]/g, "")
    .trim()
    .slice(0, maxLength);
}

function normalizeTxid(value: string | undefined): string {
  const clean = (value ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25);
  return clean.length > 0 ? clean : "***";
}

export type PixPayloadInput = {
  key: string;
  merchantName: string;
  merchantCity: string;
  amount?: number;
  txid?: string;
  description?: string;
};

export function buildPixPayload(input: PixPayloadInput): string {
  const key = input.key.trim();
  if (!key) throw new Error("Chave PIX não configurada.");

  const name = sanitize(input.merchantName, 25);
  const city = sanitize(input.merchantCity, 15);
  if (!name) throw new Error("Nome do recebedor PIX não configurado.");
  if (!city) throw new Error("Cidade do recebedor PIX não configurada.");

  const merchantAccount =
    tlv("00", "br.gov.bcb.pix") +
    tlv("01", key) +
    (input.description ? tlv("02", sanitize(input.description, 40)) : "");

  const amount = input.amount && input.amount > 0 ? tlv("54", input.amount.toFixed(2)) : "";
  const txid = tlv("05", normalizeTxid(input.txid));

  const payload =
    tlv("00", "01") +
    tlv("26", merchantAccount) +
    tlv("52", "0000") +
    tlv("53", "986") +
    amount +
    tlv("58", "BR") +
    tlv("59", name) +
    tlv("60", city) +
    tlv("62", txid) +
    "6304";

  return `${payload}${crc16(payload)}`;
}

/** Gera o QR Code (data URL PNG) do BR Code. */
export async function pixQrDataUrl(payload: string): Promise<string> {
  const { default: QRCode } = await import("qrcode");
  return QRCode.toDataURL(payload, { margin: 1, width: 260, errorCorrectionLevel: "M" });
}
