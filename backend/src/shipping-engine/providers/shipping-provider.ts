import type { ShippingServiceDescriptor } from "../domain/service-catalog.js";
import type {
  ShippingProviderCapabilities,
  ShippingProviderHealth,
  ShippingQuote,
  ShippingQuoteRequest,
} from "../domain/types.js";

/**
 * Contrato universal de transportadora/provedor.
 *
 * A API e o checkout dependem SOMENTE desta interface — nunca de uma classe
 * concreta (ex.: CorreiosProvider). Adicionar um provedor novo é implementar
 * esta interface e registrá-la na factory.
 */
export interface ShippingProvider {
  /** Identificador estável em minúsculas (ex.: "correios", "melhor-envio"). */
  readonly id: string;
  /** Nome amigável para exibição. */
  readonly name: string;
  readonly capabilities: ShippingProviderCapabilities;

  /** Quando presente, permite habilitar/desabilitar por loja. */
  isEnabled?(): boolean;

  /** Catálogo de serviços suportados (opcional, usado pelo endpoint /services). */
  listServices?(): ShippingServiceDescriptor[];

  /** Cota um ou mais serviços para a requisição. */
  getQuotes(request: ShippingQuoteRequest): Promise<ShippingQuote[]>;

  /** Verifica disponibilidade sem expor credenciais. */
  healthCheck(): Promise<ShippingProviderHealth>;
}
