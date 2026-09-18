import { prisma } from "../../db.js";
import { decimalToNumber } from "../../lib/serialize.js";
import { couponInvalid } from "../../lib/errors.js";

export type CouponItem = {
  productId: string;
  categoryId: string | null;
  allowCoupon: boolean;
  quantity: number;
  unitPrice: number;
};

export type CouponValidation = {
  couponId: string;
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  discount: number;
  shippingDiscount: number;
  appliesToShipping: boolean;
  applicableSubtotal: number;
};

/**
 * Validacao COMPLETA de cupom - sempre no backend.
 *
 * Ordem das checagens (espelha a regra #56 do projeto):
 *  1. existe  2. ativo  3. dentro da validade  4. limite total de uso
 *  5. limite por usuario  6. valor minimo  7. produto/categoria participa
 *  8. calculo do desconto (nunca confiar em valor vindo do frontend)
 */
export async function validateCoupon(params: {
  code: string;
  userId: string;
  subtotal: number;
  shippingCost: number;
  items: CouponItem[];
}): Promise<CouponValidation> {
  const code = params.code.trim().toUpperCase();
  if (!code) throw couponInvalid("Informe o codigo do cupom.");

  const coupon = await prisma.coupon.findUnique({
    where: { code },
    include: {
      products: { select: { productId: true } },
      categories: { select: { categoryId: true } },
    },
  });

  if (!coupon) throw couponInvalid("Cupom nao encontrado.");
  if (!coupon.active) throw couponInvalid("Este cupom nao esta ativo.");

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) {
    throw couponInvalid("Este cupom ainda nao esta valido.");
  }
  if (coupon.endsAt && coupon.endsAt < now) {
    throw couponInvalid("Este cupom esta expirado.");
  }
  if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) {
    throw couponInvalid("Este cupom atingiu o limite de utilizacoes.");
  }

  if (coupon.maxUsesPerUser !== null) {
    const used = await prisma.couponUsage.count({ where: { couponId: coupon.id, userId: params.userId } });
    if (used >= coupon.maxUsesPerUser) {
      throw couponInvalid("Voce ja utilizou este cupom o numero maximo de vezes.");
    }
  }

  const minOrderValue = coupon.minOrderValue === null ? 0 : decimalToNumber(coupon.minOrderValue);
  if (minOrderValue > 0 && params.subtotal < minOrderValue) {
    throw couponInvalid(
      `Este cupom exige um valor minimo de R$ ${minOrderValue.toFixed(2).replace(".", ",")} em produtos.`,
    );
  }

  const productIds = new Set(coupon.products.map((p) => p.productId));
  const categoryIds = new Set(coupon.categories.map((c) => c.categoryId));

  const eligibleItems = params.items.filter((item) => {
    if (!item.allowCoupon) return false;
    if (coupon.appliesToAll) return true;
    if (productIds.has(item.productId)) return true;
    if (item.categoryId && categoryIds.has(item.categoryId)) return true;
    return false;
  });

  const applicableSubtotal = Number(
    eligibleItems.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0).toFixed(2),
  );

  if (applicableSubtotal <= 0) {
    throw couponInvalid("Este cupom nao se aplica aos produtos do seu carrinho.");
  }

  const value = decimalToNumber(coupon.value);

  let discount =
    coupon.type === "PERCENT"
      ? Number(((applicableSubtotal * value) / 100).toFixed(2))
      : Math.min(value, applicableSubtotal);

  // Nunca deixar o desconto passar do subtotal elegivel.
  discount = Math.min(discount, applicableSubtotal);

  const shippingDiscount = coupon.appliesToShipping ? Number(params.shippingCost.toFixed(2)) : 0;

  return {
    couponId: coupon.id,
    code: coupon.code,
    type: coupon.type,
    value,
    discount,
    shippingDiscount,
    appliesToShipping: coupon.appliesToShipping,
    applicableSubtotal,
  };
}
