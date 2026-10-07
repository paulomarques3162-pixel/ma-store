import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Cart, CartItem, Product } from "@/types/api";

/**
 * Carrinho de visitante (Guest Checkout).
 *
 * Sem conta nao existe carrinho no servidor: o carrinho vive no
 * localStorage. O checkout envia o snapshot dos itens para a API, que
 * RECALCULA preco/peso/frete a partir do catalogo.
 */
export type GuestProductSnapshot = {
  productId: string;
  slug: string;
  name: string;
  price: number;
  comparePrice: number | null;
  volume: string | null;
  image: string | null;
  brand: string | null;
  category: string | null;
  /** Peso unitario em KG (usado so como fallback; o backend recalcula). */
  weightKg: number;
  stock: number;
};

export type GuestCartItem = GuestProductSnapshot & { quantity: number };

type GuestCartState = {
  items: GuestCartItem[];
  add: (item: GuestProductSnapshot & { quantity?: number }) => void;
  update: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
};

function clampQuantity(quantity: number, stock: number): number {
  const max = stock > 0 ? stock : 1;
  return Math.max(1, Math.min(Math.floor(quantity) || 1, max));
}

export const useGuestCartStore = create<GuestCartState>()(
  persist(
    (set) => ({
      items: [],

      add(item) {
        set((state) => {
          const quantity = clampQuantity(item.quantity ?? 1, item.stock);
          const existing = state.items.find((entry) => entry.productId === item.productId);
          if (existing) {
            return {
              items: state.items.map((entry) =>
                entry.productId === item.productId
                  ? { ...entry, quantity: clampQuantity(entry.quantity + quantity, entry.stock) }
                  : entry,
              ),
            };
          }
          return { items: [...state.items, { ...item, quantity }] };
        });
      },

      update(productId, quantity) {
        set((state) => ({
          items: state.items.map((entry) =>
            entry.productId === productId ? { ...entry, quantity: clampQuantity(quantity, entry.stock) } : entry,
          ),
        }));
      },

      remove(productId) {
        set((state) => ({ items: state.items.filter((entry) => entry.productId !== productId) }));
      },

      clear() {
        set({ items: [] });
      },
    }),
    { name: "mastore.guestCart" },
  ),
);

/** Converte um `Product` do catalogo no snapshot minimo do carrinho. */
export function productToGuestSnapshot(product: Product): GuestProductSnapshot {
  return {
    productId: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    comparePrice: product.comparePrice,
    volume: product.volume,
    image: product.images[0]?.url ?? null,
    brand: product.brand?.name ?? null,
    category: product.category?.name ?? null,
    weightKg: product.weightGrams && product.weightGrams > 0 ? product.weightGrams / 1000 : 0.3,
    stock: product.stock,
  };
}

/** Monta um objeto `Cart` (mesmo formato da API) a partir do carrinho local. */
export function guestCartToCart(items: GuestCartItem[]): Cart {
  const cartItems: CartItem[] = items.map((item) => ({
    id: item.productId,
    quantity: item.quantity,
    product: {
      id: item.productId,
      name: item.name,
      slug: item.slug,
      sku: "",
      price: item.price,
      comparePrice: item.comparePrice,
      volume: item.volume,
      stock: item.stock,
      active: true,
      hasShipping: true,
      allowCoupon: true,
      brand: item.brand ? { id: "", name: item.brand, slug: "" } : null,
      category: item.category ? { id: "", name: item.category, slug: "" } : null,
      images: item.image ? [{ url: item.image, alt: item.name }] : [],
    },
    unitPrice: item.price,
    lineTotal: Math.round(item.price * item.quantity * 100) / 100,
    available: item.stock >= item.quantity,
    stock: item.stock,
  }));

  const subtotal = Math.round(cartItems.reduce((total, item) => total + item.lineTotal, 0) * 100) / 100;
  const totalItems = cartItems.reduce((total, item) => total + item.quantity, 0);
  const hasIssues = cartItems.some((item) => !item.available);

  return {
    id: "guest",
    items: cartItems,
    summary: { subtotal, totalItems, shipping: 0, discount: 0, total: subtotal, hasIssues },
  };
}
