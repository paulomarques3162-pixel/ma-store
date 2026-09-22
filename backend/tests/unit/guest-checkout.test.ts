import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  buildOrderTimeline,
  isOrderStatus,
} from "../../src/lib/order-status";
import {
  isValidCep,
  isValidUf,
  isValidWhatsapp,
  createPedidoSchema,
  shippingQuoteSchema,
} from "../../src/lib/validation";
import { calculateWeightKg } from "../../src/services/shipping/weight";
import { flexEligible } from "../../src/services/shipping/flex";

describe("ORDER_STATUSES (fonte unica)", () => {
  it("possui exatamente os cinco estados na ordem correta", () => {
    expect(ORDER_STATUSES).toEqual([
      "Aguardando Pagamento",
      "Empacotando Produto",
      "Pronto para Envio",
      "Saiu para Entrega",
      "Entregue",
    ]);
  });

  it("reconhece apenas status validos", () => {
    expect(isOrderStatus("Entregue")).toBe(true);
    expect(isOrderStatus("DELIVERED")).toBe(false);
    expect(isOrderStatus(42)).toBe(false);
  });

  it("monta a timeline marcando concluidas, atual e futuras", () => {
    const timeline = buildOrderTimeline("Saiu para Entrega");
    expect(timeline.map((step) => step.status)).toEqual([...ORDER_STATUSES]);
    expect(timeline.filter((step) => step.done)).toHaveLength(3);
    expect(timeline.filter((step) => step.current)).toHaveLength(1);
    expect(timeline.find((step) => step.current)?.status).toBe("Saiu para Entrega");
    expect(timeline.filter((step) => step.future)).toHaveLength(1);
  });

  it("nao quebra com status desconhecido (assume a primeira etapa)", () => {
    const timeline = buildOrderTimeline("StatusInventado");
    expect(timeline).toHaveLength(5);
    expect(timeline[0]?.current).toBe(true);
  });
});

describe("peso do frete", () => {
  it("soma peso unitario x quantidade + 100g de embalagem", () => {
    // 2 x 0.350 = 0.700 + 0.100 = 0.800
    expect(calculateWeightKg([{ id: "p", nome: "x", quantidade: 2, peso_unitario: 0.35 }])).toBe(0.8);
  });

  it("ignora itens com peso/quantidade invalidos", () => {
    expect(calculateWeightKg([{ id: "p", nome: "x", quantidade: -1, peso_unitario: 0.5 }])).toBe(0.1);
  });
});

describe("regra do Motoboy/Flex", () => {
  it("so e elegivel quando o CEP pertence a faixa configurada", () => {
    expect(flexEligible("13630000")).toBe(true);
    expect(flexEligible("01001000")).toBe(false);
  });
});

describe("validacoes", () => {
  it("valida CEP, UF e WhatsApp", () => {
    expect(isValidCep("13630-000")).toBe(true);
    expect(isValidCep("123")).toBe(false);
    expect(isValidUf("sp")).toBe(true);
    expect(isValidUf("XX")).toBe(false);
    expect(isValidWhatsapp("(19) 99999-9999")).toBe(true);
    expect(isValidWhatsapp("123")).toBe(false);
  });

  it("rejeita quantidade negativa e CEP invalido no pedido", () => {
    const base = {
      cliente: { nome: "Maria Silva", whatsapp: "19999999999" },
      endereco: {
        cep: "13630000",
        logradouro: "Rua A",
        numero: "10",
        bairro: "Centro",
        cidade: "Pirassununga",
        uf: "SP",
      },
      produtos: [{ id: "p1", quantidade: 2 }],
    };

    expect(createPedidoSchema.safeParse(base).success).toBe(true);

    const negativo = { ...base, produtos: [{ id: "p1", quantidade: -3 }] };
    expect(createPedidoSchema.safeParse(negativo).success).toBe(false);

    const cepRuim = { ...base, endereco: { ...base.endereco, cep: "abc" } };
    expect(createPedidoSchema.safeParse(cepRuim).success).toBe(false);
  });

  it("aceita a cotacao de frete com itens do carrinho", () => {
    const result = shippingQuoteSchema.safeParse({
      cep: "13630-000",
      items: [{ id: "p1", nome: "Perfume", quantidade: 1, peso_unitario: 0.35 }],
    });
    expect(result.success).toBe(true);
  });
});
