/**
 * Shipping Engine PROPRIO — motor de frete local, por regras cadastradas no
 * PostgreSQL, sem depender da API oficial dos Correios.
 *
 * Exporta dominio puro (testavel), servicos, repositorio Prisma, handlers e as
 * rotas administrativas.
 */
export * from "./domain/cep.js";
export * from "./domain/weight.js";
export * from "./domain/zone.js";
export * from "./domain/rule.js";
export * from "./domain/types.js";

export * from "./application/quote.service.js";
export * from "./application/quote-validation.service.js";
export * from "./application/cache.js";
export * from "./application/prisma.repository.js";
export * from "./application/admin.service.js";
export * from "./application/container.js";

export * from "./http/schemas.js";
export * from "./http/handlers.js";
export { localShippingAdminRoutes } from "./http/admin.routes.js";
