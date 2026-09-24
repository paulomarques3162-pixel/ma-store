import { invalidRequest, providerUnavailable } from "../domain/errors.js";
import { normalizeProviderId } from "../domain/service-catalog.js";
import type { ShippingProvider } from "./shipping-provider.js";

/**
 * Registro central de provedores.
 *
 * Responsável por selecionar quem consulta:
 *  - `get("correios")`         -> somente um provedor;
 *  - `getAll()`                -> todos os registrados;
 *  - `getEnabled(["correios"])`-> habilitados (e opcionalmente em allowlist).
 *
 * Nunca instancia provedores por conta própria — recebe instâncias prontas,
 * mantendo credenciais e I/O fora da factory.
 */
export class ShippingProviderFactory {
  private readonly providers = new Map<string, ShippingProvider>();

  constructor(providers: readonly ShippingProvider[] = []) {
    this.registerMany(providers);
  }

  register(provider: ShippingProvider): this {
    if (!provider || typeof provider !== "object") {
      throw invalidRequest("Provedor de frete inválido.");
    }
    const id = normalizeProviderId(provider.id);
    if (!id) {
      throw invalidRequest("Provedor de frete precisa de um id.");
    }
    if (this.providers.has(id)) {
      throw invalidRequest(`Provedor de frete duplicado: ${id}.`);
    }
    this.providers.set(id, provider);
    return this;
  }

  registerMany(providers: readonly ShippingProvider[]): this {
    for (const provider of providers) this.register(provider);
    return this;
  }

  unregister(id: string): boolean {
    return this.providers.delete(normalizeProviderId(id));
  }

  has(id: string): boolean {
    return this.providers.has(normalizeProviderId(id));
  }

  /** Obtém um provedor. Lança `PROVIDER_UNAVAILABLE` se não existir. */
  get(id: string): ShippingProvider {
    const provider = this.providers.get(normalizeProviderId(id));
    if (!provider) {
      throw providerUnavailable(`Provedor de frete não encontrado: ${id}.`);
    }
    return provider;
  }

  getAll(): ShippingProvider[] {
    return [...this.providers.values()];
  }

  ids(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * Provedores habilitados. Quando `allowedIds` é informado (ex.: config por
   * loja), apenas esses são considerados — credenciais de uma loja nunca vazam
   * para outra por engano.
   */
  getEnabled(allowedIds?: readonly string[]): ShippingProvider[] {
    const allow =
      allowedIds && allowedIds.length > 0 ? new Set(allowedIds.map(normalizeProviderId)) : null;
    return this.getAll().filter((provider) => {
      const id = normalizeProviderId(provider.id);
      if (allow && !allow.has(id)) return false;
      return provider.isEnabled ? provider.isEnabled() : true;
    });
  }
}

export function createShippingProviderFactory(
  providers: readonly ShippingProvider[] = [],
): ShippingProviderFactory {
  return new ShippingProviderFactory(providers);
}
