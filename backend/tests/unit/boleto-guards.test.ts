import { describe, expect, it, vi } from "vitest";
import { createOrder } from "../../src/modules/orders/order.service.js";
import { createGuestPedido } from "../../src/services/orders.js";
import { startPedidoPayment } from "../../src/services/pedido-payments.js";
import { prisma } from "../../src/db.js";

/**
 * Guardas de SERVICO (nao apenas de rota): o boleto desativado precisa falhar
 * antes de qualquer acesso ao banco ou ao gateway, em TODOS os fluxos que
 * criam pedido / iniciam pagamento.
 */
describe("bloqueio do boleto nas camadas de servico", () => {
  it("createOrder rejeita BOLETO antes de consultar o banco", async () => {
    const spy = vi.spyOn(prisma.order, "findUnique");

    await expect(
      createOrder("usuario-sem-banco", { paymentMethod: "BOLETO" } as never),
    ).rejects.toMatchObject({ statusCode: 422 });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("createGuestPedido rejeita BOLETO antes de consultar produtos/frete", async () => {
    const spy = vi.spyOn(prisma.product, "findMany");

    await expect(
      createGuestPedido({ produtos: [], pagamento: { metodo: "BOLETO" } } as never),
    ).rejects.toMatchObject({ statusCode: 422 });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("startPedidoPayment rejeita BOLETO antes de buscar o pedido", async () => {
    const spy = vi.spyOn(prisma.pedido, "findUnique");

    await expect(
      startPedidoPayment(999_999, { metodo: "BOLETO", idempotencyKey: "idem-guarda-servico" }),
    ).rejects.toMatchObject({ statusCode: 422 });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
