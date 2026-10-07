import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";

/**
 * Utilitários de teste do frontend.
 *
 * `mockApi` intercepta o `fetch` global e responde por rota, simulando a API
 * real (envelope `{ data, meta }` e erros `{ error: {...} }`). Isso permite
 * testar o comportamento das telas sem subir o backend.
 */

export type MockRoute = {
  /** Caminho da API (ex.: "/products"). */
  path: string;
  data?: unknown;
  meta?: unknown;
  status?: number;
  error?: { code: string; message: string; requestId?: string };
};

export function mockApi(routes: MockRoute[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    // Casa a rota mais específica primeiro (paths maiores).
    const route = [...routes]
      .sort((a, b) => b.path.length - a.path.length)
      .find((candidate) => url.includes(candidate.path));

    if (!route) {
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Rota não mockada.", requestId: "test" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    if (route.error) {
      return new Response(JSON.stringify({ error: { requestId: "test-request", ...route.error } }), {
        status: route.status ?? 400,
        headers: { "content-type": "application/json" },
      });
    }

    const body = method === "DELETE" && route.data === undefined ? undefined : { data: route.data ?? null, meta: route.meta };

    return new Response(body === undefined ? "" : JSON.stringify(body), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  options: { route?: string; queryClient?: QueryClient } & Omit<RenderOptions, "wrapper"> = {},
) {
  const queryClient = options.queryClient ?? createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[options.route ?? "/"]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

/* -------------------------------------------------------------------------- */
/* Fixtures com a mesma forma da API real (nada inventado além do necessário)  */
/* -------------------------------------------------------------------------- */

export const productFixture = {
  id: "p1",
  name: "Perfume de Teste 100ml",
  slug: "perfume-de-teste",
  sku: "SKU-1",
  shortDescription: "Descrição curta",
  description: "Descrição completa",
  price: 199.9,
  comparePrice: 249.9,
  volume: "100ml",
  stock: 5,
  minStock: 1,
  hasShipping: true,
  allowCoupon: true,
  isLaunch: true,
  isFeatured: true,
  isBestSeller: false,
  active: true,
  createdAt: new Date().toISOString(),
  brandId: "b1",
  categoryId: "c1",
  brand: { id: "b1", name: "Marca Teste", slug: "marca-teste" },
  category: { id: "c1", name: "Categoria Teste", slug: "categoria-teste" },
  images: [{ url: "/placeholder-product.svg", alt: "frente", position: 0 }],
};

export const outOfStockProductFixture = {
  ...productFixture,
  id: "p2",
  name: "Perfume Esgotado",
  slug: "perfume-esgotado",
  sku: "SKU-2",
  stock: 0,
  images: [],
};

export const cartFixture = {
  id: "cart-1",
  items: [
    {
      id: "item-1",
      quantity: 2,
      product: {
        id: "p1",
        name: productFixture.name,
        slug: productFixture.slug,
        sku: productFixture.sku,
        price: 199.9,
        comparePrice: 249.9,
        volume: "100ml",
        stock: 5,
        active: true,
        hasShipping: true,
        allowCoupon: true,
        brand: productFixture.brand,
        category: productFixture.category,
        images: productFixture.images,
      },
      unitPrice: 199.9,
      lineTotal: 399.8,
      available: true,
      stock: 5,
    },
  ],
  summary: { subtotal: 399.8, totalItems: 2, shipping: 0, discount: 0, total: 399.8, hasIssues: false },
};

export const emptyCartFixture = {
  id: "cart-1",
  items: [],
  summary: { subtotal: 0, totalItems: 0, shipping: 0, discount: 0, total: 0, hasIssues: false },
};
