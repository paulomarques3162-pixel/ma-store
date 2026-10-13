import { describe, expect, it } from "vitest";
import {
  buildSignatureHeader,
  buildSignatureManifest,
  parseSignatureHeader,
  verifyMercadoPagoSignature,
} from "../../src/services/mercadopago/signature";
import { mapMercadoPagoStatus, mapPedidoPaymentLabel } from "../../src/services/mercadopago/status-map";
import { normalizeMercadoPagoError } from "../../src/services/mercadopago/errors";
import { getMercadoPagoStatus } from "../../src/services/mercadopago/config";

const SECRET = "webhook-secret-de-teste";

describe("Mercado Pago — assinatura do webhook", () => {
  it("monta o manifesto no formato oficial (id/request-id/ts)", () => {
    expect(buildSignatureManifest({ dataId: "123", requestId: "req-1", ts: "1700000000" })).toBe(
      "id:123;request-id:req-1;ts:1700000000;",
    );
  });

  it("faz o parse do cabecalho x-signature", () => {
    expect(parseSignatureHeader("ts=1700000000,v1=abc")).toEqual({ ts: "1700000000", v1: "abc" });
    expect(parseSignatureHeader("invalido")).toBeNull();
    expect(parseSignatureHeader(undefined)).toBeNull();
  });

  it("ACEITA uma assinatura valida", () => {
    const signature = buildSignatureHeader({ dataId: "999", requestId: "req-42", secret: SECRET, ts: "1700000000" });
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: signature,
        requestId: "req-42",
        dataId: "999",
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("REJEITA assinatura invalida ou ausente", () => {
    const signature = buildSignatureHeader({ dataId: "999", requestId: "req-42", secret: SECRET });
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: signature,
        requestId: "outro-request",
        dataId: "999",
        secret: SECRET,
      }),
    ).toBe(false);
    expect(
      verifyMercadoPagoSignature({ signatureHeader: undefined, requestId: "req-42", dataId: "999", secret: SECRET }),
    ).toBe(false);
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: signature,
        requestId: "req-42",
        dataId: "999",
        secret: "segredo-errado",
      }),
    ).toBe(false);
  });
});

describe("Mercado Pago — mapeamento de status", () => {
  it("mapeia todos os estados relevantes", () => {
    expect(mapMercadoPagoStatus("approved")).toBe("APPROVED");
    expect(mapMercadoPagoStatus("pending")).toBe("PENDING");
    expect(mapMercadoPagoStatus("in_process")).toBe("PENDING");
    expect(mapMercadoPagoStatus("rejected")).toBe("DECLINED");
    expect(mapMercadoPagoStatus("cancelled")).toBe("CANCELED");
    expect(mapMercadoPagoStatus("expired")).toBe("EXPIRED");
    expect(mapMercadoPagoStatus("refunded")).toBe("REFUNDED");
    expect(mapMercadoPagoStatus("charged_back")).toBe("REFUNDED");
    expect(mapMercadoPagoStatus("desconhecido")).toBe("PENDING");
    expect(mapMercadoPagoStatus(null)).toBe("PENDING");
  });

  it("traduz para o rotulo do pedido Guest", () => {
    expect(mapPedidoPaymentLabel("APPROVED")).toBe("Pago");
    expect(mapPedidoPaymentLabel("DECLINED")).toBe("Recusado");
    expect(mapPedidoPaymentLabel("PENDING")).toBe("Pendente");
  });
});

describe("Mercado Pago — tratamento de erros", () => {
  it("converte timeout/autenticacao/validacao em mensagens seguras", () => {
    expect(normalizeMercadoPagoError({ message: "request timeout", status: 0 }).message).toMatch(/demorou/i);
    expect(normalizeMercadoPagoError({ status: 401 }).message).toMatch(/autenticacao/i);
    expect(normalizeMercadoPagoError({ status: 400, cause: [{ code: "1", description: "x" }] }).causeCodes).toEqual(["1"]);
    expect(normalizeMercadoPagoError({ status: 500 }).message).toMatch(/indisponivel/i);
  });
});

describe("Mercado Pago — configuracao", () => {
  it("nao considera habilitado sem credenciais completas", () => {
    const status = getMercadoPagoStatus();
    // A suite roda com PAYMENT_PROVIDER=mock e sem credenciais reais.
    expect(status.provider).toBe("mock");
    expect(status.enabled).toBe(false);
    expect(status.configured).toBe(false);
    expect(status.missing.length).toBeGreaterThan(0);
  });
});
