import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

/**
 * Métricas de audiência — coleta ANÔNIMA e minimizada.
 *
 * Privacidade/LGPD:
 *  - NÃO armazenamos IP, e-mail, nome ou qualquer dado pessoal;
 *  - `sessionId` é um identificador OPACO gerado no navegador (não é login);
 *  - o referrer é reduzido ao HOST (sem caminho/query);
 *  - os eventos alimentam apenas números agregados no painel.
 *
 * O que NÃO pode ser recuperado retroativamente: nada é inventado. As métricas
 * começam a existir a partir da implantação desta coleta.
 */

export const ANALYTICS_EVENT_TYPES = [
  "PAGE_VIEW",
  "PRODUCT_VIEW",
  "ADD_TO_CART",
  "BEGIN_CHECKOUT",
  "SEARCH",
  "ORDER_CREATED",
  "PAYMENT_CONFIRMED",
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export function isAnalyticsEventType(value: string): value is AnalyticsEventType {
  return (ANALYTICS_EVENT_TYPES as readonly string[]).includes(value);
}

export type IngestInput = {
  eventId?: string | null;
  type: AnalyticsEventType;
  path?: string | null;
  productId?: string | null;
  sessionId?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
};

function deviceFromUserAgent(userAgent: string | null | undefined): string | null {
  const value = (userAgent ?? "").toLowerCase();
  if (!value) return null;
  if (/ipad|tablet/.test(value)) return "tablet";
  if (/mobi|android|iphone/.test(value)) return "mobile";
  return "desktop";
}

function hostOnly(referrer: string | null | undefined): string | null {
  const value = (referrer ?? "").trim();
  if (!value) return null;
  try {
    return new URL(value).host.slice(0, 200) || null;
  } catch {
    return null;
  }
}

/** Registra um evento. Idempotente por `eventId` (retries/re-render não duplicam). */
export async function recordEvent(input: IngestInput): Promise<{ recorded: boolean }> {
  let validProductId: string | null = null;
  if (input.productId && input.productId.length <= 40) {
    const product = await prisma.product.findUnique({ where: { id: input.productId }, select: { id: true } });
    validProductId = product?.id ?? null;
  }

  try {
    await prisma.analyticsEvent.create({
      data: {
        eventId: input.eventId?.trim().slice(0, 64) || null,
        type: input.type,
        path: input.path?.trim().slice(0, 300) || null,
        productId: validProductId,
        sessionId: input.sessionId?.trim().slice(0, 64) || null,
        deviceType: deviceFromUserAgent(input.userAgent),
        referrer: hostOnly(input.referrer),
      },
    });
    return { recorded: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { recorded: false };
    }
    throw error;
  }
}

export type AnalyticsSummary = {
  range: { from: string; to: string };
  totals: {
    pageViews: number;
    productViews: number;
    addToCart: number;
    beginCheckout: number;
    sessions: number;
    uniqueVisitors: number;
    orders: number;
    paidOrders: number;
  };
  conversion: {
    visitToOrder: number | null;
    visitToPaid: number | null;
    checkoutToOrder: number | null;
    /** Denominadores explícitos, para o painel não "inventar" taxas. */
    denominators: { uniqueVisitors: number; beginCheckout: number };
  };
  byType: Array<{ type: string; count: number }>;
  byDevice: Array<{ device: string; count: number }>;
  topProducts: Array<{ productId: string; name: string | null; views: number }>;
  topPages: Array<{ path: string; views: number }>;
  referrers: Array<{ host: string; count: number }>;
  series: Array<{ day: string; pageViews: number; orders: number; paidOrders: number }>;
};

const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : null;

export async function getAnalyticsSummary(from: Date, to: Date): Promise<AnalyticsSummary> {
  const where = { createdAt: { gte: from, lte: to } };

  const [byTypeRows, sessionRows, deviceRows, topProductRows, topPageRows, referrerRows, orders, paidOrders, seriesRows] =
    await Promise.all([
      prisma.analyticsEvent.groupBy({ by: ["type"], where, _count: { _all: true } }),
      prisma.$queryRaw<Array<{ sessions: bigint }>>`
        SELECT COUNT(DISTINCT "session_id")::bigint AS sessions
          FROM "analytics_events"
         WHERE "created_at" >= ${from} AND "created_at" <= ${to} AND "session_id" IS NOT NULL
      `,
      prisma.analyticsEvent.groupBy({ by: ["deviceType"], where, _count: { _all: true } }),
      prisma.analyticsEvent.groupBy({
        by: ["productId"],
        where: { ...where, type: "PRODUCT_VIEW", productId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { productId: "desc" } },
        take: 10,
      }),
      prisma.analyticsEvent.groupBy({
        by: ["path"],
        where: { ...where, type: "PAGE_VIEW", path: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { path: "desc" } },
        take: 10,
      }),
      prisma.analyticsEvent.groupBy({
        by: ["referrer"],
        where: { ...where, referrer: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { referrer: "desc" } },
        take: 10,
      }),
      prisma.pedido.count({ where: { criadoEm: { gte: from, lte: to } } }),
      prisma.pedido.count({ where: { pagoEm: { gte: from, lte: to } } }),
      prisma.$queryRaw<Array<{ day: Date; page_views: bigint }>>`
        SELECT date_trunc('day', "created_at") AS day, COUNT(*)::bigint AS page_views
          FROM "analytics_events"
         WHERE "type" = 'PAGE_VIEW' AND "created_at" >= ${from} AND "created_at" <= ${to}
         GROUP BY 1 ORDER BY 1 ASC
      `,
    ]);

  const countByType = new Map(byTypeRows.map((row) => [row.type, row._count._all]));
  const uniqueVisitors = Number(sessionRows[0]?.sessions ?? 0);

  // Nomes dos produtos mais vistos (uma query só).
  const productIds = topProductRows.map((row) => row.productId).filter((id): id is string => Boolean(id));
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(products.map((product) => [product.id, product.name]));

  // Série diária: combina page views com pedidos/pagos por dia.
  const ordersByDay = await prisma.$queryRaw<Array<{ day: Date; orders: bigint; paid: bigint }>>`
    SELECT date_trunc('day', "criado_em") AS day,
           COUNT(*)::bigint AS orders,
           COUNT(*) FILTER (WHERE "pago_em" IS NOT NULL)::bigint AS paid
      FROM "pedidos"
     WHERE "criado_em" >= ${from} AND "criado_em" <= ${to}
     GROUP BY 1 ORDER BY 1 ASC
  `;
  const ordersMap = new Map(ordersByDay.map((row) => [row.day.toISOString().slice(0, 10), row]));
  const series = seriesRows.map((row) => {
    const key = row.day.toISOString().slice(0, 10);
    const orderRow = ordersMap.get(key);
    return {
      day: key,
      pageViews: Number(row.page_views),
      orders: Number(orderRow?.orders ?? 0),
      paidOrders: Number(orderRow?.paid ?? 0),
    };
  });

  const beginCheckout = countByType.get("BEGIN_CHECKOUT") ?? 0;

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      pageViews: countByType.get("PAGE_VIEW") ?? 0,
      productViews: countByType.get("PRODUCT_VIEW") ?? 0,
      addToCart: countByType.get("ADD_TO_CART") ?? 0,
      beginCheckout,
      sessions: uniqueVisitors,
      uniqueVisitors,
      orders,
      paidOrders,
    },
    conversion: {
      visitToOrder: ratio(orders, uniqueVisitors),
      visitToPaid: ratio(paidOrders, uniqueVisitors),
      checkoutToOrder: ratio(orders, beginCheckout),
      denominators: { uniqueVisitors, beginCheckout },
    },
    byType: byTypeRows.map((row) => ({ type: row.type, count: row._count._all })),
    byDevice: deviceRows
      .map((row) => ({ device: row.deviceType ?? "desconhecido", count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    topProducts: topProductRows.map((row) => ({
      productId: row.productId ?? "",
      name: row.productId ? nameById.get(row.productId) ?? null : null,
      views: row._count._all,
    })),
    topPages: topPageRows.map((row) => ({ path: row.path ?? "", views: row._count._all })),
    referrers: referrerRows.map((row) => ({ host: row.referrer ?? "", count: row._count._all })),
    series,
  };
}

/**
 * Retenção: remove eventos mais antigos que `days` (minimização de dados).
 * Retorna quantos registros foram removidos. Idempotente.
 */
export async function purgeOldEvents(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await prisma.analyticsEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}
