import { prisma } from "../../db.js";
import { insufficientStock, notFound } from "../../lib/errors.js";
import { decimalToNumber } from "../../lib/serialize.js";

const cartItemSelect = {
  id: true,
  quantity: true,
  createdAt: true,
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      price: true,
      comparePrice: true,
      volume: true,
      stock: true,
      active: true,
      hasShipping: true,
      allowCoupon: true,
      brand: { select: { id: true, name: true, slug: true } },
      category: { select: { id: true, name: true, slug: true } },
      images: { select: { url: true, alt: true }, orderBy: { position: "asc" as const }, take: 1 },
    },
  },
} as const;

export async function getOrCreateCart(userId: string) {
  return prisma.cart.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: { id: true, userId: true },
  });
}

function buildSummary(items: Array<{ quantity: number; product: { price: unknown; stock: number; active: boolean } }>) {
  const subtotal = items.reduce(
    (acc, item) => acc + decimalToNumber(item.product.price) * item.quantity,
    0,
  );
  const totalItems = items.reduce((acc, item) => acc + item.quantity, 0);
  const hasIssues = items.some((item) => !item.product.active || item.product.stock < item.quantity);

  return {
    subtotal: Number(subtotal.toFixed(2)),
    totalItems,
    shipping: 0,
    discount: 0,
    total: Number(subtotal.toFixed(2)),
    hasIssues,
  };
}

/** Carrinho do usuario com resumo calculado no servidor. */
export async function getCart(userId: string) {
  const cart = await getOrCreateCart(userId);
  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    orderBy: { createdAt: "asc" },
    select: cartItemSelect,
  });

  return {
    id: cart.id,
    items: items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      product: item.product,
      unitPrice: decimalToNumber(item.product.price),
      lineTotal: Number((decimalToNumber(item.product.price) * item.quantity).toFixed(2)),
      available: item.product.active && item.product.stock >= item.quantity,
      stock: item.product.stock,
    })),
    summary: buildSummary(items),
  };
}

export async function addItem(userId: string, productId: string, quantity: number) {
  const product = await prisma.product.findFirst({
    where: { id: productId, active: true },
    select: { id: true, name: true, stock: true },
  });
  if (!product) throw notFound("Produto nao encontrado ou indisponivel.");

  const cart = await getOrCreateCart(userId);
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId: cart.id, productId } },
    select: { quantity: true },
  });

  const desired = (existing?.quantity ?? 0) + quantity;
  if (desired > product.stock) {
    throw insufficientStock(
      `Estoque insuficiente para ${product.name}. Disponivel: ${product.stock}.`,
      { available: product.stock },
    );
  }

  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId } },
    update: { quantity: desired },
    create: { cartId: cart.id, productId, quantity: desired },
  });

  return getCart(userId);
}

export async function updateItem(userId: string, itemId: string, quantity: number) {
  const cart = await getOrCreateCart(userId);
  const item = await prisma.cartItem.findFirst({
    where: { id: itemId, cartId: cart.id },
    select: { id: true, productId: true, product: { select: { name: true, stock: true } } },
  });
  if (!item) throw notFound("Item nao encontrado no carrinho.");

  if (quantity <= 0) {
    await prisma.cartItem.delete({ where: { id: item.id } });
    return getCart(userId);
  }

  if (quantity > item.product.stock) {
    throw insufficientStock(
      `Estoque insuficiente para ${item.product.name}. Disponivel: ${item.product.stock}.`,
      { available: item.product.stock },
    );
  }

  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
  return getCart(userId);
}

export async function removeItem(userId: string, itemId: string) {
  const cart = await getOrCreateCart(userId);
  await prisma.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
  return getCart(userId);
}

export async function clearCart(userId: string) {
  const cart = await getOrCreateCart(userId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  return getCart(userId);
}
