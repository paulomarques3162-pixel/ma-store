import type { OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { badRequest, conflict, insufficientStock, notFound, validationError } from "../../lib/errors.js";
import { decimalToNumber } from "../../lib/serialize.js";
import * as cartService from "../cart/cart.service.js";
import { validateCoupon } from "../coupons/coupon.service.js";
import * as shipping from "../shipping/shipping.service.js";

type Tx = Prisma.TransactionClient;

// -----------------------------------------------------------------------------
// Estoque - operacoes atomicas
// -----------------------------------------------------------------------------

/**
 * Reserva estoque de forma ATOMICA.
 *
 * O `WHERE stock >= qty` faz o banco decidir: se dois clientes tentarem comprar
 * o ultimo item ao mesmo tempo, apenas um UPDATE afeta 1 linha e o outro recebe
 * 0 -> tratamos como estoque insuficiente. O estoque NUNCA fica negativo.
 */
async function reserveStock(tx: Tx, productId: string, quantity: number, productName: string) {
  const affected = await tx.$executeRaw`
    UPDATE "products"
       SET "stock" = "stock" - ${quantity},
           "reservedStock" = "reservedStock" + ${quantity},
           "updatedAt" = now()
     WHERE "id" = ${productId}
       AND "active" = true
       AND "stock" >= ${quantity}
  `;

  if (affected === 0) {
    throw insufficientStock(`Estoque insuficiente para ${productName}.`, { productId });
  }
}

/** Libera reserva (pedido cancelado) devolvendo ao estoque disponivel. */
async function releaseStock(tx: Tx, productId: string, quantity: number) {
  await tx.$executeRaw`
    UPDATE "products"
       SET "reservedStock" = GREATEST("reservedStock" - ${quantity}, 0),
           "stock" = "stock" + ${quantity},
           "updatedAt" = now()
     WHERE "id" = ${productId}
  `;
}

/** Confirma a venda (pagamento aprovado): reservado -> vendido. */
async function confirmSale(tx: Tx, productId: string, quantity: number) {
  await tx.$executeRaw`
    UPDATE "products"
       SET "reservedStock" = GREATEST("reservedStock" - ${quantity}, 0),
           "soldStock" = "soldStock" + ${quantity},
           "updatedAt" = now()
     WHERE "id" = ${productId}
  `;
}

/** Devolve itens de uma venda confirmada (reembolso). */
async function returnSoldStock(tx: Tx, productId: string, quantity: number) {
  await tx.$executeRaw`
    UPDATE "products"
       SET "soldStock" = GREATEST("soldStock" - ${quantity}, 0),
           "stock" = "stock" + ${quantity},
           "updatedAt" = now()
     WHERE "id" = ${productId}
  `;
}

export const stockOps = { reserveStock, releaseStock, confirmSale, returnSoldStock };

// -----------------------------------------------------------------------------
// Numeracao de pedido (sequencia atomica)
// -----------------------------------------------------------------------------

async function nextOrderNumber(tx: Tx): Promise<string> {
  // `updatedAt` nao tem default no banco (o Prisma o gerencia no cliente),
  // portanto precisa ser informado explicitamente no INSERT.
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "sequences" ("key", "value", "updatedAt")
    VALUES ('order', 1, now())
    ON CONFLICT ("key") DO UPDATE
      SET "value" = "sequences"."value" + 1, "updatedAt" = now()
    RETURNING "value"
  `;

  const value = rows[0]?.value ?? 1;
  const year = new Date().getFullYear();
  return `MA-${year}-${String(value).padStart(6, "0")}`;
}

// -----------------------------------------------------------------------------
// Transicoes de status
// -----------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  AWAITING_PAYMENT: ["PAYMENT_REVIEW", "PAID", "CANCELED"],
  PAYMENT_REVIEW: ["PAID", "CANCELED"],
  PAID: ["PREPARING", "CANCELED", "REFUNDED"],
  PREPARING: ["SHIPPED", "CANCELED", "REFUNDED"],
  SHIPPED: ["DELIVERED", "REFUNDED"],
  DELIVERED: ["REFUNDED"],
  CANCELED: [],
  REFUNDED: [],
};

export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw badRequest(`Nao e possivel mudar o pedido de "${from}" para "${to}".`);
  }
}

// -----------------------------------------------------------------------------
// Criacao do pedido (checkout)
// -----------------------------------------------------------------------------

export type CreateOrderInput = {
  addressId?: string;
  address?: {
    cep: string;
    street: string;
    number: string;
    complement?: string;
    district: string;
    city: string;
    state: string;
  };
  shippingMethodId?: string;
  couponCode?: string;
  paymentMethod: PaymentMethod;
  notes?: string;
  idempotencyKey?: string;
};

const ADDRESS_SELECT = {
  cep: true,
  street: true,
  number: true,
  complement: true,
  district: true,
  city: true,
  state: true,
  country: true,
} as const;

async function resolveShippingCost(
  tx: Tx,
  args: { shippingMethodId?: string; state: string; subtotal: number; hasShippableItems: boolean },
) {
  if (!args.hasShippableItems) return { cost: 0, method: null as null | { id: string; name: string; carrier: string | null; minDays: number; maxDays: number } };

  if (!args.shippingMethodId) {
    throw validationError("Selecione uma modalidade de frete para continuar.");
  }

  const method = await tx.shippingMethod.findFirst({
    where: { id: args.shippingMethodId, active: true },
    select: { id: true, name: true, carrier: true, price: true, freeAbove: true, minDays: true, maxDays: true, regions: true },
  });

  if (!method) throw notFound("Modalidade de frete nao encontrada ou inativa.");

  if (method.regions.length > 0 && !method.regions.includes(args.state.toUpperCase())) {
    throw validationError("Esta modalidade de frete nao atende o estado informado.");
  }

  const base = decimalToNumber(method.price);
  const freeAbove = method.freeAbove === null ? 0 : decimalToNumber(method.freeAbove);
  const cost = freeAbove > 0 && args.subtotal >= freeAbove ? 0 : base;

  return {
    cost: Number(cost.toFixed(2)),
    method: {
      id: method.id,
      name: method.name,
      carrier: method.carrier,
      minDays: method.minDays,
      maxDays: method.maxDays,
    },
  };
}

/**
 * Finaliza o pedido.
 *
 * Tudo acontece numa UNICA transacao:
 *  - revalida carrinho, precos, estoque, frete e cupom (nunca confia no front)
 *  - reserva estoque atomicamente
 *  - grava pedido, itens (snapshots), historico, pagamento e uso de cupom
 *  - limpa o carrinho
 *  - dispara notificacoes para cliente e administracao
 */
export async function createOrder(userId: string, input: CreateOrderInput) {
  // Idempotencia: repetir a mesma requisicao devolve o mesmo pedido.
  if (input.idempotencyKey) {
    const existing = await prisma.order.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, number: true, status: true, total: true },
    });
    if (existing) {
      return { order: existing, reused: true };
    }
  }

  const cart = await cartService.getCart(userId);
  if (cart.items.length === 0) throw badRequest("Seu carrinho esta vazio.");

  const invalid = cart.items.find((item) => !item.product.active);
  if (invalid) throw conflict(`O produto ${invalid.product.name} nao esta mais disponivel.`);
  const outOfStock = cart.items.find((item) => item.product.stock < item.quantity);
  if (outOfStock) {
    throw insufficientStock(
      `Estoque insuficiente para ${outOfStock.product.name}. Disponivel: ${outOfStock.product.stock}.`,
    );
  }

  // Endereco: usa o cadastrado do proprio usuario ou um informado no checkout.
  let address: {
    cep: string; street: string; number: string; complement?: string | null;
    district: string; city: string; state: string; country: string;
  };

  if (input.addressId) {
    const found = await prisma.address.findFirst({
      where: { id: input.addressId, userId },
      select: ADDRESS_SELECT,
    });
    if (!found) throw notFound("Endereco nao encontrado na sua conta.");
    address = found;
  } else if (input.address) {
    address = { ...input.address, complement: input.address.complement ?? null, country: "BR" };
  } else {
    throw validationError("Informe um endereco de entrega.");
  }

  const subtotal = cart.summary.subtotal;
  const hasShippableItems = cart.items.some((i) => i.product.hasShipping && i.quantity > 0);

  const order = await prisma.$transaction(
    async (tx) => {
      // 1. Reserva de estoque (atomica, item a item)
      for (const item of cart.items) {
        await reserveStock(tx, item.product.id, item.quantity, item.product.name);
      }

      // 2. Frete
      const shippingResult = await resolveShippingCost(tx, {
        shippingMethodId: input.shippingMethodId,
        state: address.state,
        subtotal,
        hasShippableItems,
      });

      // 3. Cupom (revalidado dentro da transacao)
      let discount = 0;
      let couponId: string | null = null;
      let couponCode: string | null = null;
      let couponShippingDiscount = 0;

      if (input.couponCode) {
        const validation = await validateCoupon({
          code: input.couponCode,
          userId,
          subtotal,
          shippingCost: shippingResult.cost,
          items: cart.items.map((item) => ({
            productId: item.product.id,
            categoryId: item.product.category?.id ?? null,
            allowCoupon: item.product.allowCoupon,
            quantity: item.quantity,
            unitPrice: decimalToNumber(item.product.price),
          })),
        });
        discount = validation.discount;
        couponId = validation.couponId;
        couponCode = validation.code;
        couponShippingDiscount = validation.shippingDiscount;
      }

      const shippingCost = Math.max(0, Number((shippingResult.cost - couponShippingDiscount).toFixed(2)));
      const total = Math.max(0, Number((subtotal - discount + shippingCost).toFixed(2)));

      // 4. Pedido
      const number = await nextOrderNumber(tx);

      const customer = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { name: true, email: true, phone: true },
      });

      const created = await tx.order.create({
        data: {
          number,
          userId,
          status: "AWAITING_PAYMENT",
          subtotal: subtotal.toFixed(2),
          discount: discount.toFixed(2),
          shippingCost: shippingCost.toFixed(2),
          total: total.toFixed(2),
          couponId,
          couponCode,
          paymentMethod: input.paymentMethod,
          shippingAddress: address as unknown as Prisma.InputJsonValue,
          customerSnapshot: customer as unknown as Prisma.InputJsonValue,
          notes: input.notes?.slice(0, 500) ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          items: {
            create: cart.items.map((item) => ({
              productId: item.product.id,
              nameSnapshot: item.product.name,
              skuSnapshot: item.product.sku,
              imageSnapshot: item.product.images[0]?.url ?? null,
              unitPrice: decimalToNumber(item.product.price).toFixed(2),
              quantity: item.quantity,
              total: (decimalToNumber(item.product.price) * item.quantity).toFixed(2),
            })),
          },
          statusHistory: {
            create: { toStatus: "AWAITING_PAYMENT", note: "Pedido criado pelo cliente." },
          },
          payments: {
            create: {
              method: input.paymentMethod,
              status: "PENDING",
              amount: total.toFixed(2),
              provider: "mock",
              expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            },
          },
        },
        select: { id: true, number: true, status: true, total: true, createdAt: true },
      });

      // 5. Frete registrado
      if (shippingResult.method) {
        await tx.shipment.create({
          data: {
            orderId: created.id,
            shippingMethodId: shippingResult.method.id,
            carrier: shippingResult.method.carrier,
            cost: shippingCost.toFixed(2),
            status: "PENDING",
          },
        });
      }

      // 6. Uso do cupom (contabilizado de forma atomica)
      if (couponId) {
        await tx.couponUsage.create({
          data: { couponId, userId, orderId: created.id, amount: discount.toFixed(2) },
        });
        await tx.coupon.update({ where: { id: couponId }, data: { usesCount: { increment: 1 } } });
      }

      // 7. Limpa o carrinho
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      // 8. Notificacoes
      await tx.notification.create({
        data: {
          userId,
          type: "ORDER_CREATED",
          title: `Pedido ${created.number} recebido`,
          body: "Aguardando confirmacao de pagamento.",
          link: `/meus-pedidos/${created.id}`,
        },
      });

      const admins = await tx.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
      if (admins.length > 0) {
        await tx.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            type: "ORDER_CREATED" as const,
            title: `Novo pedido ${created.number}`,
            body: `${customer.name} - total R$ ${total.toFixed(2)}`,
            link: `/admin/pedidos/${created.id}`,
          })),
        });
      }

      return { ...created, shipping: shippingResult.method, discount, shippingCost, subtotal };
    },
    { timeout: 20_000, isolationLevel: "ReadCommitted" },
  );

  return { order, reused: false };
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

const orderListSelect = {
  id: true,
  number: true,
  status: true,
  subtotal: true,
  discount: true,
  shippingCost: true,
  total: true,
  paymentMethod: true,
  createdAt: true,
  paidAt: true,
  shippedAt: true,
  deliveredAt: true,
  canceledAt: true,
  _count: { select: { items: true } },
} as const;

export async function listMyOrders(userId: string, skip: number, take: number, status?: OrderStatus) {
  const where = { userId, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, select: orderListSelect }),
    prisma.order.count({ where }),
  ]);
  return { items, total };
}

export async function getMyOrder(userId: string, idOrNumber: string) {
  const order = await prisma.order.findFirst({
    where: { userId, OR: [{ id: idOrNumber }, { number: idOrNumber }] },
    include: {
      items: true,
      statusHistory: { orderBy: { createdAt: "asc" } },
      payments: {
        select: { id: true, method: true, status: true, amount: true, provider: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
      shipment: { include: { shippingMethod: { select: { name: true, carrier: true } } } },
    },
  });

  if (!order) throw notFound("Pedido nao encontrado.");
  return order;
}

/** Imutavel depois de criado: o comprovante usa exatamente estes dados. */
export async function getOrderReceipt(userId: string, orderId: string, isAdmin = false) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...(isAdmin ? {} : { userId }) },
    include: {
      items: true,
      payments: { orderBy: { createdAt: "desc" }, select: { method: true, status: true, amount: true, createdAt: true, approvedAt: true } },
      user: { select: { name: true, email: true, phone: true } },
      shipment: { include: { shippingMethod: { select: { name: true, carrier: true, minDays: true, maxDays: true } } } },
    },
  });

  if (!order) throw notFound("Pedido nao encontrado.");

  return {
    number: order.number,
    status: order.status,
    createdAt: order.createdAt,
    customer: order.user,
    items: order.items,
    subtotal: order.subtotal,
    discount: order.discount,
    shippingCost: order.shippingCost,
    total: order.total,
    couponCode: order.couponCode,
    paymentMethod: order.paymentMethod,
    payments: order.payments,
    shippingAddress: order.shippingAddress,
    shipment: order.shipment,
    notes: order.notes,
  };
}

// -----------------------------------------------------------------------------
// Alteracao de status (com efeitos colaterais de estoque)
// -----------------------------------------------------------------------------

export async function updateOrderStatus(
  orderId: string,
  to: OrderStatus,
  options: { adminId?: string; note?: string; trackingCode?: string; carrier?: string } = {},
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { select: { productId: true, quantity: true } }, shipment: true },
    });
    if (!order) throw notFound("Pedido nao encontrado.");

    assertTransition(order.status, to);

    // Efeitos de estoque
    if (to === "PAID") {
      for (const item of order.items) {
        if (item.productId) await confirmSale(tx, item.productId, item.quantity);
      }
    }

    if (to === "CANCELED") {
      const wasPaid = ["PAID", "PREPARING", "SHIPPED", "DELIVERED"].includes(order.status);
      for (const item of order.items) {
        if (!item.productId) continue;
        if (wasPaid) await returnSoldStock(tx, item.productId, item.quantity);
        else await releaseStock(tx, item.productId, item.quantity);
      }
    }

    if (to === "REFUNDED") {
      for (const item of order.items) {
        if (item.productId) await returnSoldStock(tx, item.productId, item.quantity);
      }
      await tx.payment.updateMany({ where: { orderId }, data: { status: "REFUNDED" } });
    }

    const now = new Date();
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: to,
        ...(to === "PAID" ? { paidAt: now } : {}),
        ...(to === "SHIPPED" ? { shippedAt: now } : {}),
        ...(to === "DELIVERED" ? { deliveredAt: now } : {}),
        ...(to === "CANCELED" ? { canceledAt: now } : {}),
      },
      select: { id: true, number: true, status: true, total: true, userId: true },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: order.status,
        toStatus: to,
        note: options.note ?? null,
        changedById: options.adminId ?? null,
      },
    });

    // O envio precisa ser atualizado tambem em DELIVERED (mesmo sem novo
    // codigo de rastreio informado na transicao).
    if (order.shipment && (options.trackingCode || options.carrier || to === "SHIPPED" || to === "DELIVERED")) {
      await tx.shipment.update({
        where: { orderId },
        data: {
          ...(options.trackingCode ? { trackingCode: options.trackingCode } : {}),
          ...(options.carrier ? { carrier: options.carrier } : {}),
          ...(to === "SHIPPED" ? { status: "SHIPPED", shippedAt: now } : {}),
          ...(to === "DELIVERED" ? { status: "DELIVERED", deliveredAt: now } : {}),
        },
      });
    }

    // Notifica o cliente sobre a mudanca
    const notifMap: Record<string, { type: "PAYMENT_APPROVED" | "ORDER_SHIPPED" | "ORDER_DELIVERED" | "ORDER_CANCELED" | "SYSTEM"; title: string }> = {
      PAID: { type: "PAYMENT_APPROVED", title: `Pagamento confirmado - pedido ${updated.number}` },
      SHIPPED: { type: "ORDER_SHIPPED", title: `Pedido ${updated.number} enviado` },
      DELIVERED: { type: "ORDER_DELIVERED", title: `Pedido ${updated.number} entregue` },
      CANCELED: { type: "ORDER_CANCELED", title: `Pedido ${updated.number} cancelado` },
      REFUNDED: { type: "SYSTEM", title: `Pedido ${updated.number} reembolsado` },
    };

    const notif = notifMap[to];
    if (notif) {
      await tx.notification.create({
        data: {
          userId: updated.userId,
          type: notif.type,
          title: notif.title,
          link: `/meus-pedidos/${updated.id}`,
        },
      });
    }

    return updated;
  });
}

/** Cliente so pode cancelar antes do pagamento ser aprovado. */
export async function cancelMyOrder(userId: string, orderId: string, reason?: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, select: { status: true } });
  if (!order) throw notFound("Pedido nao encontrado.");

  if (!["AWAITING_PAYMENT", "PAYMENT_REVIEW"].includes(order.status)) {
    throw badRequest(
      "Este pedido nao pode mais ser cancelado pelo site. Fale com o atendimento para solicitar o cancelamento.",
    );
  }

  return updateOrderStatus(orderId, "CANCELED", { note: reason ?? "Cancelado pelo cliente." });
}

/** Pedidos recentes do cliente (usado no atalho "Meus pedidos"). */
export async function myOrdersSummary(userId: string) {
  const [pending, total, spent] = await Promise.all([
    prisma.order.count({ where: { userId, status: { in: ["AWAITING_PAYMENT", "PAYMENT_REVIEW", "PAID", "PREPARING", "SHIPPED"] } } }),
    prisma.order.count({ where: { userId } }),
    prisma.order.aggregate({ where: { userId, status: { in: ["PAID", "PREPARING", "SHIPPED", "DELIVERED"] } }, _sum: { total: true } }),
  ]);

  return { inProgress: pending, totalOrders: total, totalSpent: spent._sum.total ?? 0 };
}
