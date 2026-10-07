import { MockShippingProvider } from "../providers/mock/mock-shipping.provider.js";
import { ShippingProviderFactory } from "../providers/provider-factory.js";
import type { ShippingProvider } from "../providers/shipping-provider.js";
import type { CorreiosProvider } from "../providers/correios/correios.provider.js";

export type EngineProviderRegistryOptions = {
  correios?: CorreiosProvider;
  staticProviders?: readonly ShippingProvider[];
  mock?: MockShippingProvider;
  /** Inclui o mock padrão (apenas dev/testes). */
  includeMock?: boolean;
  extra?: readonly ShippingProvider[];
};

/** Monta a factory do motor a partir das dependências da aplicação. */
export function createEngineProviderFactory(options: EngineProviderRegistryOptions = {}): ShippingProviderFactory {
  const providers: ShippingProvider[] = [];
  if (options.correios) providers.push(options.correios);
  if (options.staticProviders) providers.push(...options.staticProviders);
  if (options.mock) providers.push(options.mock);
  else if (options.includeMock) providers.push(new MockShippingProvider());
  if (options.extra) providers.push(...options.extra);
  return new ShippingProviderFactory(providers);
}
