import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { useUiStore } from "@/stores/ui";
import { useAuthStore } from "@/stores/auth";
import {
  guestCartToCart,
  productToGuestSnapshot,
  useGuestCartStore,
  type GuestProductSnapshot,
} from "@/stores/cart";
import type {
  Cart,
  CatalogFacets,
  Category,
  Brand,
  Conversation,
  Message,
  Notification,
  Product,
  SiteContentResponse,
  Theme,
  ThemeSettings,
  Banner,
  CouponValidation,
} from "@/types/api";

/* ========================================================================== */
/* Utilidades                                                                  */
/* ========================================================================== */

/** Atrasa um valor (usado na busca para evitar uma requisição por tecla). */
export function useDebounce<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/** Media query reativa (usada para alternar layout mobile/desktop). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener("change", handler);
    return () => list.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

/** Helper de toast com a API da store. */
export function useToast() {
  const pushToast = useUiStore((s) => s.pushToast);
  const dismissToast = useUiStore((s) => s.dismissToast);

  const success = useCallback((title: string, message?: string) => pushToast({ tone: "success", title, message }), [pushToast]);
  const error = useCallback((title: string, message?: string) => pushToast({ tone: "error", title, message }), [pushToast]);
  const warning = useCallback((title: string, message?: string) => pushToast({ tone: "warning", title, message }), [pushToast]);
  const info = useCallback((title: string, message?: string) => pushToast({ tone: "info", title, message }), [pushToast]);

  return useMemo(() => ({ success, error, warning, info, dismiss: dismissToast }), [success, error, warning, info, dismissToast]);
}

/**
 * Chave de idempotência estável por tentativa de checkout.
 * Protege contra duplo clique/criação duplicada de pedido.
 */
export function useIdempotencyKey(deps: unknown[] = []): string {
  const keyRef = useRef<string | null>(null);
  const signature = JSON.stringify(deps);

  if (keyRef.current === null) {
    keyRef.current = crypto.randomUUID();
  }

  return useMemo(() => {
    void signature; // recalcula apenas quando a assinatura muda
    return keyRef.current as string;
  }, [signature]);
}

/* ========================================================================== */
/* CMS / tema                                                                  */
/* ========================================================================== */

/**
 * Conteúdo do site. Um valor `null` significa "o administrador ainda não
 * preencheu" — o componente que consome decide como exibir o placeholder.
 */
export function useContent() {
  const query = useQuery({
    queryKey: queryKeys.content,
    queryFn: () => api.get<SiteContentResponse>("/content", { auth: false }),
    staleTime: 5 * 60_000,
  });

  const values = query.data?.values ?? {};

  const get = useCallback((key: string): string | null => values[key] ?? null, [values]);

  return { ...query, values, get };
}

export function useTheme() {
  const query = useQuery({
    queryKey: queryKeys.theme,
    queryFn: () => api.get<Theme>("/theme", { auth: false }),
    staleTime: 5 * 60_000,
  });

  // Aplica o tema publicado como variáveis CSS. Nada é inventado: se não houver
  // tema publicado, os tokens padrão do design system permanecem.
  useEffect(() => {
    const settings = query.data?.settings as ThemeSettings | null | undefined;
    const root = document.documentElement;

    const applied: string[] = [];
    const setVar = (name: string, value: string | number | undefined) => {
      if (value === undefined || value === null || value === "") return;
      root.style.setProperty(name, String(value));
      applied.push(name);
    };

    if (query.data?.published && settings) {
      setVar("--color-primary", settings.primaryColor);
      setVar("--color-accent", settings.accentColor);
      setVar("--color-bg", settings.backgroundColor);
      setVar("--color-surface", settings.surfaceColor);
      setVar("--color-text", settings.textColor);
      setVar("--radius-button", settings.buttonRadius ? `${settings.buttonRadius}px` : undefined);
      setVar("--radius-card", settings.cardRadius ? `${settings.cardRadius}px` : undefined);
    }

    return () => {
      for (const name of applied) root.style.removeProperty(name);
    };
  }, [query.data]);

  return query;
}

export function useBanners(position?: string) {
  return useQuery({
    queryKey: queryKeys.banners(position),
    queryFn: () => api.get<Banner[]>("/banners", { auth: false, query: position ? { position } : undefined }),
    staleTime: 5 * 60_000,
  });
}

/* ========================================================================== */
/* Catálogo                                                                    */
/* ========================================================================== */

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => api.get<Category[]>("/categories", { auth: false }),
    staleTime: 10 * 60_000,
  });
}

export function useCategory(slug: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.categories, slug] as const,
    queryFn: () => api.get<Category & { children: Category[] }>(`/categories/${slug}`, { auth: false }),
    enabled: Boolean(slug),
    staleTime: 10 * 60_000,
  });
}

export function useBrands() {
  return useQuery({
    queryKey: queryKeys.brands,
    queryFn: () => api.get<Brand[]>("/brands", { auth: false }),
    staleTime: 10 * 60_000,
  });
}

export function useFacets() {
  return useQuery({
    queryKey: queryKeys.facets,
    queryFn: () => api.get<CatalogFacets>("/products/facets", { auth: false }),
    staleTime: 10 * 60_000,
  });
}

export type ProductFilters = {
  search?: string;
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  volume?: string;
  inStock?: boolean;
  onSale?: boolean;
  launch?: boolean;
  featured?: boolean;
  bestSeller?: boolean;
  sort?: string;
  page?: number;
  perPage?: number;
};

export function useProducts(filters: ProductFilters) {
  return useQuery({
    queryKey: queryKeys.products(filters as Record<string, unknown>),
    queryFn: () => api.list<Product[]>("/products", { auth: false, query: filters }),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}

export function useProduct(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.product(slug ?? ""),
    queryFn: () => api.get<Product>(`/products/${slug}`, { auth: false }),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

export function useRelatedProducts(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.related(slug ?? ""),
    queryFn: () => api.get<Product[]>(`/products/${slug}/related`, { auth: false }),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

export function useProductReviews(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.productReviews(slug ?? ""),
    queryFn: () => api.get<{ items: Array<{ id: string; rating: number; title: string | null; comment: string | null; createdAt: string; author: string }>; average: number; total: number }>(`/products/${slug}/reviews`, { auth: false }),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

/** Sugestões de busca (usado no autocomplete do header). */
export function useProductSearch(term: string) {
  const debounced = useDebounce(term, 350);
  const trimmed = debounced.trim();

  return useQuery({
    queryKey: queryKeys.search(trimmed),
    queryFn: () => api.list<Product[]>("/products", { auth: false, query: { search: trimmed, perPage: 6 } }),
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
  });
}

/* ========================================================================== */
/* Carrinho                                                                    */
/* ========================================================================== */

/** Chave de cache do carrinho de visitante. */
export const guestCartKey = [...queryKeys.cart, "guest"] as const;

/**
 * Carrinho unificado:
 *  - cliente logado (admin/loja antiga) => carrinho no servidor;
 *  - visitante => carrinho local (Guest Checkout), no mesmo formato `Cart`.
 */
export function useCart() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const guestItems = useGuestCartStore((s) => s.items);

  return useQuery({
    queryKey: isAuthenticated ? queryKeys.cart : guestCartKey,
    queryFn: () =>
      isAuthenticated
        ? api.get<Cart>("/cart")
        : Promise.resolve(guestCartToCart(guestItems)),
    enabled: true,
    staleTime: 0,
  });
}

export function useAddToCart() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const addGuestItem = useGuestCartStore((s) => s.add);

  return useMutation({
    mutationFn: async (input: { productId: string; quantity: number; product?: GuestProductSnapshot }) => {
      if (isAuthenticated) {
        return api.post<Cart>("/cart/items", { productId: input.productId, quantity: input.quantity });
      }
      if (!input.product) throw new Error("Produto indisponível para adicionar ao carrinho.");
      addGuestItem({ ...input.product, quantity: input.quantity });
      return guestCartToCart(useGuestCartStore.getState().items);
    },
    onSuccess: (cart) => {
      if (!isAuthenticated) {
        queryClient.setQueryData(guestCartKey, cart);
        return;
      }
      queryClient.setQueryData(queryKeys.cart, cart);
      void queryClient.invalidateQueries({ queryKey: queryKeys.cart });
    },
  });
}

export function useUpdateCartItem() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const updateGuestItem = useGuestCartStore((s) => s.update);

  return useMutation({
    mutationFn: async (input: { itemId: string; quantity: number }) => {
      if (isAuthenticated) {
        return api.patch<Cart>(`/cart/items/${input.itemId}`, { quantity: input.quantity });
      }
      updateGuestItem(input.itemId, input.quantity);
      return guestCartToCart(useGuestCartStore.getState().items);
    },
    onSuccess: (cart) => {
      if (!isAuthenticated) {
        queryClient.setQueryData(guestCartKey, cart);
        return;
      }
      queryClient.setQueryData(queryKeys.cart, cart);
      void queryClient.invalidateQueries({ queryKey: queryKeys.cart });
    },
  });
}

export function useRemoveCartItem() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const removeGuestItem = useGuestCartStore((s) => s.remove);

  return useMutation({
    mutationFn: async (itemId: string) => {
      if (isAuthenticated) return api.delete<Cart>(`/cart/items/${itemId}`);
      removeGuestItem(itemId);
      return guestCartToCart(useGuestCartStore.getState().items);
    },
    onSuccess: (cart) => {
      if (!isAuthenticated) {
        queryClient.setQueryData(guestCartKey, cart);
        return;
      }
      queryClient.setQueryData(queryKeys.cart, cart);
      void queryClient.invalidateQueries({ queryKey: queryKeys.cart });
    },
  });
}

export function useClearCart() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const clearGuest = useGuestCartStore((s) => s.clear);

  return useMutation({
    mutationFn: async () => {
      if (isAuthenticated) return api.delete<Cart>("/cart");
      clearGuest();
      return guestCartToCart([]);
    },
    onSuccess: (cart) => {
      if (!isAuthenticated) {
        queryClient.setQueryData(guestCartKey, cart);
        return;
      }
      queryClient.setQueryData(queryKeys.cart, cart);
      void queryClient.invalidateQueries({ queryKey: queryKeys.cart });
    },
  });
}

/** Snapshot de produto para o carrinho de visitante (sem expor o objeto inteiro). */
export function useGuestProduct(): (product: Product) => GuestProductSnapshot {
  return productToGuestSnapshot;
}

/** Soma das quantidades — usado nos badges de carrinho. */
export function useCartCount(): number {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const guestItems = useGuestCartStore((s) => s.items);
  const { data } = useCart();
  if (!isAuthenticated) return guestItems.reduce((total, item) => total + item.quantity, 0);
  return data?.summary.totalItems ?? 0;
}

/* ========================================================================== */
/* Cupom                                                                       */
/* ========================================================================== */

export function useValidateCoupon() {
  return useMutation({
    mutationFn: (input: { code: string; shippingCost?: number }) => api.post<CouponValidation>("/coupons/validate", input),
  });
}

/* ========================================================================== */
/* Favoritos                                                                   */
/* ========================================================================== */

export function useFavoriteIds(): { ids: Set<string>; isLoading: boolean } {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.favoriteIds,
    queryFn: () => api.get<string[]>("/favorites/ids"),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  return useMemo(() => ({ ids: new Set(data ?? []), isLoading }), [data, isLoading]);
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { productId: string; favorite: boolean }) => {
      if (input.favorite) {
        await api.post(`/favorites/${input.productId}`);
      } else {
        await api.delete(`/favorites/${input.productId}`);
      }
      return input;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.favoriteIds });
      void queryClient.invalidateQueries({ queryKey: ["favorites"] });
    },
  });
}

export function useFavorites() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: ["favorites"] as const,
    queryFn: () => api.get<Array<{ id: string; createdAt: string; product: Product }>>("/favorites"),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}

/* ========================================================================== */
/* Notificações                                                                */
/* ========================================================================== */

export function useNotifications(onlyUnread = false) {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: queryKeys.notifications(onlyUnread),
    queryFn: () => api.list<Notification[]>("/notifications", { query: { onlyUnread: onlyUnread ? "true" : undefined, perPage: 30 } }),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
}

export function useUnreadNotifications() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: queryKeys.notificationsUnread,
    queryFn: () => api.get<{ unread: number }>("/notifications/unread-count"),
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/* ========================================================================== */
/* Mensagens                                                                   */
/* ========================================================================== */

export function useConversations() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: queryKeys.conversations,
    queryFn: () => api.get<Conversation[]>("/messages/conversations"),
    enabled: isAuthenticated,
    staleTime: 15_000,
  });
}

export function useConversation(id: string | undefined) {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: queryKeys.conversation(id ?? ""),
    queryFn: () => api.get<Conversation>(`/messages/conversations/${id}`),
    enabled: Boolean(id) && isAuthenticated,
    staleTime: 0,
    refetchInterval: 20_000,
  });
}

export function useSendMessage(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post<Message>(`/messages/conversations/${conversationId}/messages`, { body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId ?? "") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { subject?: string; message: string; orderId?: string }) =>
      api.post<{ id: string }>("/messages/conversations", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}

export function useUnreadMessages() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: queryKeys.messagesUnread,
    queryFn: () => api.get<{ forClient: number; forAdmin: number }>("/messages/unread"),
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/* ========================================================================== */
/* SEO em efeito                                                               */
/* ========================================================================== */

export function useApiError(error: unknown): ApiError | null {
  return error instanceof ApiError ? error : null;
}
