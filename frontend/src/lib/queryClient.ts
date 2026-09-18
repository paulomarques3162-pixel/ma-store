import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

/**
 * Configuração do React Query.
 *
 * Premissas de performance (regra #36 do projeto):
 *  - `staleTime` generoso no catálogo, curto no que é do usuário;
 *  - nenhuma revalidação em foco para dado sensível (evita requests inúteis);
 *  - retry inteligente: NÃO repetir 4xx (a resposta não vai mudar).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          // 4xx é erro do cliente: repetir não resolve.
          if (error.status >= 400 && error.status < 500) return false;
        }
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    },
    mutations: {
      retry: 0,
    },
  },
});

/** Chaves de cache centralizadas (evita divergência de string entre telas). */
export const queryKeys = {
  content: ["content"] as const,
  theme: ["theme"] as const,
  banners: (position?: string) => ["banners", position ?? "all"] as const,
  categories: ["categories"] as const,
  brands: ["brands"] as const,
  facets: ["catalog", "facets"] as const,
  products: (filters: Record<string, unknown>) => ["products", filters] as const,
  product: (slug: string) => ["product", slug] as const,
  productReviews: (slug: string) => ["product", slug, "reviews"] as const,
  related: (slug: string) => ["product", slug, "related"] as const,
  search: (term: string) => ["search", term] as const,
  cart: ["cart"] as const,
  favorites: ["favorites"] as const,
  favoriteIds: ["favorites", "ids"] as const,
  addresses: ["addresses"] as const,
  shippingMethods: ["shipping", "methods"] as const,
  orders: (filters: Record<string, unknown>) => ["orders", filters] as const,
  order: (id: string) => ["order", id] as const,
  orderSummary: ["orders", "summary"] as const,
  receipt: (id: string) => ["order", id, "receipt"] as const,
  notifications: (onlyUnread?: boolean) => ["notifications", onlyUnread ?? false] as const,
  notificationsUnread: ["notifications", "unread"] as const,
  conversations: ["conversations"] as const,
  conversation: (id: string) => ["conversation", id] as const,
  messagesUnread: ["conversations", "unread"] as const,
  myReviews: ["reviews", "mine"] as const,
  pendingReviews: ["reviews", "pending"] as const,
  myFeedback: ["feedback", "mine"] as const,

  // Administração
  adminDashboard: ["admin", "dashboard"] as const,
  adminProducts: (filters: Record<string, unknown>) => ["admin", "products", filters] as const,
  adminProduct: (id: string) => ["admin", "product", id] as const,
  adminCategories: ["admin", "categories"] as const,
  adminBrands: ["admin", "brands"] as const,
  adminOrders: (filters: Record<string, unknown>) => ["admin", "orders", filters] as const,
  adminOrder: (id: string) => ["admin", "order", id] as const,
  adminOrderPending: ["admin", "orders", "pending"] as const,
  adminUsers: (filters: Record<string, unknown>) => ["admin", "users", filters] as const,
  adminUser: (id: string) => ["admin", "user", id] as const,
  adminCoupons: (filters: Record<string, unknown>) => ["admin", "coupons", filters] as const,
  adminCoupon: (id: string) => ["admin", "coupon", id] as const,
  adminShipping: ["admin", "shipping"] as const,
  adminConversations: (filters: Record<string, unknown>) => ["admin", "conversations", filters] as const,
  adminConversation: (id: string) => ["admin", "conversation", id] as const,
  adminConversationsUnread: ["admin", "conversations", "unread"] as const,
  adminReviews: (filters: Record<string, unknown>) => ["admin", "reviews", filters] as const,
  adminFeedbacks: (filters: Record<string, unknown>) => ["admin", "feedbacks", filters] as const,
  adminPayments: (filters: Record<string, unknown>) => ["admin", "payments", filters] as const,
  adminWebhooks: (filters: Record<string, unknown>) => ["admin", "webhooks", filters] as const,
  adminContent: ["admin", "content"] as const,
  adminSettings: ["admin", "settings"] as const,
  adminBanners: ["admin", "banners"] as const,
  adminTheme: ["admin", "theme"] as const,
  adminAuditLogs: (filters: Record<string, unknown>) => ["admin", "audit", filters] as const,
  adminLogs: (filters: Record<string, unknown>) => ["admin", "logs", filters] as const,
  labRuns: (filters: Record<string, unknown>) => ["admin", "lab", "runs", filters] as const,
  labRun: (id: string) => ["admin", "lab", "run", id] as const,
  labChecklists: ["admin", "lab", "checklists"] as const,
};
