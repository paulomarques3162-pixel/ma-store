/**
 * Shipping Engine — API universal de cálculo de frete.
 *
 * Módulo ISOLADO dentro do backend da MA STORE: o núcleo (domínio + motor)
 * não depende de Fastify nem de Prisma. A camada `http/` e o `sdk/` são as
 * bordas utilitárias; cada loja consome a mesma resposta normalizada.
 */
export * from "./domain/index.js";
export * from "./providers/index.js";
export * from "./application/index.js";
export * from "./http/index.js";
export * from "./sdk/index.js";

export const SHIPPING_ENGINE_VERSION = "1.0.0";
