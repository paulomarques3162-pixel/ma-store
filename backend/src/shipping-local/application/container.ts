/** Container simples (sem framework de DI) do Shipping Engine proprio. */
import { LocalShippingCache } from "./cache.js";
import { PrismaLocalShippingRepository } from "./prisma.repository.js";

export const localShippingRepository = new PrismaLocalShippingRepository();
export const localShippingCache = new LocalShippingCache();

/** Invalida o cache em memoria (chamado apos alteracoes administrativas). */
export function invalidateLocalShippingCache(): void {
  localShippingCache.clear();
}
